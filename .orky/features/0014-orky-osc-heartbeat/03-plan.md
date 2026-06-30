# 0014 — Orky OSC heartbeat parse + render (read) — Plan (Phase 3)

**Status:** plan iteration 1. Spec [`02-spec.md`](02-spec.md) is FROZEN at **13 REQs (REQ-001…REQ-013)**.
10 TASKs (TASK-001…TASK-010), ordered pure-foundation → main-process wiring → test-fixture support →
docs. No characterization test should need editing (purely additive; confirmed against the baseline-fit
section of the spec).

## Architecture fit

This is a **third consumer of `scanOsc`** (`src/main/status/osc-scanner.ts`), structurally mirroring
`Osc133Parser`/`CwdParser`, plus a **second source** of the existing `OrkyPaneStatus`
(`src/shared/types.ts` / `src/shared/orky-status.ts`, feature 0004) alongside 0004's filesystem-watching
`OrkyTracker`. Nothing in `src/main/orky/orky-tracker.ts` changes (REQ-009). No new IPC channel, no new
wire type, no new persisted schema (REQ-008, REQ-013) — the stream-derived status is combined with the
filesystem-derived status and pushed over the **existing** `orky:status` channel.

Wiring point for the new parser is the same place `CwdParser` is wired today: `StatusEngine.feed()`
(`src/main/status/status-engine.ts`), which already holds one `CwdParser` instance per pane session and
calls an injected `onCwd` callback on each chunk. `OrkyOscParser` is added the same way, with an
`onOrkyHeartbeat` callback. The two sources (fs-derived from `OrkyTracker`'s `emit`, stream-derived from
`StatusEngine`'s new callback) are combined per pane by a small new main-process module via the pure
`selectOrkyPaneStatus` precedence function (REQ-009), and the combined result is sent over the **same**
`orky:status` channel `register-orky.ts` already sends on — no new channel, no renderer change required
(REQ-008's "same component path" acceptance is satisfied structurally: 0004's renderer already consumes
whatever arrives on `orky:status` via the existing presentation, regardless of source).

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| OSC marker contract + stateful parser (3rd `scanOsc` consumer) + strict body decode | `src/main/status/orky-osc-parser.ts` | new |
| Heartbeat→`OrkyPaneStatus` mapper (reuses 0004's `orkyPaneStatus`) + actionable `detail` | `src/shared/orky-status.ts` | edit (exists, feature 0004) |
| fs-vs-stream precedence selector | `src/shared/orky-status.ts` | edit (same file) |
| Wire `OrkyOscParser` into the per-pane status pipeline | `src/main/status/status-engine.ts` | edit (exists) |
| Per-pane fs/stream combine + emit over the existing `orky:status` channel | `src/main/orky/orky-stream-status.ts` | new |
| Compose the bridge into the existing registrars (StatusEngine's `onOrkyHeartbeat` → bridge; `OrkyTracker`'s `emit` → bridge; bridge's combined emit reuses the `send(CH.orkyStatus, …)` already wired) | `src/main/ipc/register-pty.ts`, `src/main/ipc/register-orky.ts`, `src/main/services.ts` | edit (exists) — **`orky-tracker.ts` itself is untouched (REQ-009)** |
| Synthetic/golden OSC byte fixture helper for tests (zero live-Orky dependency) | `tests/fixtures/orky-osc-fixtures.ts` | new |
| Feature doc + cross-repo contract block + drift caveat | `docs/features/orky-osc-heartbeat.md` | new |
| Doc-sync links/log | `CLAUDE.md` ("Where things live" table), `CHANGELOG.md` | edit |

## Determinism / security invariants (apply across the new code)

- `OrkyOscParser`/the decode function read NO clock, NO fs, NO `Math.random`; they are pure transforms of
  the byte stream already handed to them (mirrors 0004's mapper determinism anchor).
- Body decoding never `eval`s/`Function`s/dynamically interprets; it is direct enum/range validation +
  mapping (REQ-004). No silent capping/truncation of an out-of-range value — reject whole, never clamp
  (CONV-003, same convention 0004's `openBlockingCount`/`orkyPaneStatus` already follow).
- `push()` is total (never throws) on arbitrary/garbage/empty/oversized input (REQ-005), exactly the
  convention `Osc133Parser`/`CwdParser` already honor by construction (their body handlers never throw).

---

## Tasks

### TASK-001 — OSC marker contract + parser skeleton (3rd `scanOsc` consumer)
**Satisfies:** REQ-001, REQ-002, REQ-003 · **Files:** `src/main/status/orky-osc-parser.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** reuse `scanOsc`, do not reimplement its loop (REQ-002); determinism (REQ-003)
- Export `ORKY_OSC = '\x1b]8888;orky='` (the 12-byte contract prefix, REQ-001) and the `OrkyHeartbeat`
  interface exactly as specified in `02-spec.md`'s "Public interface" section, importing `OrkyPhase`/
  `OrkyReason` from `@shared/types` (REQ-008 — single source of truth, no forked literal unions).
- `OrkyOscParser` mirrors `Osc133Parser`/`CwdParser`'s shape: a single private `buf` field, `push(chunk)`
  appends to `buf` then calls `scanOsc(this.buf, ORKY_OSC, onBody)` and assigns the returned carry-over
  back to `this.buf` — no independent `indexOf('\x07')`/`indexOf('\x1b\\')` terminator scan anywhere in
  this file.
- `push` returns `OrkyHeartbeat[]` (the decoded, validated heartbeats for that chunk; `[]` when none).
  The chunk-boundary carry-over behavior (arbitrary split points, including inside the prefix/body/just
  before the terminator; a partial marker buffers and never double-emits) is **inherited for free** from
  `scanOsc` (REQ-003) — this task adds no new buffering logic of its own.

### TASK-002 — Strict, bounded, non-evaluating body grammar decode
**Satisfies:** REQ-004 · **Files:** `src/main/status/orky-osc-parser.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** no `eval`/`Function`/dynamic interpretation; no silent capping (CONV-003)
- `decodeHeartbeat(body: string): OrkyHeartbeat | null` — split on `;` into `key=value` pairs (direct
  string parsing only), enforcing in order: total body length ≤ 256 bytes and ≤ 32 pairs; `v` present and
  `=== '1'` (any other/missing version → reject — forward-compat is "ignore the whole marker", not
  "decode anyway"); every required key (`f,k,ph,g,m,o,h,x`) present; `f` matches
  `/^[A-Za-z0-9._-]{1,64}$/`; `k` ∈ the 4-member enum; `ph` ∈ `ORKY_PHASES ∪ {'done'}` (import
  `ORKY_PHASES` from `@shared/orky-status`); `g`/`m`/`o` parse as non-negative integers with
  `0 ≤ g ≤ m`, `1 ≤ m ≤ 32`, `o ≤ 9999`; `h`/`x` ∈ `{'0','1'}`; `r` (optional) ∈ the 3-member enum when
  present/non-empty. Any violation → return `null` (the **whole** marker rejected, never partially
  decoded). Unknown keys are read-and-discarded, not rejecting.
- `OrkyOscParser.push`'s `onBody` callback calls `decodeHeartbeat` and pushes the result only when
  non-null.
- No `eval`/`Function`/`new Function` anywhere in the decode path (grep-checkable, REQ-004 acceptance).

### TASK-003 — Total, never-throwing tolerance of malformed/partial/garbage input
**Satisfies:** REQ-005 · **Files:** `src/main/status/orky-osc-parser.ts`
**Depends on:** TASK-001, TASK-002 · **Order:** 2 · **Constraints:** totality; bounded buffer growth
- Defensive wrap: `decodeHeartbeat` must not throw on any input shape (numeric parses use `Number`, never
  `JSON.parse`/`eval`; out-of-range/garbage falls through to the `null` return path, never an exception).
  A rejected marker's bytes are fully consumed by `scanOsc` (it advances past the terminator regardless of
  whether `onBody` accepted the body), so a **subsequent** valid marker in the same or a later chunk still
  parses — no state corruption from a rejected marker.
- Unbounded buffer growth on a stream containing the prefix but never a terminator is already bounded by
  `scanOsc`'s carry-over contract (it returns only the pending partial, never the full history) — this
  task adds no new buffering, just confirms (via the phase-4 test, not new code) that `OrkyOscParser`
  introduces no second buffer.

### TASK-004 — Heartbeat → `OrkyPaneStatus` mapper, reusing 0004's presentation
**Satisfies:** REQ-006, REQ-007 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001 (type only — pure shared code, no runtime dependency on the parser file) · **Order:** 2 · **Constraints:** totality, purity; reuse `orkyPaneStatus`/`chipLabel`/`inPopover`, do not reimplement them (REQ-006)
- `heartbeatToFeatureStatus(hb: OrkyHeartbeat): OrkyFeatureStatus` — builds the wire `OrkyFeatureStatus`
  directly from the ALREADY-VALIDATED heartbeat fields (no re-derivation: `kind`/`gateN`/`gateM`/
  `openBlocking`/`needsHuman`/`failed`/`reason` map 1:1 from `hb`). `phase` is `hb.phase === 'done' ? null
  : hb.phase` — the same `null`-means-complete convention `orkyFeatureStatus`/`gateFrontier` already use,
  so `chipLabel`'s existing `f.phase ?? 'done'` guard renders identically (no literal `"done"`/`"null"`
  chip bug, FINDING-DA-007 guard — REQ-006 explicitly calls this out).
  - `detail` (REQ-007, actionable, mirrors 0004's phrasing): `reason==='human-review'` →
    `` `${hb.feature}: awaiting human-review (gates ${hb.gateN}/${hb.gateM}) — needs you` ``; `hb.failed`
    → `` `${hb.feature}: ${hb.phase ?? 'gate'} gate failed` ``; `hb.kind==='busy'` →
    `` `${hb.feature}: ${hb.phase ?? 'running'} in progress` ``; else a phase-naming fallback — never a
    bare `"needs input"`/`"error"`.
- `orkyHeartbeatToPaneStatus(hb: OrkyHeartbeat): OrkyPaneStatus` = `orkyPaneStatus([heartbeatToFeatureStatus(hb)])`
  — delegates to the EXISTING 0004 roll-up (chip selection, label, `inPopover` filter, empty shape) rather
  than reimplementing any of it (REQ-006).

### TASK-005 — `selectOrkyPaneStatus`: filesystem-wins precedence (pure)
**Satisfies:** REQ-009 · **Files:** `src/shared/orky-status.ts`
**Depends on:** — (uses only the existing `OrkyPaneStatus` type) · **Order:** 2 · **Constraints:** totality, purity; no `orky-tracker.ts` edit
- `selectOrkyPaneStatus(fsStatus: OrkyPaneStatus | null, streamStatus: OrkyPaneStatus | null): OrkyPaneStatus | null`
  — returns `fsStatus` whenever non-null (regardless of `streamStatus`), else `streamStatus`, else `null`.
  Three-line pure function; no I/O, no `orky-tracker.ts` involvement (REQ-009's "must not modify
  `orky-tracker.ts`'s status derivation" — this function lives entirely outside that file and is called
  by the new bridge in TASK-007, never by the tracker itself).

### TASK-006 — Wire `OrkyOscParser` into `StatusEngine`'s per-pane pipeline
**Satisfies:** REQ-008, REQ-013 · **Files:** `src/main/status/status-engine.ts`
**Depends on:** TASK-001, TASK-002, TASK-003 · **Order:** 3 · **Constraints:** mirror the existing `cwdParser`/`onCwd` wiring exactly; no writes (REQ-013)
- Add `orkyParser: OrkyOscParser` to the per-pane `Session` interface (alongside `cwdParser`), constructed
  in `register()`. Add a `private readonly onOrkyHeartbeat: (id: string, hb: OrkyHeartbeat) => void = () =>
  {}` constructor parameter (default no-op, so existing callers/tests are unaffected — additive only).
- In `feed(id, data)`, after the existing `cwdParser.push(data)` call, add
  `for (const hb of s.orkyParser.push(data)) this.onOrkyHeartbeat(id, hb)` — same shape as the cwd
  wiring, no new buffering, no fs/IPC access inside `StatusEngine` itself (it only calls the injected
  callback — REQ-013's "no writes" is trivially true here, the callback does the IPC emit elsewhere).

### TASK-007 — Per-pane fs/stream combine + emit over the existing `orky:status` channel
**Satisfies:** REQ-008, REQ-009 · **Files:** `src/main/orky/orky-stream-status.ts` (new)
**Depends on:** TASK-004, TASK-005 · **Order:** 3 · **Constraints:** `orky-tracker.ts` untouched; no new channel/type (REQ-008)
- A small per-pane combiner: `Map<paneId, { fs: OrkyPaneStatus | null; stream: OrkyPaneStatus | null }>`
  with `setFsStatus(id, status)` and `setStreamHeartbeat(id, hb: OrkyHeartbeat | null)` (the latter maps
  via `orkyHeartbeatToPaneStatus` when `hb` is non-null, else clears the stream slot), each recomputing
  `selectOrkyPaneStatus(fs, stream)` and invoking an injected `emit(id, combined)` callback ONLY when the
  combined result changes (dedup, mirroring `StatusEngine.emit`'s `key !== s.last` pattern) — emitted over
  the **same** `orky:status` channel/payload shape `register-orky.ts` already sends (no new channel, no
  new type — REQ-008).
- This module is the ONLY place fs+stream are combined; `src/main/orky/orky-tracker.ts` is not imported or
  modified by it beyond consuming its existing `emit` callback's output as an input (REQ-009).

### TASK-008 — Compose the bridge into the existing main-process wiring
**Satisfies:** REQ-008, REQ-009, REQ-013 · **Files:** `src/main/ipc/register-pty.ts`, `src/main/ipc/register-orky.ts`, `src/main/services.ts`
**Depends on:** TASK-006, TASK-007 · **Order:** 4 · **Constraints:** `orky-tracker.ts` derivation logic untouched; no new IPC channel; no `.orky/` watch started by the parser
- Construct the TASK-007 bridge once (in `services.ts`, alongside the existing `StatusEngine`/`OrkyTracker`
  construction) with `emit = (id, status) => send(CH.orkyStatus, id, status)` — the exact `send` callback
  `register-orky.ts` already passes to `OrkyTracker`'s constructor.
- `register-orky.ts`'s existing `OrkyTracker((id, status) => send(...))` callback is changed to call
  `bridge.setFsStatus(id, status)` INSTEAD of sending directly (the bridge does the send after combining)
  — `OrkyTracker`'s own watch/read/derivation code is **not edited** (REQ-009).
- `register-pty.ts`'s `StatusEngine` construction passes `onOrkyHeartbeat: (id, hb) => bridge.setStreamHeartbeat(id, hb)`.
  Wherever a pane's PTY closes/unregisters, also call `bridge.setStreamHeartbeat(id, null)` so a closed
  pane's stale stream-derived status cannot linger (clean teardown, same lifecycle the existing `unwatch`
  paths already follow).
- The `OrkyOscParser` itself never opens a chokidar watch, never touches `.orky/` on disk — it is a pure
  byte-stream parser fed entirely from PTY output (REQ-009's "stream parser does not start a `.orky/`
  filesystem watch" acceptance is true by construction: TASK-001..003/006 contain no `fs`/`chokidar`
  import).

### TASK-009 — Synthetic/golden OSC byte fixture helper (zero live-Orky dependency)
**Satisfies:** REQ-010 · **Files:** `tests/fixtures/orky-osc-fixtures.ts` (new)
**Depends on:** TASK-001 (needs the contract's exact prefix/grammar) · **Order:** 2 · **Constraints:** no `child_process`/network/Orky-CLI dependency anywhere in this file
- Export `buildOrkyMarker(fields: Partial<Record<'v'|'f'|'k'|'ph'|'g'|'m'|'o'|'h'|'x'|'r', string>>, terminator?: 'BEL' | 'ST'): string`
  that joins `key=value` pairs with `;` and wraps them in the literal `ORKY_OSC` prefix + chosen
  terminator byte(s) — a pure byte-string builder, no process/network/file access.
  Export the spec's worked-example marker as a named constant (`WORKED_EXAMPLE_MARKER`) and its expected
  decoded `OrkyHeartbeat` (`WORKED_EXAMPLE_HEARTBEAT`) so every phase-4 test file can import the SAME
  golden fixture rather than re-typing the byte string (reduces drift between test files).
- This file is the single place phase-4 tests construct OSC marker bytes from (REQ-010's "tests construct
  their OSC marker bytes itself" + "no test may depend on a live Orky CLI/network/real `.orky/` tree" —
  satisfied because nothing in this fixture file, or anything that imports only from it, can reach a
  process/network/filesystem `.orky/` tree).

### TASK-010 — Docs: cross-repo contract block, drift caveat, CLAUDE.md link, CHANGELOG
**Satisfies:** REQ-011, REQ-012 · **Files:** `docs/features/orky-osc-heartbeat.md` (new), `CLAUDE.md`, `CHANGELOG.md`
**Depends on:** TASK-001..TASK-008 (describes the shipped shape) · **Order:** last · **Constraints:** reproduce the contract byte-for-byte; explicit out-of-scope + drift caveat (REQ-011/REQ-012)
- `docs/features/orky-osc-heartbeat.md`: reproduce the EXACT contract from `02-spec.md` (the 12-byte
  prefix `\x1b]8888;orky=`, the BEL/ST terminator, the full `key=value` body grammar table) as a prominent
  copy-pasteable block, citing `src/main/status/orky-osc-parser.ts` (`ORKY_OSC` + `decodeHeartbeat`) as the
  defining source. State explicitly that Orky-side emission (the matching change to the separate
  `C:/dev/Orky` repo) is OUT OF SCOPE for this feature and is a human follow-up (REQ-011) — until it
  exists, a bare-SSH pane running an unmodified Orky CLI shows no status, never a false one. Carry the
  drift caveat: this is a cross-repo agreement; `ph`/`r` mirror 0004's `OrkyPhase`/`OrkyReason` (imported,
  not forked); the carried `m` is expected to equal `ORKY_PHASES.length` (8); a divergence is a
  coordinated two-repo data-update no Termhalla test can catch (REQ-012).
- Link the new doc from the CLAUDE.md "Where things live" table (Orky pipeline status row, alongside the
  existing `orky-status.md` link). Record the feature in `CHANGELOG.md [Unreleased]`.

---

## Sequencing summary

```
TASK-001 (contract + parser skeleton)
  ├─ TASK-002 (strict body decode)            [needs 001]
  │     └─ TASK-003 (totality/never-throw)    [needs 001, 002]
  │           └─ TASK-006 (wire into StatusEngine)   [needs 001..003]
  ├─ TASK-004 (heartbeat → OrkyPaneStatus mapper, pure shared)   [type-only dep on 001]
  ├─ TASK-005 (selectOrkyPaneStatus precedence, pure shared)     [independent]
  │     └─ TASK-007 (fs/stream combine bridge)        [needs 004, 005]
  │           └─ TASK-008 (compose into register-pty/register-orky/services)  [needs 006, 007]
  └─ TASK-009 (synthetic fixture helper)       [needs 001, used by phase-4 tests]
TASK-010 (docs + CLAUDE.md + CHANGELOG)  ── after all functional tasks
```

## Risk notes

1. **Cross-repo drift (doc-provenance)** — the contract is reproduced verbatim in two places (spec +
   TASK-010's doc); both cite the same source file (`orky-osc-parser.ts`) so a future re-sync has one
   place to check against. TASK-010 carries the explicit drift caveat.
2. **Security surface (untrusted bytes)** — TASK-002/003 are the concrete, testable bounded-grammar +
   totality obligations; no `eval`/dynamic interpretation anywhere in the decode path.
3. **Coexistence (REQ-009)** — TASK-005/007/008 are deliberately separated from `orky-tracker.ts`: the
   precedence function and the combiner live in new files; `register-orky.ts`'s ONE-line change (route its
   existing callback through the bridge instead of `send` directly) is the only touch to Orky-tracker
   wiring, and the tracker's own watch/read/derivation code is untouched.
4. **Baseline-fit** — no CHAR test edits anticipated; `StatusTracker`/`needs-input.ts`/`CwdParser` are
   untouched; `SCHEMA_VERSION` is NOT bumped (TASK-008's wiring is live-runtime-state only, like 0004's).
   If implementation finds a CHAR test must change, STOP — the change isn't purely additive.

## Open issues (under-specified REQs)

None. Every REQ-001..REQ-013 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). The spec is
frozen at 13 REQs.
