# Orky OSC heartbeat (stream-derived status)

A **second source** of the Orky pane chip (see [orky-status](orky-status.md)): instead of watching a
project's `.orky/` tree on disk, this feature parses a small OSC marker out of the PTY's own byte
stream. It exists for the case `orky-status.md`'s filesystem watcher cannot cover — a **bare-SSH pane**
(no local `.orky/` tree the host can see) whose remote shell happens to print this marker. The
**filesystem source always wins** when it has an opinion; the stream source is a fallback only
(`selectOrkyPaneStatus`, REQ-013).

This feature is **Termhalla-side only**: it builds the parser + renderer. The matching emission now
exists for real on the separate `C:/dev/Orky` CLI (ADR-026, opt-in). See "Scope: Orky-side emission is
REAL and shipped" below.

## OSC marker CONTRACT (authoritative — ADR-026, reproduced verbatim)

> Defined in [`src/main/status/orky-osc-parser.ts`](../../src/main/status/orky-osc-parser.ts)
> (`ORKY_OSC` the prefix constant, `decodeHeartbeat` the body decoder — not exported, reached only
> through `OrkyOscParser.push`). This is Orky's **real, shipped** wire contract
> (`C:/dev/Orky` ADR-026 / `docs/watchdog.md`), reproduced byte-for-byte here from
> `.orky/features/0014-orky-osc-heartbeat/orky-adr-026-osc-heartbeat.md` (the upstream source of
> truth) and from `02-spec.md`'s own "OSC marker CONTRACT" section. Any change to this contract is a
> coordinated, two-repo change.

### Wire format

```
ESC ] 9999 ; <payload> BEL
```

- **Introducer:** `\x1b]` (`ESC` `]`), the standard OSC introducer.
- **Code:** `9999` — a private/unassigned code, chosen to avoid the well-known ranges in common use
  (`0`–`19` title/color queries, `52` clipboard, `104` color reset, `133` shell-integration prompt
  marks, `633` VS Code's shell-integration extension, `1337` iTerm2 proprietary). It does not collide
  with this codebase's other OSC consumers: `Osc133Parser` (`\x1b]133;`) or `CwdParser`
  (`\x1b]7;` / `\x1b]9;9;`).
- **Separator:** a single `;` immediately after the code. The parser splits on only the **first** `;`
  and treats everything after it, up to the terminator, as the opaque payload — the JSON payload
  itself may legitimately contain `;` characters (e.g. inside a `reason` string). `ORKY_OSC` (the
  introducer + code + this single `;`) is the literal prefix `scanOsc` matches, so this rule is
  inherited from `scanOsc`'s prefix match, never re-coded.
- **Payload:** a single-line, compact JSON object (no embedded newlines — `JSON.stringify` never emits
  one). See schema below.
- **Terminator:** `\x07` (`BEL`) — what Orky actually sends, and what the parser MUST accept. The
  parser MAY additionally accept `ST` (`\x1b\\`) for robustness against a relay that rewrites
  terminators, but Orky only ever emits BEL.

**Safety property (from ADR-026):** `JSON.stringify` escapes every control character below `0x20` —
including `BEL` and `ESC` — as a `\uXXXX` escape. A `reason` or other string field can never contain a
raw control byte that would prematurely terminate or corrupt the sequence; this is guaranteed by the
JSON spec, not by ad-hoc sanitization.

### Payload schema (`v: 1`)

| Field        | Type             | Always present?                | Meaning |
|--------------|------------------|---------------------------------|---------|
| `v`          | integer          | yes                             | Schema version. Bump on any breaking change to this table; a parser should ignore unknown fields and tolerate a missing/older `v` gracefully rather than fail closed. |
| `feature`    | string           | only with a resolvable feature  | The feature slug (`path.basename` of its directory, e.g. `0005-cross-project-orky-registry`). |
| `phase`      | string \| null   | only with a resolvable feature  | The live phase: `state.json.phase` if set, else the gate-frontier phase `drive()` computes (mirrors the detection model Termhalla's status chip, feature `0004`, already established). |
| `gate`       | string           | only with a resolvable feature  | `"<passed>/<total>"` — how many of the 8 work-phase gates (`brainstorm, spec, plan, tests, implement, review, doc-sync, human-review`) have passed. |
| `needsHuman` | boolean          | only with a resolvable feature  | `true` when `drive()` returns `await-human` or `escalate` for this feature — i.e. autonomous work is blocked on a human decision. |
| `reason`     | string           | only when `needsHuman` is `true` *and* `drive()` returned one | Why — e.g. `"brainstorm is a human gate"`, `"blocked by 1 open escalation(s): ESC-001 — resolve first"`, `"iteration cap reached for implement (3/3)"`. |
| `action`     | string \| null   | only when NO feature is resolvable | The last heartbeat `action` note from `active.json` (or `null`) — a minimal "something is alive" signal for an app-loop tick with no single active feature. |

Decoding is strict-but-tolerant (REQ-005/REQ-008): an unknown/missing `v` and unknown extra fields are
**not** rejections; malformed JSON, a non-object payload, or an over-cap payload (`MAX_PAYLOAD_BYTES`,
4096 actual UTF-8 bytes, checked before `JSON.parse`) yield no heartbeat and never throw. Field mapping
is **verbatim** (REQ-004) — `needsHuman`/`reason`/`phase`/`gate` are taken as already-computed ground
truth from Orky and never re-derived.

### Worked examples (verbatim from ADR-026)

A minimal example with no resolvable feature:

```json
{"v":1,"action":"app-loop"}
```

A feature awaiting human review:

```json
{"v":1,"feature":"0004-orky-status-awareness","phase":"human-review","gate":"7/8","needsHuman":true,"reason":"human-review is a human gate"}
```

As complete on-the-wire byte strings (BEL-terminated):

```
\x1b]9999;{"v":1,"action":"app-loop"}\x07
\x1b]9999;{"v":1,"feature":"0004-orky-status-awareness","phase":"human-review","gate":"7/8","needsHuman":true,"reason":"human-review is a human gate"}\x07
```

The awaiting-human example decodes to `{ feature:'0004-orky-status-awareness', phase:'human-review',
gateN:7, gateM:8, needsHuman:true, reason:'human-review is a human gate', action:null }`, which maps
(`orkyHeartbeatToPaneStatus`) to an `OrkyPaneStatus` whose `kind === 'needs-input'` and
`label === '0004-orky-status-awareness · human-review · 7/8'` — the same chip/popover presentation
`orky-status.md` renders for the same feature via the filesystem path.

## Trust boundary

The OSC payload is **unauthenticated**. Anything that can write to the PTY — a remote shell, a hostile
program, `cat`-ing a crafted file — can fabricate a heartbeat for an arbitrary feature slug, including a
fake `needsHuman:true` to draw attention to a non-event, or a fake low-urgency state to mask a real one.
This is a **deliberate design tradeoff**, not a bug: REQ-004 mandates a thin-client, verbatim-trust
stance — the parser maps `needsHuman`/`reason`/`phase`/`gate` directly and never "corrects" Orky's
verdict, the same "ground truth, not self-report" discipline used elsewhere in this codebase. The
practical implication: **stream-derived status is only as trustworthy as whatever writes to the PTY**.
Unlike the filesystem-derived status (`orky-status.md`), which reads a project's own `.orky/` tree on
disk, the stream source has no way to verify the bytes came from a real Orky run at all. (Tracked as
`FINDING-DA-001`, open — visually distinguishing stream-derived from filesystem-derived status in the
chip UI is a follow-up, not yet implemented.)

## Scope: Orky-side emission is REAL and shipped

This feature does **not** change anything in the separate `C:/dev/Orky` repository — Termhalla does not
touch that repo. The matching **emission now exists for real** (ADR-026): Orky's CLI emits this marker
opt-in via `config.heartbeat.osc` (default `false`, zero behavior change until a project opts in), via

```
node "${CLAUDE_PLUGIN_ROOT}/gatekeeper/cli.js" osc-heartbeat --project <root> [--feature <dir>] [--config <path>]
```

run immediately after Orky's existing heartbeat stamp. It is **best-effort**: it never throws, always
exits `0`, and writes nothing to disk. This feature's job remains the Termhalla-side **parser +
renderer** only — it reads/parses and emits nothing into any stream. The feature is **no longer dark in
production**: once a project opts in (`config.heartbeat.osc: true`) and Termhalla parses code `9999`, a
bare-SSH pane shows real Orky status.

## Cross-repo drift caveat (doc-provenance)

The contract above is a **cross-repo agreement** with the separate `C:/dev/Orky` CLI (ADR-026).
Termhalla parses it here; Orky emits it; the two sides can silently drift over time. Specifically:

- The `phase` field **mirrors** `src/shared/orky-status.ts`'s `OrkyPhase` and Orky's own pipeline phase
  concept, but is typed `OrkyPhase | string | null` on the wire (not a closed union) — the parser
  accepts any string verbatim (REQ-004/REQ-005) rather than validating it against a fixed enum, so a
  future Orky-side phase name change does not blackout the chip.
- `reason` is **free-form prose**, not a closed enum — Orky's `drive()` composes it dynamically (e.g.
  citing a specific escalation ID or iteration count), so the parser/renderer must not assume a fixed
  set of reason strings.
- The carried `gate`'s `M` (gateM) is **expected** to equal `ORKY_PHASES.length` (`8`, per the
  provenance caveat in
  [orky-status.md](orky-status.md#data-provenance-the-orky_phases-drift-caveat)) — a divergence is a
  coordinated two-repo data-update, never something a Termhalla test can catch.
- A future Orky-side `v` bump that **redefines** an existing field's meaning (not just adds one) would
  be silently decoded with `v:1` semantics and render wrong (not blank) status — the parser never
  fails closed on version (frozen TEST-011, a spec decision). Since Orky v0.44.0 (commit `9443bee`,
  2026-07-12) this is governed at the emitter: Orky's `docs/osc-heartbeat.md` now states the
  **never-redefine, rename-instead** evolution discipline (a field's meaning is frozen forever;
  within `v:1` the schema may only GAIN fields; a meaning change must introduce a new field name —
  absent fields already degrade gracefully; a `v` bump signals a structural break, never permission
  to reuse a name), citing Termhalla's TEST-011 as the reason version negotiation cannot protect a
  decode-everything consumer. `FINDING-DA-006` closed on that upstream rule (2026-07-12); the
  forward-compat decode itself is unchanged.
- Every test for this feature constructs its OSC marker bytes itself (`tests/fixtures/orky-osc-fixtures.ts`)
  against THIS embedded contract; none of them exercise a live Orky process. Tests therefore verify only
  that the Termhalla code matches the contract as documented here and in `02-spec.md` — not that the real
  Orky CLI matches it.
- **Golden-fixture backstop:** `tests/shared/orky-contract-golden.test.ts` additionally asserts the
  parser against a **committed snapshot of real producer output** — `tests/fixtures/orky-contract/`
  holds `gatekeeper contract`'s machine-readable contract (OSC code, `max_payload_bytes`, the phase
  list) and a raw `osc-heartbeat` byte sequence captured from the real CLI, regenerated with
  `tools/generate-orky-contract-fixtures.mjs` (producer path overridable via `ORKY_PLUGIN_DIR`). The
  test itself still spawns nothing and runs green without Orky present; refreshing the fixtures
  against a newer Orky is what turns contract drift into a red test.

## Architecture

| Concern | Location |
|---|---|
| OSC prefix constant, payload decoder, stateful parser (3rd `scanOsc` consumer) | `src/main/status/orky-osc-parser.ts` |
| Heartbeat wire type (`OrkyHeartbeat`) | `src/shared/types.ts` |
| Heartbeat → `OrkyPaneStatus` mapper (reuses 0004's `orkyPaneStatus`), fs-vs-stream precedence | `src/shared/orky-status.ts` (`orkyHeartbeatToPaneStatus`, `selectOrkyPaneStatus`) |
| Wiring into the per-pane PTY pipeline (`onOrkyHeartbeat` callback, mirrors `CwdParser`/`onCwd`) | `src/main/status/status-engine.ts` |
| Per-pane filesystem/stream combine + emit over the existing `orky:status` channel | `src/main/orky/orky-stream-status.ts` (`OrkyStreamStatusBridge`) |
| Composition: `OrkyTracker`'s emit routed through the bridge; `StatusEngine`'s heartbeat callback routed through the bridge | `src/main/ipc/register.ts` |
| Synthetic/golden OSC byte fixtures (zero live-Orky dependency) | `tests/fixtures/orky-osc-fixtures.ts` |

`src/main/orky/orky-tracker.ts` (the filesystem watcher from `orky-status.md`) is **unmodified** by this
feature — it remains the sole authority for any pane whose `.orky/` tree is filesystem-reachable, and
this feature never duplicates its watch or starts a `.orky/` filesystem watch of its own. No new IPC
channel, no new pane-status wire type, and no `SCHEMA_VERSION` bump: the stream-derived status rides the
existing `orky:status` push channel and feature 0004's renderer presentation unchanged.
