# 0014 — Orky OSC heartbeat parse + render (read) — Plan (Phase 3, RE-PLAN)

**Status:** plan iteration 2, correcting iteration 1's TASK-005 `kind` derivation to match `02-spec.md`'s
spec iteration 3 (frozen, REQ-001…REQ-017 unchanged in count/shape except REQ-009's wording). Spec
iteration 3 applies one further, human-approved correction (ESC-002, see `state.json`'s
`escalations[1]`/`loopbacks[1]`): REQ-009's `kind` done-detection is now **purely gate-based**
(`gateN >= gateM`), independent of the `phase` field's value — it is no longer
`phase == null AND gateN >= gateM`. This plan iteration touches ONLY TASK-005's `kind`-derivation bullet
(and this status note); every other task, the file/module layout, and the sequencing/risk sections below
are unchanged from iteration 1 because they were written against the same ADR-026 wire contract, which
iteration 3 of the spec does not alter.

Plan iteration 1 (superseded by this note) was written against the **re-drafted, FROZEN** spec
(`02-spec.md`, frozen 2026-06-30T21:14:18, **17 REQs, REQ-001…REQ-017**), which fully replaced the prior
iteration's placeholder OSC contract (code `8888`, `;`-delimited `key=value` body) with Orky's **real,
shipped** wire contract — **ADR-026** (code `9999`, single-line compact JSON payload, BEL terminator; see
`orky-adr-026-osc-heartbeat.md`). That loopback was driven by ESC-001 (ground-truth correction, see
`state.json`'s `escalations[0]`/`loopbacks[0]`).

**This is a REPLACEMENT plan, not an incremental patch.** The previous `03-plan.md`, `04-tests.md`, and
the implementation files currently on disk
(`src/main/status/orky-osc-parser.ts`, `src/main/orky/orky-stream-status.ts`,
`docs/features/orky-osc-heartbeat.md`, `tests/fixtures/orky-osc-fixtures.ts`,
`tests/main/orky-osc-parser.test.ts`, `tests/main/orky-osc-structural.test.ts`,
`tests/shared/orky-heartbeat-status.test.ts`) all implement the superseded `8888`/`key=value` contract
and are **stale**. Every TASK below replaces — not patches around — that code. `src/shared/types.ts`'s
`OrkyHeartbeat` interface and `src/shared/orky-status.ts`'s heartbeat-mapping section are likewise
stale (old field shape carried `kind`/`openBlocking`/`failed` straight off the wire; the new ADR-026
wire does not carry those — they are now Termhalla-side defaults/derivations, REQ-009).

8 TASKs (TASK-001…TASK-008), ordered pure-parser-core → mapper → test-fixture support → wiring
regression check → docs. No characterization test should need editing (purely additive; confirmed
against the baseline-fit section of `02-spec.md`).

## Architecture fit (unchanged shape, new wire contract)

Still a **third consumer of `scanOsc`** (`src/main/status/osc-scanner.ts`), structurally mirroring
`Osc133Parser`/`CwdParser` (REQ-002), plus a **second source** of the existing `OrkyPaneStatus`
(`src/shared/types.ts` / `src/shared/orky-status.ts`, feature 0004) alongside 0004's
filesystem-watching `OrkyTracker`. `src/main/orky/orky-tracker.ts` is **untouched** (REQ-013). No new
IPC channel, no new wire type, no new persisted schema (REQ-012, REQ-017) — the stream-derived status
continues to ride the existing `orky:status` channel via the already-wired
`src/main/orky/orky-stream-status.ts` (`OrkyStreamStatusBridge`) + `src/main/ipc/register.ts`
composition (already correct at the *structural* level — `OrkyStreamStatusBridge` only ever passes an
opaque `OrkyHeartbeat` through `orkyHeartbeatToPaneStatus`/`selectOrkyPaneStatus`, so it needs no field-
shape edit, only a regression check, TASK-007).

What changes vs. the stale implementation:
- The contract prefix: `\x1b]8888;orky=` (12 bytes, key=value body) → `\x1b]9999;` (the introducer +
  code + first `;`; everything after up to the terminator is an opaque JSON payload, REQ-001).
- The body grammar: `;`-delimited `key=value` pairs → single-line compact JSON (REQ-001/REQ-008).
- The size/charset cap: was a char-length (`.length`) check on the whole body — now MUST be the actual
  UTF-8 byte length of the raw payload, checked **before** `JSON.parse` (REQ-007, FINDING-CODEX-001).
- The no-terminator carry-over: was implicitly "whatever `scanOsc` carries" — now MUST be an **explicit
  bounded ceiling** layered on top of `scanOsc`'s carry-over, which is itself unbounded (REQ-006,
  FINDING-SEC-001).
- Version/unknown-field policy: was strict `v !== '1' → reject whole` — now MUST be forward-compatible
  (ignore unknown fields, tolerate missing/older/newer `v`, REQ-005 — a deliberate reversal of the prior
  policy, resolving FINDING-DA-003).
- The `OrkyHeartbeat` wire shape: drops `kind`/`openBlocking`/`failed` (the old key=value grammar
  carried them explicitly; ADR-026's JSON payload does not) and adds `action` (REQ-011, the app-loop
  liveness field). `kind` is now **derived** in the mapper, purely from `needsHuman`/`gateN`/`gateM`
  (REQ-009, corrected in spec iteration 3 — `phase` plays NO role in `kind` derivation), never read off
  the wire.

## Target file / module layout

| Area | File(s) | New? | Disposition |
|---|---|---|---|
| OSC marker contract constant + `OrkyHeartbeat`-producing parser (3rd `scanOsc` consumer) | `src/main/status/orky-osc-parser.ts` | exists | **full rewrite** (TASK-001..004) |
| `OrkyHeartbeat` wire type | `src/shared/types.ts` | exists | **edit** — new field shape (TASK-001) |
| Heartbeat→`OrkyPaneStatus` mapper (reuses 0004's `orkyPaneStatus`) + actionable `detail` + app-loop cleared shape | `src/shared/orky-status.ts` | exists | **edit/rewrite** of the feature-0014 section only (TASK-005) |
| fs-vs-stream precedence selector (`selectOrkyPaneStatus`) | `src/shared/orky-status.ts` | exists | **no logic change expected** — regression-checked (TASK-007) |
| Per-pane fs/stream combine + emit over the existing `orky:status` channel | `src/main/orky/orky-stream-status.ts` | exists | **no change expected** (type-opaque pass-through) — regression-checked (TASK-007) |
| Wiring: `StatusEngine`'s `onOrkyHeartbeat`, `OrkyTracker`'s emit → bridge, in `src/main/ipc/register.ts` | `src/main/status/status-engine.ts`, `src/main/ipc/register.ts` | exists | **no change expected** — regression-checked (TASK-007) |
| Synthetic/golden OSC byte fixture helper for tests (zero live-Orky dependency) | `tests/fixtures/orky-osc-fixtures.ts` | exists | **full rewrite** for the JSON/`9999` contract (TASK-006) |
| Feature doc + cross-repo contract block + drift caveat + scope correction | `docs/features/orky-osc-heartbeat.md` | exists | **full rewrite** (TASK-008) |
| Doc-sync links/log | `CLAUDE.md` ("Where things live" table — row already exists, content needs the ADR-026 framing), `CHANGELOG.md` | exists | **edit** (TASK-008) |
| Stale test files (out of plan-phase scope — listed for phase-4 awareness) | `tests/main/orky-osc-parser.test.ts`, `tests/main/orky-osc-structural.test.ts`, `tests/shared/orky-heartbeat-status.test.ts` | exists | **stale — full replacement is phase-4's job**, not this plan's; do not patch incrementally |

## Determinism / security invariants (apply across the new/rewritten code)

- `OrkyOscParser`/the decode function read NO clock, NO fs, NO `Math.random`; pure transforms of the
  byte stream already handed to them (mirrors 0004's mapper determinism anchor).
- Body decoding never `eval`s/`Function`s/dynamically interprets; `JSON.parse` is the ONLY parse step,
  always guarded (try/catch), and only ever called on a payload that has already passed the byte-length
  cap (REQ-007) — never on a derived/re-encoded string (REQ-004/REQ-008).
- No silent capping/truncation of an out-of-range or over-cap value — reject the whole marker/payload,
  never clamp (CONV-003, carried into REQ-006's "no silent capping of a *valid* in-flight marker" and
  REQ-007's "no silent truncation").
- `push()` is total (never throws) on arbitrary/garbage/empty/malformed/oversized input (REQ-008),
  exactly the convention `Osc133Parser`/`CwdParser` already honor by construction.
- Thin-client stance (REQ-004): `needsHuman`/`reason`/`phase`/`gate` are mapped **verbatim** from the
  validated payload — never re-derived, never "corrected" against Termhalla's own gate logic.

---

## Tasks

### TASK-001 — OSC `9999` contract constant + parser skeleton + `OrkyHeartbeat` type rewrite
**Satisfies:** REQ-001, REQ-002, REQ-003, REQ-012, REQ-017
**Files:** `src/main/status/orky-osc-parser.ts`, `src/shared/types.ts`
**Depends on:** — · **Order:** 1
**Constraints:** reuse `scanOsc`, do not reimplement its loop (REQ-002); the prefix must implement "split
on the first `;` only" via `scanOsc`'s own prefix-match (REQ-001); import `OrkyPhase`/`OrkyReason` from
`@shared/types` rather than redefining them (REQ-012); the module writes nothing to disk/stream (REQ-017)

- In `src/shared/types.ts`, replace the stale `OrkyHeartbeat` interface (the one carrying
  `kind`/`openBlocking`/`failed` straight off the wire) with the ADR-026-shaped interface from
  `02-spec.md`'s "Public interface" section:
  ```ts
  export interface OrkyHeartbeat {
    feature: string | null
    phase: OrkyPhase | string | null
    gateN: number
    gateM: number
    needsHuman: boolean
    reason: string | null
    action: string | null
  }
  ```
  Update the doc-comment above it to cite ADR-026 (code `9999`, JSON payload) instead of the superseded
  `8888`/key=value description. Note in the comment that `kind`/`openBlocking`/`failed` are intentionally
  **not** wire fields any more — they are derived/defaulted in the mapper (`heartbeatToFeatureStatus`,
  TASK-005), not carried.
- In `src/main/status/orky-osc-parser.ts`, replace the file header comment's contract description (the
  `8888`/`orky=`/key=value block) with the ADR-026 wire format (`ESC ] 9999 ; <payload> BEL`), and
  replace `export const ORKY_OSC = '\x1b]8888;orky='` with `export const ORKY_OSC = '\x1b]9999;'` — the
  introducer + code `9999` + the single `;` separator. Because `scanOsc(buf, ORKY_OSC, onBody)` matches
  `ORKY_OSC` literally and then scans for the terminator, the "split on the **first** `;` only, payload
  may itself contain `;`" rule (REQ-001) is inherited for free — `scanOsc` never looks past the matched
  prefix for a second `;`.
  Verify (and keep) the prefix does not collide with `\x1b]133;`/`\x1b]7;`/`\x1b]9;9;`.
- `OrkyOscParser` keeps the same class shape (`private buf`, `push(chunk): OrkyHeartbeat[]` delegating
  to `scanOsc`) — no independent `indexOf('\x07')`/`indexOf('\x1b\\')` terminator scan anywhere (REQ-002).
  The chunk-boundary carry-over behavior (arbitrary split points, including inside the prefix/payload/
  just before the terminator; a partial marker buffers and never double-emits) continues to be inherited
  from `scanOsc` for the *complete-marker* case (REQ-003) — the *no-terminator-ever* case is bounded
  separately in TASK-002, since `scanOsc`'s own carry-over is unbounded (FINDING-SEC-001).
- Remove the old `decodeHeartbeat`'s key=value-pair parsing, the `KIND_VALUES`/`PHASE_VALUES`/
  `REASON_VALUES`/`FEATURE_RE`/`NON_NEGATIVE_INT_RE`/`REQUIRED_KEYS` constants, and `MAX_BODY_BYTES`/
  `MAX_PAIRS` — none of these apply to a JSON payload. TASK-003/004 define their JSON-shaped
  replacements.

### TASK-002 — Bounded carry-over ceiling on the no-terminator path (security, FINDING-SEC-001)
**Satisfies:** REQ-003, REQ-006
**Files:** `src/main/status/orky-osc-parser.ts`
**Depends on:** TASK-001 · **Order:** 2
**Constraints:** does not rely on `scanOsc`'s own carry-over for boundedness (that is the defect being
fixed); never drops/clips a *valid* in-flight marker (CONV-003)

- Add a documented `MAX_PENDING_BYTES` constant, defined strictly greater than the longest possible
  legal marker = `ORKY_OSC.length + MAX_PAYLOAD_BYTES (TASK-003) + 2` (terminator — BEL is 1 byte, ST is
  2, so size for the larger case), so no in-flight valid marker is ever dropped.
- After each `push`'s call into `scanOsc` (which returns the unconsumed carry-over tail), measure the
  retained buffer's length; if it exceeds `MAX_PENDING_BYTES`, **discard/reset** `this.buf` to `''`
  rather than keep accumulating on the next `push`. This is layered explicitly on top of `scanOsc`'s
  return value — it is the parser's own ceiling, not a change to `scanOsc` itself (which stays shared
  with `Osc133Parser`/`CwdParser` and must not gain Orky-specific bounding logic).
  Note: measure using `Buffer.byteLength(this.buf, 'utf8')` for consistency with TASK-003's byte-accurate
  philosophy (FINDING-CODEX-001's lesson applies here too — a `.length` check would undercount on
  multi-byte carry-over content).
- `push` remains total: this guard never throws, just resets state and continues returning `[]` for that
  call when triggered.

### TASK-003 — Payload UTF-8 byte-length cap, enforced before `JSON.parse` (FINDING-CODEX-001)
**Satisfies:** REQ-007
**Files:** `src/main/status/orky-osc-parser.ts`
**Depends on:** TASK-001 · **Order:** 2 (parallel with TASK-002)
**Constraints:** measured on the raw payload string pulled from the PTY buffer, via a byte-length
function (`Buffer.byteLength(payload, 'utf8')`), NOT JS string `.length` (UTF-16 code units); checked
strictly before any `JSON.parse` call; no silent truncation (CONV-003)

- Add a documented `MAX_PAYLOAD_BYTES` constant (e.g. `4096` — generous enough for a realistic heartbeat
  payload including a long free-form `reason` string, small enough to bound worst-case work per marker;
  exact value is the implementer's call, document the reasoning at the constant).
- In the `onBody` callback `scanOsc` invokes (the payload exactly as sliced out, before any decode), the
  **very first** check is `Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES → reject (no heartbeat,
  no `JSON.parse` call at all)`. This check MUST run before TASK-004's `JSON.parse`/validation step, not
  after — an over-cap payload must never reach `JSON.parse`.
  An empty payload (`payload.length === 0`) is also rejected at this stage (REQ-008's "empty payload"
  acceptance) — fold it into the same guard or treat as a 0-byte cap failure equivalently.

### TASK-004 — Strict-but-tolerant JSON decode: thin-client mapping, forward-compat, total/never-throw
**Satisfies:** REQ-004, REQ-005, REQ-008, REQ-011
**Files:** `src/main/status/orky-osc-parser.ts`
**Depends on:** TASK-001, TASK-003 · **Order:** 3
**Constraints:** `JSON.parse` is the only parse primitive, always try/catch-guarded; no `eval`/
`Function`/dynamic interpretation anywhere; never re-derive `needsHuman`/`reason`/`phase`/`gate` —
map verbatim (REQ-004); unknown/missing `v` and unknown extra fields are NOT rejections (REQ-005)

- Replace the old `decodeHeartbeat(body: string)` with a JSON-shaped `decodeHeartbeat(payload: string):
  OrkyHeartbeat | null`:
  1. (TASK-003's byte-cap guard runs first, in the caller or as this function's first statement.)
  2. `JSON.parse(payload)` wrapped in try/catch — a `SyntaxError` (or anything else thrown) → `return
     null`, never propagate (REQ-008).
  3. The parsed value MUST be a non-null, non-array object (`typeof === 'object' && !Array.isArray`) —
     anything else (array/string/number/boolean/`null`) → `return null` (REQ-008).
  4. No check on `v` beyond "ignore it" — a missing, older, or newer `v` is NOT a rejection reason
     (REQ-005, deliberate reversal of the stale strict policy / resolves FINDING-DA-003). Unknown extra
     fields are simply never read (forward-compat by construction — reading only named fields off the
     parsed object IS the "ignore unknown fields" behavior, no explicit allow-list needed).
  5. Field mapping, verbatim from the parsed object, with type coercion guards that never throw (a
     wrong-typed field → that field defaults rather than crashing the whole decode, but core required
     shape is still validated minimally so malformed payloads degrade gracefully):
     - `feature`: `typeof o.feature === 'string' ? o.feature : null` (REQ-011 — no resolvable feature ⇒
       `null`, the app-loop case, not a rejection).
     - `phase`: `typeof o.phase === 'string' ? o.phase : null` (verbatim string passthrough, including
       values outside `OrkyPhase`'s literal union — REQ-004's "map directly" stance, no enum rejection).
     - `gate`: parse `"N/M"` via a small total helper (`parseGateFraction(raw: unknown): {n:number;
       m:number}`) — missing/malformed `gate` defaults `gateN=0`, `gateM=ORKY_PHASES.length` (import
       from `@shared/orky-status`) rather than rejecting the whole heartbeat.
     - `needsHuman`: `o.needsHuman === true` (strict boolean check, anything else → `false`).
     - `reason`: `typeof o.reason === 'string' ? o.reason : null` (free-form string verbatim — NOT
       validated against an enum; ADR-026's `reason` examples are prose, not a closed set).
     - `action`: `typeof o.action === 'string' ? o.action : null`.
  6. Return the populated `OrkyHeartbeat`. There is no "required keys missing → reject whole" step the
     way the old key=value grammar had — JSON payloads are sparse by design (ADR-026's "only with a
     resolvable feature" / "only when no feature resolvable" columns) and REQ-008's only objectionable
     shapes are non-object JSON, malformed JSON, and over-cap/empty payload (TASK-003).
- `OrkyOscParser.push`'s `onBody` callback (unchanged structurally from TASK-001) calls the byte-cap
  guard then `decodeHeartbeat`, pushing the result only when non-null. A rejected/garbage marker's bytes
  are still fully consumed by `scanOsc` (advances past the terminator regardless of `onBody`'s outcome),
  so a subsequent valid marker — same or later chunk — still parses (REQ-008's "rejected marker must not
  corrupt the carry-over buffer" acceptance).
- No `eval`/`Function`/`new Function` anywhere in the decode path (grep-checkable, REQ-004 acceptance).

### TASK-005 — Rewrite heartbeat → `OrkyPaneStatus` mapper: derived `kind`, actionable `detail`, app-loop cleared shape
**Satisfies:** REQ-009, REQ-010, REQ-011, REQ-012, REQ-017
**Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001 (type only — pure shared code, no runtime dependency on the parser file)
**Order:** 2 (can proceed in parallel with TASK-002..004)
**Constraints:** totality, purity; reuse `orkyPaneStatus`/`chipLabel`/`inPopover`, do not reimplement
them (REQ-009); writes nothing (REQ-017)

- Replace the existing `heartbeatToFeatureStatus`/`heartbeatDetail`/`orkyHeartbeatToPaneStatus` section
  (the "Orky OSC heartbeat (feature 0014)" block at the bottom of the file) to match the new field
  shape:
  - `heartbeatToFeatureStatus(hb: OrkyHeartbeat): OrkyFeatureStatus` now DERIVES rather than passes
    through `kind`/`openBlocking`/`failed` (the wire no longer carries them):
    - `phase`: `hb.phase` verbatim (already `string | null`; a `null`/absent phase maps to the `null`
      "done"-rendered chip LABEL only — same convention `gateFrontier`/`chipLabel`'s `?? 'done'` guard
      already use, FINDING-DA-007 guard — this is purely a label fallback and is explicitly NOT part of
      `kind`'s derivation, REQ-009 as corrected in spec iteration 3).
    - `openBlocking = 0` (deterministic default — the label simply omits the `· ●k open` suffix).
    - `failed = false` (deterministic default — the wire carries no halted-gate signal).
    - `kind`: `hb.needsHuman === true ? 'needs-input' : hb.gateN >= hb.gateM ? 'done' : 'busy'` — exactly
      REQ-009's acceptance-defined derivation **as corrected by ESC-002 in spec iteration 3**: done-
      detection is **purely gate-based** (`gateN >= gateM`, i.e. all 8 work-phase gates passed) and is
      **completely independent of `hb.phase`'s value** — `phase` MUST NOT be read or branched on anywhere
      in this derivation (the prior iteration's `hb.phase == null && hb.gateN >= hb.gateM` rule is WRONG
      and must not be implemented: the real Orky emitter sends `phase: "doc-sync"` — never `null` — for a
      genuinely complete feature, so a phase-null-gated rule can never fire against real output,
      FINDING-DA-004). The presence of a per-feature heartbeat means the run is actively ticking, so the
      fallback (neither needs-human nor done) is always `'busy'`, never `'idle'`.
    - `reason`: `hb.reason` (now a free-form `string | null`, not the closed `OrkyReason` union — update
      `OrkyFeatureStatus.reason`'s usage here accordingly; `OrkyFeatureStatus`'s own `reason: OrkyReason`
      field type is for the FILESYSTEM (0004) path and is unaffected — this mapper's locally-built
      `OrkyFeatureStatus` value sets `reason` to `null` for `OrkyFeatureStatus` purposes since that field
      is typed to the closed union, while the actionable free-form text is carried entirely in `detail`,
      per REQ-010 — do not attempt to coerce `hb.reason` into `OrkyReason`'s literal union since the
      values are free prose, not a closed set).
    - `detail` (REQ-010, CONV-001 — always names the feature + a concrete reason, never bare text):
      `needsHuman === true && reason present` → names the feature and includes `hb.reason` verbatim;
      `needsHuman === true` with no `reason` → names the feature and states it needs a human; otherwise
      names the feature and its live phase (`"<feature>: <phase> in progress"` style, mirroring
      `orkyFeatureStatus`'s existing busy/complete phrasing — reuse that phrasing pattern rather than
      inventing a new one).
    - `lastActivityAt = 0` (unchanged rationale — heartbeats aren't ranked against each other across
      multiple simultaneous panes the way the filesystem roll-up is).
  - `orkyHeartbeatToPaneStatus(hb: OrkyHeartbeat): OrkyPaneStatus` (REQ-011 — app-loop is a valid tick,
    not a failure): when `hb.feature === null` (the app-loop/no-resolvable-feature case), return the
    SAME cleared/empty shape `orkyPaneStatus([])` already produces for an empty features list (`kind:
    'idle'`, `label: ''`, `needsHuman: false`, `failed: false`, `features: []`, `chipFeature: null`) —
    do NOT fabricate a feature chip from `hb.action`. Otherwise (resolvable `feature`), build ONE
    `OrkyFeatureStatus` via `heartbeatToFeatureStatus(hb)` and delegate to the EXISTING `orkyPaneStatus`
    roll-up (chip selection, label, `inPopover` filter) exactly as before (REQ-009) — no
    reimplementation of `chipLabel`/`inPopover`/`selectChipFeature`.
- Update the section's header comment to describe the ADR-026 wire shape (no `kind`/`openBlocking`/
  `failed` carried; `action`/feature-less app-loop case) instead of the stale key=value description, and
  to note that `kind`'s done-branch is gate-based only (REQ-009, spec iteration 3 / ESC-002).

### TASK-006 — Rewrite synthetic/golden OSC byte fixture helper for the JSON/`9999` contract
**Satisfies:** REQ-014
**Files:** `tests/fixtures/orky-osc-fixtures.ts`
**Depends on:** TASK-001 (needs the exact `ORKY_OSC` prefix) · **Order:** 2 (parallel with mapper/decode
work; needed by phase-4's test files but the helper itself is foundational, not a gating test)
**Constraints:** no `child_process`/network/Orky-CLI dependency anywhere in this file; output bytes must
match ADR-026 exactly (BEL-terminated by default, ST optionally)

- Replace `buildOrkyMarker`'s key=value-pair-joining implementation with a JSON-payload builder:
  `buildOrkyMarker(payload: Record<string, unknown>, terminator?: 'BEL' | 'ST'): string` — wraps
  `ORKY_OSC + JSON.stringify(payload) + (terminator === 'ST' ? '\x1b\\' : '\x07')`. A pure byte-string
  builder, no process/network/file access.
- Export the spec's two worked-example markers verbatim as named constants, matching `02-spec.md`'s
  "Worked examples" section byte-for-byte:
  - `APP_LOOP_MARKER` = `\x1b]9999;{"v":1,"action":"app-loop"}\x07` and its expected decoded
    `OrkyHeartbeat` (`feature: null, phase: null, gateN: 0, gateM: <ORKY_PHASES.length default>,
    needsHuman: false, reason: null, action: 'app-loop'`).
  - `AWAITING_HUMAN_MARKER` = the human-review worked example
    (`{"v":1,"feature":"0004-orky-status-awareness","phase":"human-review","gate":"7/8","needsHuman":
    true,"reason":"human-review is a human gate"}`) and its expected decoded `OrkyHeartbeat`.
  Export both as named constants so every phase-4 test file imports the SAME golden fixtures rather than
  re-typing the byte strings (reduces drift between test files, REQ-014's single-source intent).
- Optionally export a small helper for constructing an over-cap / malformed / non-object-JSON payload
  variant (e.g. `buildOversizedMarker(byteCount: number)`, `buildMalformedJsonMarker()`,
  `buildNonObjectJsonMarker()`) so phase-4's REQ-007/REQ-008 tests don't hand-roll byte-padding logic
  per test file — implementer's call on exact helper names, but the intent (one place to construct
  these edge-case byte strings) should be honored.
- This file remains the single place phase-4 tests construct OSC marker bytes from (REQ-014's "tests
  construct their OSC marker bytes itself" + "no test may depend on a live Orky CLI/network/real
  `.orky/` tree" — satisfied because nothing in this fixture file, or anything that imports only from
  it, can reach a process/network/filesystem `.orky/` tree).

### TASK-007 — Wiring regression check: composition unaffected by the new `OrkyHeartbeat` shape
**Satisfies:** REQ-013
**Files:** `src/main/status/status-engine.ts`, `src/main/orky/orky-stream-status.ts`,
`src/main/ipc/register.ts` (verify/adjust only — no functional change anticipated)
**Depends on:** TASK-001..006 · **Order:** 4
**Constraints:** `orky-tracker.ts` derivation logic untouched; no new IPC channel; the stream parser
starts no `.orky/` filesystem watch

- Confirm `status-engine.ts`'s `onOrkyHeartbeat: (id: string, hb: OrkyHeartbeat) => void` callback
  wiring (added when this feature first implemented, alongside the existing `cwdParser`/`onCwd`
  pattern) still compiles and behaves correctly against the NEW `OrkyHeartbeat` field shape — the
  callback is type-opaque (it only forwards `hb`, never reads its fields), so no functional change is
  expected; if the implementer finds a field-shape leak here, fix it minimally rather than restructuring
  the wiring.
- Confirm `src/main/orky/orky-stream-status.ts`'s `OrkyStreamStatusBridge.setStreamHeartbeat(id, hb)`
  likewise only ever calls `orkyHeartbeatToPaneStatus(hb)` and never destructures `hb`'s fields itself —
  no change expected; if the implementer finds a field-shape leak, fix it minimally. (TASK-005's
  kind-derivation correction is internal to `heartbeatToFeatureStatus`/`orkyHeartbeatToPaneStatus`'s own
  body, not its signature, so this bridge requires no edit either way.)
- Confirm `src/main/ipc/register.ts`'s existing composition (routing `OrkyTracker`'s emit through
  `bridge.setFsStatus`, `StatusEngine`'s `onOrkyHeartbeat` through `bridge.setStreamHeartbeat`) is
  unaffected — this is the REQ-013 acceptance surface ("a code check confirms
  `src/main/orky/orky-tracker.ts`'s derivation is unchanged… and the stream parser does not start a
  `.orky/` filesystem watch"). `selectOrkyPaneStatus`'s own logic (fs wins, else stream, else null) is
  unchanged by this feature's re-plan — no edit expected; re-confirm its 3-branch shape still matches
  REQ-013's acceptance literally.
- This task is primarily a verification/regression pass, not new feature work — but it is the explicit
  place REQ-013's "no regression/duplication of 0004's filesystem path" acceptance gets checked against
  the rewritten upstream pieces (TASK-001..006), so it is listed as its own task rather than folded
  silently into TASK-005.

### TASK-008 — Docs: ADR-026 contract block, drift caveat, scope/"no longer dark" correction, CLAUDE.md + CHANGELOG
**Satisfies:** REQ-015, REQ-016, REQ-017
**Files:** `docs/features/orky-osc-heartbeat.md` (full rewrite), `CLAUDE.md`, `CHANGELOG.md`
**Depends on:** TASK-001..007 (describes the shipped shape) · **Order:** last
**Constraints:** reproduce the ADR-026 contract byte-for-byte; explicit drift caveat; correct the
scope framing from "dark in production" (stale) to "real, opt-in, no longer dark once
`config.heartbeat.osc: true`" (REQ-015)

- Rewrite `docs/features/orky-osc-heartbeat.md` in full:
  - Replace the "OSC marker CONTRACT" section's `8888`/`orky=`/key=value content with the EXACT ADR-026
    contract reproduced in `02-spec.md`: introducer `\x1b]`, code `9999`, single `;` separator
    (first-`;`-only split), single-line compact JSON payload, BEL terminator (MUST accept; MAY also
    accept ST), the full payload schema table (`v`/`feature`/`phase`/`gate`/`needsHuman`/`reason`/
    `action` — with their "always present?" column verbatim from ADR-026), and the two worked examples
    (app-loop tick, awaiting-human feature) as complete on-the-wire byte strings.
  - Cite `src/main/status/orky-osc-parser.ts` (`ORKY_OSC` + `decodeHeartbeat`) as the defining in-repo
    source, and cite Orky's `orky-adr-026-osc-heartbeat.md` / `C:/dev/Orky`'s ADR-026 as the upstream
    source of truth (REQ-016).
  - Replace the "Out of scope: Orky-side emission (human follow-up)" section's "dark in production"
    framing: state plainly that (a) this feature's job remains the Termhalla-side parser/renderer only,
    (b) the emission now EXISTS for real on the separate `C:/dev/Orky` CLI (ADR-026, opt-in via
    `config.heartbeat.osc`, default `false`, best-effort/never-throws/writes-nothing), superseding the
    prior "dark in production" status, and (c) once a project opts in, a bare-SSH pane running the
    updated Orky CLI shows REAL status (REQ-015). State this feature still does not modify
    `C:/dev/Orky` itself.
  - Keep and update the "Cross-repo drift caveat" section: the `phase`/`reason` values mirror 0004's
    `OrkyPhase` concept and Orky's own pipeline phases (free-form `reason` text now, not a closed enum —
    update the wording accordingly); the carried `gate`'s `M` is expected to equal `ORKY_PHASES.length`
    (8); a divergence is a coordinated two-repo data-update no Termhalla test can catch (REQ-016).
  - Update the "Architecture" table's file/location list to match the rewritten module layout (no
    structural changes expected beyond the contract description itself).
- Update the CLAUDE.md "Where things live" table row for `orky-osc-heartbeat` (the row already exists,
  linking `docs/features/orky-osc-heartbeat.md`) — verify its one-line description doesn't reference the
  stale `8888` framing (it currently doesn't name a code number, so likely no edit needed; confirm).
- Add/update a `CHANGELOG.md [Unreleased]` entry recording that this feature now parses Orky's REAL
  shipped OSC heartbeat contract (ADR-026, code `9999`), superseding the prior placeholder.
- Confirm (REQ-017) the diff leaves `SCHEMA_VERSION` unchanged and introduces no new `fs` write / new
  `userData` path; the parser/mapper modules contain no write API and emit nothing into any stream — this
  is a structural property already true after TASK-001..007's design, checked here as the doc/diff-level
  attestation.

---

## Sequencing summary

```
TASK-001 (ORKY_OSC=9999 contract constant + parser skeleton + OrkyHeartbeat type rewrite)
  ├─ TASK-002 (bounded carry-over ceiling, FINDING-SEC-001)        [needs 001]
  ├─ TASK-003 (payload byte-length cap before JSON.parse, FINDING-CODEX-001)  [needs 001]
  │     └─ TASK-004 (strict-but-tolerant JSON decode, thin-client mapping)  [needs 001, 003]
  ├─ TASK-005 (heartbeat → OrkyPaneStatus mapper, gate-based derived kind, app-loop cleared shape)  [type-only dep on 001]
  └─ TASK-006 (synthetic/golden JSON fixture helper)                [needs 001]
        └─ TASK-007 (wiring regression check: status-engine / bridge / register.ts)  [needs 001..006]
              └─ TASK-008 (docs: ADR-026 contract block, drift caveat, scope correction, CLAUDE.md, CHANGELOG)
```

## Risk notes

1. **Cross-repo drift (doc-provenance)** — the contract is reproduced verbatim in three places now
   (`orky-adr-026-osc-heartbeat.md` the human-supplied source of truth, `02-spec.md`'s embedded copy,
   TASK-008's feature-doc copy); all cite the same in-repo defining file
   (`src/main/status/orky-osc-parser.ts`) so a future re-sync has one place to check code against.
2. **Security surface (untrusted bytes), now with two binding hardening REQs** — TASK-002 (bounded
   carry-over ceiling) and TASK-003 (byte-accurate payload cap before `JSON.parse`) are the concrete,
   testable fixes for FINDING-SEC-001 and FINDING-CODEX-001 respectively; both were the cause of
   ESC-001's escalation in the prior iteration and MUST NOT be treated as folded silently into "implement
   the parser" — they are separate, explicitly named tasks here.
2a. **Stale TEST-021 risk (carried forward as a lesson, not a literal test to keep)** — the prior
   iteration's TEST-021 asserted only "no throw / no emit" on an unbounded no-terminator stream and
   passed green over the unbounded-buffer defect. Phase-4's replacement test for REQ-006 MUST assert the
   retained buffer size directly (`≤ MAX_PENDING_BYTES`), not merely absence of a throw — flagged here so
   the tests phase does not regress to the same blind spot.
3. **Forward-compat reversal (REQ-005)** — this is a deliberate behavior change from the prior
   iteration's strict `v !== '1' → reject-whole` policy (which DA-003 flagged as a version-blackout
   risk). TASK-004 implements the reversal explicitly; do not "restore" the old strict check.
4. **`OrkyHeartbeat`'s field-shape change is the highest blast-radius edit** — `kind`/`openBlocking`/
   `failed` leave the wire type; `action` joins it. TASK-001 (type), TASK-004 (decode), TASK-005
   (mapper) must land together conceptually even though they're separate tasks/files — TASK-007 exists
   specifically to catch any consumer (`status-engine.ts`, `orky-stream-status.ts`, `register.ts`) that
   assumed the old shape.
4a. **`kind`'s done-derivation is gate-based only, NOT phase-based (FINDING-DA-004 / ESC-002)** — the
   prior plan iteration's TASK-005 encoded `hb.phase == null && hb.gateN >= hb.gateM` as the `done`
   branch, matching the (since-corrected) spec iteration 2's REQ-009 wording verbatim. That rule is
   **wrong** and can never fire against the real Orky emitter (`gatekeeper.js:904`'s
   `phase: state.phase || d.phase || null` sends `phase: "doc-sync"`, never `null`, for a genuinely
   complete feature). TASK-005 now implements `hb.needsHuman === true ? 'needs-input' : hb.gateN >=
   hb.gateM ? 'done' : 'busy'` — `phase` is read ONLY for the chip `label`'s own `?? 'done'` text
   fallback (a separate, still-correct mechanism, FINDING-DA-007), never for `kind`. Do not reintroduce a
   `phase` check into the `kind` derivation.
5. **Coexistence (REQ-013)** — unchanged from the prior iteration's design: `orky-tracker.ts` and
   `selectOrkyPaneStatus` are not expected to need any edit; TASK-007 is a verification pass, not new
   logic, confirming the re-plan didn't silently regress this guarantee.
6. **Baseline-fit** — no CHAR test edits anticipated; `StatusTracker`/`needs-input.ts`/`CwdParser` are
   untouched; `SCHEMA_VERSION` is NOT bumped (TASK-008 attests this). If implementation finds a CHAR test
   must change, STOP — the change isn't purely additive.

## Open issues (under-specified REQs)

None. Every REQ-001..REQ-017 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). The spec is
frozen at 17 REQs, spec iteration 3 (`spec-freeze.json`); REQ-009's wording was corrected per ESC-002
without changing its REQ-ID, TASK mapping, or REQ count.
</content>
