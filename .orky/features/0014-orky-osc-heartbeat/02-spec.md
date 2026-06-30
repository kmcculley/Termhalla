# 0014 — Orky OSC heartbeat parse + render (read)

## Phase 2 — Specification (loopback iteration 3 — targeted REQ-009 correction)

**Status:** re-drafted after ESC-001's resolution + the spec→spec loopback (see `state.json`). This
revision **fully replaces** the prior iteration's *placeholder* OSC contract (code `8888`, `;`-delimited
`key=value` body) with Orky's **real, shipped** wire contract, **ADR-026** (code `9999`, single-line
compact JSON payload, BEL terminator), reproduced verbatim below from
`orky-adr-026-osc-heartbeat.md`. No trace of the `8888`/`key=value` placeholder survives in this spec.
Iteration 3 applies one further, human-approved correction (ESC-002): REQ-009's done-detection is now
**purely gate-based** (`gateN >= gateM`), never keyed off `phase === null` — see REQ-009.

This feature remains **Termhalla-side only**: it builds the Termhalla **parser** (extends
`osc-scanner.ts`) + the heartbeat→`OrkyPaneStatus` **mapper** (reusing feature 0004's presentation
unchanged), tested against **synthetic/golden OSC byte fixtures**. The matching **emission** now exists
for real on the separate `C:/dev/Orky` CLI (ADR-026, opt-in via `config.heartbeat.osc`); this feature
does **not** change that repo (REQ-015).

## Concerns

`security` `quality` `determinism` `doc-drift`

- `security` — the OSC payload is attacker-influenceable: anything that can write to the PTY (a remote
  shell, a hostile program, `cat`-ing a crafted file) can inject these bytes. The parser is therefore a
  **strict, bounded, non-evaluating** consumer that (a) enforces an explicit **bounded carry-over
  ceiling** so a prefix-without-terminator stream cannot exhaust heap in the privileged main process
  (REQ-006, from FINDING-SEC-001), (b) measures its payload size cap on **actual UTF-8 byte length**
  before `JSON.parse` (REQ-007, from FINDING-CODEX-001), and (c) never `eval`s / re-derives pipeline
  logic from the bytes (REQ-004).
- `quality` — reuse `scanOsc` and 0004's `OrkyPaneStatus` / `orkyPaneStatus` presentation; this feature
  adds a second **source** of `OrkyPaneStatus`, never a second presentation or a forked type/channel
  (REQ-002, REQ-009, REQ-012).
- `determinism` — `scanOsc`'s accumulate / carry-over-partial-sequence behavior across chunk boundaries
  MUST be preserved EXACTLY by **reusing the function** (REQ-002, REQ-003).
- `doc-drift` — the OSC marker is a **cross-repo contract**: Termhalla parses code `9999` here, Orky
  emits it from `C:/dev/Orky` (ADR-026). The two sides can silently drift. The contract is a first-class
  artifact (REQ-001) and doc-sync MUST surface its exact bytes + location and update the cross-repo
  follow-up doc to record that the contract is now **final/real** (REQ-015, REQ-016).

## Baseline fit (brownfield — `.orky/baseline/` present)

Purely additive; supersedes **no** baseline REQ and **no** characterization test.

- Baseline terminal-status state machine + ANSI-stripped status tail are **unchanged**: the marker is an
  OSC sequence, already stripped from the ~400-char needs-input tail by the existing `stripAnsi`; the new
  parser reads the **raw** byte stream exactly as `Osc133Parser`/`CwdParser` do (REQ-002). `StatusTracker`,
  `needs-input.ts`, CHAR-001/004 are untouched.
- Baseline cwd extraction (OSC `9;9` / OSC `7`) is **unchanged**; the new prefix `\x1b]9999;` does not
  collide with `\x1b]9;9;`/`\x1b]7;`/`\x1b]133;` (REQ-001). `CwdParser` and CHAR-005 are untouched.
- Feature **0004**'s filesystem-watching `OrkyTracker` (`src/main/orky/orky-tracker.ts`) is **unchanged
  and authoritative** for panes whose `.orky/` tree is filesystem-reachable; this feature must not regress
  or duplicate that path (REQ-013).
- `SCHEMA_VERSION` is **not** bumped; the parser persists nothing and writes nothing (REQ-017).

If implementation finds a characterization test needs editing, the change is not purely additive — stop
and revisit.

---

## OSC marker CONTRACT (authoritative — ADR-026, reproduced verbatim)

> This is Orky's **real, shipped** wire contract (`C:/dev/Orky` ADR-026 / `docs/watchdog.md`),
> reproduced byte-for-byte from `orky-adr-026-osc-heartbeat.md`. It is the interface Orky's CLI
> emits (opt-in via `config.heartbeat.osc`) and the interface Termhalla parses here. Any change is a
> coordinated, two-repo change. Doc-sync MUST surface this block and its in-repo source-file location
> (REQ-016).

### Wire format

```
ESC ] 9999 ; <payload> BEL
```

- **Introducer:** `\x1b]` (`ESC` `]`), the standard OSC introducer.
- **Code:** `9999` — a private/unassigned code, chosen to avoid the well-known ranges in common use
  (`0`–`19` title/color queries, `52` clipboard, `104` color reset, `133` shell-integration prompt
  marks, `633` VS Code's shell-integration extension, `1337` iTerm2 proprietary).
- **Separator:** a single `;` immediately after the code. A parser MUST split on only the *first* `;`
  and treat everything after it, up to the terminator, as the opaque payload — the JSON payload itself
  may legitimately contain `;` characters (e.g. inside a `reason` string).
- **Payload:** a single-line, compact JSON object (no embedded newlines — `JSON.stringify` never emits
  one). See schema below.
- **Terminator:** `\x07` (`BEL`). (Not `ST` / `ESC \` — BEL is what's emitted; a parser should accept
  BEL and MAY additionally accept `ST` for robustness against a relay that rewrites terminators, but
  Orky only ever sends BEL.)

**Safety property (from ADR-026):** `JSON.stringify` escapes every control character below `0x20` —
including `BEL` and `ESC` — as a `\uXXXX` escape. A `reason` or other string field can never contain a
raw control byte that would prematurely terminate or corrupt the sequence; this is guaranteed by the
JSON spec, not by ad-hoc sanitization.

### Payload schema (`v: 1`)

| Field        | Type             | Always present?                | Meaning |
|--------------|------------------|--------------------------------|---------|
| `v`          | integer          | yes                            | Schema version. Bump on any breaking change to this table; a parser should ignore unknown fields and tolerate a missing/older `v` gracefully rather than fail closed. |
| `feature`    | string           | only with a resolvable feature | The feature slug (`path.basename` of its directory, e.g. `0005-cross-project-orky-registry`). |
| `phase`      | string \| null   | only with a resolvable feature | The live phase: `state.json.phase` if set, else the gate-frontier phase `drive()` computes (mirrors the detection model Termhalla's status chip, feature `0004`, already established). |
| `gate`       | string           | only with a resolvable feature | `"<passed>/<total>"` — how many of the 8 work-phase gates (`brainstorm, spec, plan, tests, implement, review, doc-sync, human-review`) have passed. |
| `needsHuman` | boolean          | only with a resolvable feature | `true` when `drive()` returns `await-human` or `escalate` for this feature — i.e. autonomous work is blocked on a human decision. |
| `reason`     | string           | only when `needsHuman` is `true` *and* `drive()` returned one | Why — e.g. `"brainstorm is a human gate"`, `"blocked by 1 open escalation(s): ESC-001 — resolve first"`, `"iteration cap reached for implement (3/3)"`. |
| `action`     | string \| null   | only when NO feature is resolvable | The last heartbeat `action` note from `active.json` (or `null`) — a minimal "something is alive" signal for an app-loop tick with no single active feature. |

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

---

## Public interface

### New / revised stateful parser — `src/main/status/orky-osc-parser.ts`

Structurally a **third consumer** of `scanOsc`, mirroring `Osc133Parser`/`CwdParser` (new prefix, new
payload decode). The contract prefix is the introducer + code + the single `;` separator, so `scanOsc`'s
prefix-match implements the "split on the first `;` only" rule automatically — everything after it, up to
the terminator, is the opaque JSON payload:

```ts
import { scanOsc } from './osc-scanner'

export const ORKY_OSC = '\x1b]9999;'   // the ADR-026 contract prefix (introducer + code + first ';')

/** The validated, Termhalla-normalized result of one decoded heartbeat payload (REQ-008/REQ-009). The
 *  parser maps ADR-026's fields directly (thin client, REQ-004): `feature`/`phase`/`gate`/`needsHuman`/
 *  `reason` come straight from the payload; presentation-only fields the wire does not carry
 *  (openBlocking, failed) default rather than being re-derived from pipeline state. */
export interface OrkyHeartbeat {
  feature: string | null          // payload.feature; null for an app-loop tick (REQ-011)
  phase: OrkyPhase | string | null // payload.phase, verbatim; a null phase ONLY falls back to the chip LABEL "done" (chipLabel's ?? 'done') — it does NOT imply kind==='done' (kind is purely gate-based, REQ-009)
  gateN: number                   // parsed from payload.gate "<N>/<M>"
  gateM: number                   // parsed from payload.gate; default ORKY_PHASES.length
  needsHuman: boolean             // payload.needsHuman === true
  reason: string | null           // payload.reason verbatim (free-form), null when absent
  action: string | null           // payload.action (only meaningful when feature is null)
}

/** Stateful scanner: feed PTY output chunks, get validated heartbeats back. Keeps a BOUNDED carry-over
 *  buffer (REQ-006) so a marker split across chunks still parses without unbounded growth. */
export class OrkyOscParser {
  push(chunk: string): OrkyHeartbeat[]   // [] for chunks with no complete, valid marker
}
```

### Pure mapper — `src/shared/orky-status.ts` (extend; Electron-free, `../api`-free)

```ts
/** Map ONE decoded heartbeat to the SAME OrkyPaneStatus shape feature 0004 renders, by building a
 *  single OrkyFeatureStatus and delegating to orkyPaneStatus([fs]). Total + pure (REQ-009/REQ-010). A
 *  feature-less (app-loop) heartbeat maps to the cleared/empty pane status (REQ-011). */
export function orkyHeartbeatToPaneStatus(hb: OrkyHeartbeat): OrkyPaneStatus

/** Compose the filesystem-derived (0004) and stream-derived (0014) sources for one pane: the filesystem
 *  source wins whenever present; the stream source is used only as a fallback (REQ-013). */
export function selectOrkyPaneStatus(
  fsStatus: OrkyPaneStatus | null,
  streamStatus: OrkyPaneStatus | null
): OrkyPaneStatus | null
```

No new IPC channel, no new pane-status type: the stream-derived status flows through the existing
`orky:status` push channel and 0004's renderer presentation (REQ-012).

---

## Requirements

### REQ-001 — The OSC marker contract is the ADR-026 contract, defined as a first-class artifact
The system MUST define and parse the marker EXACTLY as the "OSC marker CONTRACT" section above (ADR-026):
introducer `\x1b]`, code `9999`, a single `;` separator after the code with the parser splitting on the
**first** `;` only (the JSON payload may itself contain `;`), a single-line compact **JSON** payload, and
a terminator that the parser MUST accept as `BEL` (`\x07`) and MAY additionally accept as `ST` (`\x1b\\`).
The prefix MUST NOT collide with the in-repo OSC prefixes `\x1b]133;` (`Osc133Parser`), `\x1b]7;`, or
`\x1b]9;9;` (`CwdParser`).
**Acceptance:** feeding the verbatim byte string
`\x1b]9999;{"v":1,"feature":"0004-orky-status-awareness","phase":"human-review","gate":"7/8","needsHuman":true,"reason":"human-review is a human gate"}\x07`
yields exactly one heartbeat with `feature==='0004-orky-status-awareness'`, `phase==='human-review'`,
`gateN===7`, `gateM===8`, `needsHuman===true`, `reason==='human-review is a human gate'`; the same payload
ST-terminated (`…}\x1b\\`) yields the identical result; a `reason` value containing a literal `;`
(e.g. `"blocked by 1 open escalation(s): ESC-001; resolve first"`) parses whole (the inner `;` is NOT a
split point); feeding an OSC 133 (`\x1b]133;A\x07`), OSC 7, or OSC 9;9 sequence yields `[]` (no
cross-prefix match).

### REQ-002 — Parser is a third `scanOsc` consumer (reuse, do not reimplement) — quality/determinism
`OrkyOscParser` MUST locate marker boundaries by calling the shared `scanOsc(buf, ORKY_OSC, onBody)`,
exactly as `Osc133Parser` and `CwdParser` do — it MUST NOT reimplement the accumulate / find-prefix /
locate-terminator / slice-body / trim-carryover loop. Because `ORKY_OSC` ends at the first `;`, `scanOsc`
returns the JSON payload as the body and the first-`;`-only split is inherited, not re-coded. Only the
per-payload decode (REQ-008) and the bounded-ceiling guard (REQ-006) are new.
**Acceptance:** the parser source imports and calls `scanOsc` and contains no independent
`indexOf('\x07')` / `indexOf('\x1b\\')` terminator-scanning loop; a code/structure check confirms it
mirrors the `Osc133Parser`/`CwdParser` shape (single internal buffer, `push` delegating to `scanOsc`).

### REQ-003 — Chunk-boundary carry-over preserved exactly (determinism)
Feeding a marker to `push` in arbitrary chunk splits — including splits **inside the prefix**, inside the
payload, and immediately before the terminator — MUST yield exactly the same heartbeat(s), exactly once
each, as feeding the whole marker in one chunk. A partial (un-terminated) marker MUST be buffered and MUST
NOT emit until its terminator arrives; a buffered partial MUST NOT be emitted twice.
**Acceptance:** for the worked-example awaiting-human marker, splitting it at **every** byte offset
`0..len` and feeding the two parts in order yields a single heartbeat equal to the whole-chunk result in
every case; feeding only `\x1b]9999;{"v":1,"feature":"auth-login"` (no terminator) yields `[]` and leaves
the parser able to emit the full heartbeat once the remaining bytes + terminator arrive in a later `push`.

### REQ-004 — Thin client: direct mapping, never re-deriving `drive()` semantics (security)
Payload decoding MUST be a strict validated parse with NO `eval` / `Function` / dynamic interpretation.
The parser MUST treat `needsHuman`, `reason`, `phase`, and `gate` as **already-computed ground truth from
Orky** and map them directly — it MUST NOT re-derive gate counting, phase frontier, needs-human, or any
other pipeline logic from the bytes (Termhalla is a thin client; Orky's `drive()` is the sole authority,
the same "ground truth, not self-report" discipline as elsewhere in the pipeline).
**Acceptance:** a source scan of the decode path finds no `eval`/`Function`/`new Function`; the decoded
`needsHuman`/`reason`/`phase`/`gate` values are taken verbatim from the payload (a heartbeat whose
`needsHuman` is `true` but whose phase/gate would *not* imply needs-human under 0004's own gate logic
still reports `needsHuman===true` — the parser does not "correct" Orky's verdict).

### REQ-005 — Forward-compatible, NOT fail-closed, on version + unknown fields (deliberate reversal)
An unknown or missing `v`, and any unknown extra JSON fields, MUST NOT cause a parse failure: the parser
ignores unknown fields and tolerates a missing/older/newer `v` gracefully, decoding the fields it
understands. This is a **deliberate reversal** of the prior iteration's strict `v !== '1' → reject-whole`
policy (which devils-advocate flagged as a version-blackout risk, FINDING-DA-003) — this REQ resolves
DA-003: a future `v: 2` payload that still carries the known fields keeps rendering rather than going dark.
**Acceptance:** `{"v":2,"feature":"auth-login","phase":"plan","gate":"2/8"}` decodes to a heartbeat (not
`[]`); a payload with `v` absent entirely (`{"feature":"auth-login","phase":"plan","gate":"2/8"}`) still
decodes; a valid payload carrying an unknown extra field (`{"v":1,"feature":"auth-login","gate":"2/8",
"phase":"plan","futureFlag":true}`) decodes and ignores `futureFlag`.

### REQ-006 — Bounded carry-over ceiling on a no-terminator stream (security, FINDING-SEC-001)
The parser's no-terminator carry-over path MUST enforce an **explicit bounded byte ceiling** and MUST NOT
rely on `scanOsc`'s carry-over alone — `scanOsc` returns the *entire* accumulated buffer once the prefix
appears but no terminator follows, which is unbounded and (in the privileged Electron main process) a
memory-exhaustion DoS. After each `push`, if the retained pending buffer exceeds a fixed ceiling
(`MAX_PENDING_BYTES`, a documented constant strictly greater than the longest possible legal marker =
`ORKY_OSC` + the payload byte cap of REQ-007 + terminator, so no in-flight valid marker is ever dropped),
the parser MUST discard/reset the pending buffer rather than keep accumulating. No silent capping of a
*valid* in-flight marker (CONV-003): the ceiling only ever drops a stream that has already exceeded any
legal marker length.
**Acceptance:** pushing the bare prefix `\x1b]9999;` followed by many MiB of non-terminating data (in
chunks) does not throw, emits nothing, and leaves the parser's retained buffer bounded at `≤
MAX_PENDING_BYTES` (asserted directly, not merely "no throw"); a legitimate marker whose total length is
`≤ ORKY_OSC + payload-cap + terminator`, fed in small chunks, still parses (the ceiling never clips it).

### REQ-007 — Payload size cap measured as actual UTF-8 byte length, before `JSON.parse` (FINDING-CODEX-001)
A maximum payload size cap MUST be enforced as the **actual UTF-8 byte length** of the raw payload bytes
pulled from the PTY buffer (e.g. `Buffer.byteLength(payload, 'utf8')`), NOT the JS string `.length`
(UTF-16 code units), and MUST be checked **before** `JSON.parse` runs (never on a derived/re-encoded
string). A payload whose UTF-8 byte length exceeds the cap (`MAX_PAYLOAD_BYTES`, a documented constant)
MUST yield no heartbeat and MUST NOT be `JSON.parse`d. No silent truncation (CONV-003): an over-cap
payload is rejected whole, not clipped.
**Acceptance:** a payload string whose `.length` (UTF-16 units) is *under* the cap but whose UTF-8 byte
length is *over* it — e.g. a `reason` padded with multi-byte characters (`"\u{1F600}"` repeats, 4 UTF-8
bytes each) — is rejected (`[]`); a unit check confirms the cap is computed via a byte-length function on
the payload string before any `JSON.parse` call.

### REQ-008 — Strict-but-tolerant JSON validation; total, never-wedging (CONV-002)
`push` MUST be total: malformed JSON, a non-object JSON payload (array / string / number / boolean /
`null`), an empty payload, an over-cap payload (REQ-007), arbitrary garbage bytes, or a malformed marker
MUST yield `[]` and MUST NEVER throw. `JSON.parse` MUST be guarded (try/catch or equivalent) so a syntax
error becomes "no heartbeat", never an exception. A rejected/garbage marker MUST NOT corrupt the
carry-over buffer: a subsequent **valid** marker in the same or a later chunk MUST still parse.
**Acceptance:** `push('garbage no markers here')` → `[]`, no throw; `push('\x1b]9999;not json\x07')` →
`[]`, no throw; `push('\x1b]9999;[1,2,3]\x07')` (valid JSON, non-object) → `[]`; `push('\x1b]9999;\x07')`
(empty payload) → `[]`; pushing a rejected marker then a valid one (`bad…\x07` + valid `…\x07`) returns the
valid heartbeat from the second.

### REQ-009 — Map a heartbeat to OrkyPaneStatus by REUSING 0004's presentation (quality)
`orkyHeartbeatToPaneStatus(hb)` MUST be total + pure and MUST produce its result by building a single
`OrkyFeatureStatus` from the heartbeat and delegating to 0004's existing `orkyPaneStatus([fs])` — so the
chip `label` (`feature · phase · gateN/gateM[ · ●k open]`), the `inPopover` filter, the chip-kind
mapping, and the empty/cleared shape are the **same logic** 0004 uses. It MUST NOT reimplement
`chipLabel`/`inPopover`/`selectChipFeature`. The field mapping is direct (REQ-004): `feature`→slug,
`phase`→live phase (a `null`/absent phase falls back to the `?? 'done'` chip **label** only — same
`chipLabel` convention 0004 uses for `gateFrontier`, so the chip never shows a literal `"null"`,
FINDING-DA-007 guard — this is a *label* fallback, NOT a `kind` derivation; see below),
`gate` `"N/M"`→`gateN`/`gateM`, `needsHuman`→`needsHuman`. Presentation-only
fields the wire does not carry default deterministically: `openBlocking` = `0` (so the label simply omits
the `· ●k open` suffix), `failed` = `false`. `kind` is derived only from the carried signal and its
done-detection is **purely gate-based, completely independent of the `phase` field's value**: a genuinely
complete Orky feature emits `phase: "doc-sync"` (`state.phase || d.phase || null`, never `null` — verified
against the real emitter `gatekeeper.js:904`; `human-review` is a separate external gate never written into
`state.json.phase`), so done-detection MUST NOT key off `phase`. The derivation is:
`needsHuman === true` → `needs-input`; else `gateN >= gateM` (all 8 work-phase gates passed) → `done`;
else `busy` (the presence of a per-feature heartbeat means the run is actively ticking). This mirrors
0004's actual gate-based `isComplete` (`human-review` gate passed), NOT 0004's *local* `phase===null`
`gateFrontier` convention, which is a Termhalla-side computation never carried on the wire. (This corrects
the prior iteration's `phase null AND gateN >= gateM` rule per the human-approved ESC-002 resolution — the
same FINDING-DA-001 bug class already fixed in 0004.)
**Acceptance:** the worked-example awaiting-human heartbeat →
`OrkyPaneStatus.kind === 'needs-input'`, `label === '0004-orky-status-awareness · human-review · 7/8'`,
`needsHuman === true`, `features.length === 1`, `chipFeature === '0004-orky-status-awareness'`; a busy
heartbeat (`{"v":1,"feature":"auth-login","phase":"implement","gate":"5/8","needsHuman":false}`) →
`kind === 'busy'`, `label === 'auth-login · implement · 5/8'`; a complete heartbeat carrying the **real
emitter's** shape for a finished feature
(`{"v":1,"feature":"auth-login","phase":"doc-sync","gate":"8/8","needsHuman":false}`) → `kind === 'done'`
and the same clean-`done` roll-up 0004 returns (excluded from the popover, `features:[]`,
`chipFeature:null`); and — proving the done-rule is gate-based and `phase`-independent either way — a
`gateN >= gateM` heartbeat whose `phase` is `null`
(`{"v":1,"feature":"auth-login","phase":null,"gate":"8/8","needsHuman":false}`) ALSO yields
`kind === 'done'` and the identical clean-`done` roll-up (the done-derivation never reads `phase`).

### REQ-010 — Synthesized feature detail is actionable (CONV-001)
The `OrkyFeatureStatus` that `orkyHeartbeatToPaneStatus` builds MUST carry a `detail` that names the
feature and a concrete reason — never a bare `"needs input"` / `"error"`. When `needsHuman` is true and a
`reason` string is present, the `detail` MUST name the feature and include the payload's `reason` string
verbatim (it is Orky's already-computed explanation, REQ-004); when `needsHuman` is true with no reason,
`detail` names the feature and states it needs a human; otherwise `detail` names the feature and its live
phase (e.g. `"<slug>: implement in progress"`, `"<slug>: pipeline complete"`).
**Acceptance:** the awaiting-human heartbeat → `features[0].detail` contains `0004-orky-status-awareness`
and the substring `human-review is a human gate`; a busy heartbeat → `detail` contains the slug and the
live phase; a needs-human heartbeat with no `reason` → `detail` contains the slug and does not render an
empty/`undefined` reason fragment.

### REQ-011 — A feature-less (app-loop) heartbeat is a valid liveness tick, not a failure
A payload with no resolvable `feature` (the app-loop tick, carrying `action` instead) MUST decode without
throwing and MUST map to the **cleared/empty** `OrkyPaneStatus` (no per-feature chip: `features: []`,
`chipFeature: null`, `kind: 'idle'`, `label: ''`). It MUST NOT be treated as a parse failure and MUST NOT
fabricate a feature chip from `action`.
**Acceptance:** `push('\x1b]9999;{"v":1,"action":"app-loop"}\x07')` returns exactly one heartbeat whose
`feature` is `null` (it parsed) and `orkyHeartbeatToPaneStatus(hb)` returns the cleared shape
(`features: []`, `chipFeature: null`, `label: ''`, `needsHuman: false`).

### REQ-012 — Second SOURCE, not a second presentation, type, or channel (quality)
The feature MUST NOT introduce a new pane-status type, a parallel renderer, or a new IPC channel for Orky
status. The stream-derived status MUST be the existing `OrkyPaneStatus` (`src/shared/types.ts`) delivered
through the existing `orky:status` push channel + 0004's renderer presentation. The parser MUST import
`OrkyPhase`/`OrkyReason` from `src/shared/types.ts` rather than redefining those literal unions (single
source of truth; REQ-016).
**Acceptance:** the diff adds no new `OrkyPaneStatus`-equivalent interface and no new `orky:*` channel;
the renderer consumes the stream-derived status via the same component path as the filesystem-derived
status.

### REQ-013 — Coexistence with 0004: filesystem source wins, no regression/duplication
For a pane whose `.orky/` tree IS filesystem-reachable, 0004's `OrkyTracker` remains authoritative and its
behavior MUST be unchanged — this feature MUST NOT modify `orky-tracker.ts`'s status derivation, duplicate
its watch, or override its output. The stream-derived status applies ONLY as a fallback for panes with no
filesystem `.orky/` source (the bare-SSH case). `selectOrkyPaneStatus(fsStatus, streamStatus)` MUST return
`fsStatus` whenever it is non-null, else `streamStatus`, else `null`.
**Acceptance:** `selectOrkyPaneStatus(fs, stream) === fs` when `fs` is non-null (for any `stream`);
`=== stream` when `fs` is null; `=== null` when both are null; a code check confirms
`src/main/orky/orky-tracker.ts`'s derivation is unchanged (no CHAR/behavior edit) and the stream parser
does not start a `.orky/` filesystem watch.

### REQ-014 — Tests are PRIMARILY synthetic/golden OSC byte fixtures (zero live-Orky dependency)
Every test that gates this feature MUST construct its OSC marker bytes itself (golden fixtures) and assert
the parser/mapper output, with zero dependency on a live Orky CLI process, the network, or a real `.orky/`
tree — this is the primary, deterministic mechanism (consistent with how `osc133-parser`/`cwd-parser` are
unit-tested). The implementer MAY **additionally** (spec-writer's call — OPTIONAL, NOT mandatory) add one
integration-style test that shells out to
`node "C:/dev/Orky/plugin/gatekeeper/cli.js" osc-heartbeat --project . --config .orky/config.json` and
feeds its real stdout through the parser, layered **on top of** (never replacing) the synthetic fixtures;
if added it MUST be skippable/guarded so the deterministic suite still passes headless without Orky present.
**Acceptance:** the gating parser/mapper tests contain literal marker byte strings + assertions only and
no `child_process`/`execFile`/`spawn`/network/Orky-CLI invocation; the suite passes headless under
`npm test` with no external process; any optional integration test is clearly isolated and skipped when
the Orky CLI is unavailable.

### REQ-015 — Scope: Termhalla parser/renderer only; Orky-side emission is REAL and shipped
This feature MUST NOT change anything in the separate `C:/dev/Orky` repository — Termhalla does not touch
that repo. The matching **emission now exists for real** (ADR-026, opt-in via `config.heartbeat.osc`,
default `false`, best-effort/never-throws/writes-nothing), superseding the prior iteration's "Orky-side
emission is out of scope / dark in production" framing. The spec/feature doc MUST state plainly that
(a) this feature's job remains the Termhalla-side parser/renderer, (b) the contract is now **final/real**
(ADR-026), not a future placeholder, and (c) the feature is **no longer "dark in production"** — once a
project opts in (`config.heartbeat.osc: true`) and Termhalla parses code `9999`, a bare-SSH pane shows
real Orky status. This is a forward-looking note for doc-sync to update the cross-repo follow-up doc.
**Acceptance:** this spec and the feature doc (REQ-016) state the emission is real/shipped (ADR-026) and
opt-in, describe the parser-only scope, and record that the feature is no longer dark once opted in; the
Termhalla code in this feature reads/parses only and emits nothing into any stream; no file under
`C:/dev/Orky` is modified by this feature.

### REQ-016 — Cross-repo contract documented prominently + drift caveat (doc-drift)
The feature doc `docs/features/orky-osc-heartbeat.md` MUST reproduce the **exact ADR-026 contract** (the
`\x1b]9999;<json>\x07` wire format + the payload schema table) as a prominent, copy-pasteable block, cite
the in-repo source file where `ORKY_OSC`/the decode is defined, and cite Orky ADR-026 as the upstream
source of truth. It MUST carry a **drift caveat**: the contract is a cross-repo agreement with
`C:/dev/Orky`; the `phase` values mirror 0004's `OrkyPhase`/Orky's pipeline phases and the `gate` total is
expected to equal `ORKY_PHASES.length` (8) — a divergence is a coordinated two-repo data-update, never
something a Termhalla test can catch (tests verify only that the Termhalla code matches THIS embedded
contract). The doc MUST be linked from the CLAUDE.md "Where things live" table (the row already exists) and
the `CHANGELOG.md [Unreleased]` section MUST record the feature; doc-sync MUST update any prior cross-repo
follow-up note to say the contract is now FINAL/real rather than a future placeholder (REQ-015).
**Acceptance:** `docs/features/orky-osc-heartbeat.md` exists, contains the exact prefix `\x1b]9999;`, the
JSON payload schema table, names the defining source file, cites Orky ADR-026, states the parser-only
scope + opt-in emission (REQ-015), and carries the cross-repo drift caveat; the CLAUDE.md table row
resolves to it; `CHANGELOG.md [Unreleased]` mentions the feature; the doc-sync gate passes. No occurrence
of the superseded `8888`/`orky=`/`key=value` contract remains anywhere in `docs/` or this feature dir.

### REQ-017 — No persistence, no writes, no schema bump
The parser/mapper MUST persist nothing, write nothing to disk or to any stream, and MUST NOT bump
`SCHEMA_VERSION`. It is a pure read of the PTY byte stream.
**Acceptance:** `SCHEMA_VERSION` is unchanged in the diff; no `fs` write / new `userData` path is
introduced; the parser modules contain no write API and emit nothing into any stream.

---

## Definition of Done — verification approach

- **Pure logic (vitest, no Electron, no `../api`):** golden-fixture unit tests for the parser
  (REQ-001/004/005/006/007/008/011), chunk-split carry-over equivalence over every byte offset (REQ-003),
  the `scanOsc`-reuse structure check (REQ-002), the bounded-ceiling assertion under a multi-MiB
  no-terminator stream (REQ-006), the byte-length-vs-`.length` cap check (REQ-007), the
  heartbeat→`OrkyPaneStatus` mapping reusing 0004's `orkyPaneStatus` with **gate-based done-detection**
  (REQ-009 — assert the `phase:"doc-sync",gate:"8/8"` complete-feature fixture renders `done`, and that a
  `phase:null,gate:"8/8"` fixture renders `done` too, so the rule is provably `phase`-independent), the
  actionable `detail` (REQ-010), the app-loop cleared shape (REQ-011), and `selectOrkyPaneStatus`
  precedence (REQ-013). Match the style of `tests/*osc133*` / `*cwd-parser*` and the existing
  `orky-status` unit tests.
- **Docs/integration:** the feature doc + ADR-026 contract block + drift caveat + scope correction
  (REQ-015/REQ-016), the CLAUDE.md table link, the CHANGELOG entry, and a check that `orky-tracker.ts` is
  unmodified and `SCHEMA_VERSION` unchanged (REQ-013/REQ-017). The optional live-Orky integration test
  (REQ-014) is layered on top of the synthetic fixtures and skipped when the CLI is unavailable.

## Open questions

None blocking. The wire contract is now Orky's authoritative ADR-026 (no longer a spec-writer placeholder);
REQ-009's done-detection is now purely gate-based per the human-approved ESC-002 resolution (no longer keyed
off `phase === null`, which never fires against the real emitter's `phase: "doc-sync"` complete-feature
shape); the only fields the wire does not carry (`openBlocking`, `failed`) are mapped to deterministic
defaults (REQ-009) rather than re-derived, consistent with the thin-client stance (REQ-004).
