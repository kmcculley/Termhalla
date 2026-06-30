# 0014 — Orky OSC heartbeat parse + render (read)

## Phase 2 — Specification

**Status:** drafted from `00-intake.md` + `01-concept.md` (concept FROZEN — D1 binding). This feature
is **Termhalla-side only**: it defines an OSC marker **contract**, builds the Termhalla parser +
heartbeat→`OrkyPaneStatus` mapper (reusing feature 0004's presentation unchanged), and tests both
against **synthetic/golden OSC byte fixtures**. The matching emission change on the separate
`C:/dev/Orky` CLI is an explicit out-of-scope human follow-up (REQ-011).

## Concerns

`doc-provenance` `doc-drift` `security` `determinism` `quality`

- `doc-provenance` / `doc-drift` — the OSC marker is a **cross-repo contract**: Termhalla parses it
  here, a human must later emit it byte-for-byte from `C:/dev/Orky`. The two sides can silently drift.
  This is the single highest-risk drift point; the contract (REQ-001) is a first-class artifact and
  doc-sync MUST surface its exact bytes + location (REQ-012).
- `security` — the OSC body is attacker-influenceable: anything that can write to the PTY (a remote
  shell, a hostile program, `cat`-ing a crafted file) can inject these bytes. The parser is therefore
  a **strict, bounded, size-capped grammar** that never `eval`s / dynamically interprets the body and
  never derives pipeline logic from untrusted bytes — it validates against fixed enums/ranges and maps
  directly (REQ-004).
- `determinism` — `scanOsc`'s accumulate / carry-over-partial-sequence behavior across chunk
  boundaries MUST be preserved EXACTLY by **reusing the function**, not reimplementing its loop
  (REQ-002, REQ-003).
- `quality` — reuse `scanOsc` and 0004's `OrkyPaneStatus` / `orkyPaneStatus` presentation; this
  feature adds a second **source** of `OrkyPaneStatus`, never a second presentation or a forked type
  (REQ-006, REQ-008).

## Baseline fit (brownfield — `.orky/baseline/` present)

Purely additive; supersedes **no** baseline REQ.

- Baseline **REQ-004/REQ-007** (terminal status state machine; ANSI-stripped status tail) are
  **unchanged**. The new marker is an OSC sequence, so the existing `stripAnsi` already removes it from
  the ~400-char needs-input status tail (no eviction, no false "busy") — the new parser instead reads
  the **raw** byte stream, exactly as `Osc133Parser`/`CwdParser` do (REQ-002). `StatusTracker`,
  `needs-input.ts`, and CHAR-001/004 are untouched.
- Baseline **REQ-008** (cwd extraction from OSC 9;9 / OSC 7) is **unchanged**; the new prefix is
  chosen to not collide with it (REQ-001). `CwdParser` and CHAR-005 are untouched.
- Feature **0004**'s filesystem-watching `OrkyTracker` (`src/main/orky/orky-tracker.ts`) is **unchanged
  and authoritative** for panes whose `.orky/` tree is filesystem-reachable; this feature must not
  regress or duplicate that path (REQ-009).
- `SCHEMA_VERSION` is **not** bumped; the parser persists nothing and writes nothing (REQ-013).

No characterization test should need editing. If implementation finds one does, the change is not
purely additive — stop and revisit.

---

## OSC marker CONTRACT (authoritative — copy byte-for-byte to the Orky side)

> **This is the interface a human will implement on the separate `C:/dev/Orky` CLI** (REQ-011). It is
> reproduced here exactly. Any change to it is a coordinated, two-repo change. Doc-sync MUST surface
> this block and its source-file location (REQ-012).

### Full sequence

```
ESC ] 8 8 8 8 ; o r k y = <body> <terminator>
```

i.e. the exact byte string:

```
\x1b]8888;orky=<body>\x07      (BEL-terminated)
\x1b]8888;orky=<body>\x1b\\    (ST-terminated — equally valid)
```

### Prefix (exact bytes)

`\x1b ] 8 8 8 8 ; o r k y =`  →  `\x1b]8888;orky=` (12 bytes).

- OSC code `8888` is outside every OSC number known to be assigned by common terminals/tools
  (0–119 standard, 133 FinalTerm/shell-integration, 633 VS Code, 777 urxvt, 1337 iTerm2). The
  digit-token `8888` ≠ OSC `8` (hyperlinks `\x1b]8;...`) or OSC `7`/`9` (cwd), so it does NOT collide
  with `Osc133Parser` (`\x1b]133;`) or `CwdParser` (`\x1b]7;` / `\x1b]9;9;`) in this codebase, nor with
  a real terminal's hyperlink/cwd parsing.
- The mandatory literal sub-tag `orky=` is the real namespacing guarantee: even if some unknown
  terminal reused code `8888`, its body would not begin with `orky=` and would be rejected (REQ-004).
  Distinctive repeated digits make the marker easy for a human to spot in a raw byte dump.

### Terminator

`BEL` (`\x07`) **or** `ST` (`\x1b\\`) — whichever the emitter prefers; both are accepted (this is
exactly what `scanOsc` already handles). The body encoding (below) is chosen so the body can **never
itself contain** `\x07` or `\x1b`, so the first terminator byte after the prefix unambiguously ends the
marker — preserving `scanOsc`'s single-pass termination.

### Body grammar

The body (everything between `orky=` and the terminator) is a **compact, order-independent list of
`key=value` pairs joined by `;`**:

```
v=1;f=<slug>;k=<kind>;ph=<phase>;g=<int>;m=<int>;o=<int>;h=<0|1>;x=<0|1>;r=<reason>
```

| key  | meaning                | value grammar                                                              | required |
|------|------------------------|----------------------------------------------------------------------------|----------|
| `v`  | schema version         | the literal `1` (other versions are ignored — forward-compat, REQ-004)     | yes      |
| `f`  | feature slug           | `[A-Za-z0-9._-]{1,64}`                                                      | yes      |
| `k`  | kind                   | one of `busy` \| `idle` \| `needs-input` \| `done`                         | yes      |
| `ph` | live phase             | one of `OrkyPhase` (`brainstorm`…`human-review`) **or** `done`             | yes      |
| `g`  | gates passed (N)       | integer, `0 ≤ g ≤ m`                                                        | yes      |
| `m`  | total gates (M)        | integer, `1 ≤ m ≤ 32` (expected `8`; see REQ-012 drift note)               | yes      |
| `o`  | open-blocking findings | integer, `0 ≤ o ≤ 9999`                                                     | yes      |
| `h`  | needs a human          | `0` or `1`                                                                 | yes      |
| `x`  | failed (halted gate)   | `0` or `1`                                                                 | yes      |
| `r`  | needs-you reason       | one of `escalation` \| `stalled` \| `human-review`; omit/empty = none      | no       |

- Values are deliberately the **already-derived** status fields (not a `.orky/` dump): Orky computes
  them on its side and emits a heartbeat for the **currently-driving (active) feature** only. The
  Termhalla parser does no pipeline re-derivation on untrusted bytes — it validates each field against
  the table above and maps directly (REQ-004, REQ-006).
- Charset note: every legal byte above is a printable ASCII character in `[A-Za-z0-9._;=-]`; none is
  `\x07` or `\x1b`, so the body can never contain a terminator (contract invariant relied on by
  REQ-003).
- **Total body length cap: 256 bytes** and **at most 32 pairs** (REQ-004). Unknown keys are ignored
  (forward-compat); a marker missing any required key, or with any value outside its grammar, or over
  the cap, is **rejected whole** (yields no status — never a partial render).

### Worked example

```
\x1b]8888;orky=v=1;f=auth-login;k=busy;ph=implement;g=5;m=8;o=2;h=0;x=0\x07
```

decodes to the heartbeat `{ feature:'auth-login', kind:'busy', phase:'implement', gateN:5, gateM:8,
openBlocking:2, needsHuman:false, failed:false, reason:null }`, which maps (REQ-006) to an
`OrkyPaneStatus` whose `label === "auth-login · implement · 5/8 · ●2 open"` — identical to what 0004
renders for the same feature.

---

## Public interface

### New stateful parser — `src/main/status/orky-osc-parser.ts`

Structurally a **third consumer** of `scanOsc`, mirroring `Osc133Parser`/`CwdParser` (new prefix, new
body grammar):

```ts
import { scanOsc } from './osc-scanner'

export const ORKY_OSC = '\x1b]8888;orky='   // the contract prefix (REQ-001)

/** A single decoded, validated heartbeat — the strict-grammar result of one marker body. */
export interface OrkyHeartbeat {
  feature: string
  kind: 'busy' | 'idle' | 'needs-input' | 'done'
  phase: OrkyPhase | 'done'
  gateN: number
  gateM: number
  openBlocking: number
  needsHuman: boolean
  failed: boolean
  reason: OrkyReason          // 'escalation' | 'stalled' | 'human-review' | null
}

/** Stateful scanner: feed PTY output chunks, get validated heartbeats back. Keeps a small carry-over
 *  buffer (via scanOsc) so a marker split across chunks still parses (REQ-002/REQ-003). */
export class OrkyOscParser {
  private buf = ''
  push(chunk: string): OrkyHeartbeat[]   // [] for chunks with no complete, valid marker
}
```

### New pure mapper — `src/shared/orky-status.ts` (extend) or a sibling shared module

Electron-free, `../api`-free, unit-testable; reuses 0004's `orkyPaneStatus` for presentation:

```ts
/** Map ONE decoded heartbeat to the SAME OrkyPaneStatus shape feature 0004 renders, by building a
 *  single OrkyFeatureStatus and delegating to orkyPaneStatus([fs]). Total + pure. (REQ-006/REQ-007) */
export function orkyHeartbeatToPaneStatus(hb: OrkyHeartbeat): OrkyPaneStatus

/** Compose the filesystem-derived (0004) and stream-derived (0014) sources for one pane: the
 *  filesystem source wins whenever present; the stream source is used only when there is none.
 *  (REQ-009) */
export function selectOrkyPaneStatus(
  fsStatus: OrkyPaneStatus | null,
  streamStatus: OrkyPaneStatus | null
): OrkyPaneStatus | null
```

No new IPC channel, no new pane-status type: the stream-derived status flows through the existing
`orky:status` push channel and 0004's renderer presentation (REQ-008).

---

## Requirements

### REQ-001 — The OSC marker contract (prefix + body grammar) is a defined, first-class artifact
The system MUST define the marker contract EXACTLY as in the "OSC marker CONTRACT" section above: the
12-byte prefix `\x1b]8888;orky=`, a `BEL` or `ST` terminator, and the `;`-delimited `key=value` body
grammar (`v;f;k;ph;g;m;o;h;x;r`) with the stated charsets/ranges. The prefix MUST NOT collide with the
in-repo OSC prefixes `\x1b]133;` (`Osc133Parser`), `\x1b]7;`, or `\x1b]9;9;` (`CwdParser`). The body
encoding MUST be chosen so a valid body can never contain a `\x07` or `\x1b` byte.
**Acceptance:** parsing the worked-example bytes
`\x1b]8888;orky=v=1;f=auth-login;k=busy;ph=implement;g=5;m=8;o=2;h=0;x=0\x07` yields exactly one
`OrkyHeartbeat` deep-equal to `{feature:'auth-login',kind:'busy',phase:'implement',gateN:5,gateM:8,
openBlocking:2,needsHuman:false,failed:false,reason:null}`; the same body with an `\x1b\\` (ST)
terminator yields the identical result; feeding an OSC 133 (`\x1b]133;A\x07`), OSC 7, or OSC 9;9
sequence to `OrkyOscParser` yields `[]` (no cross-prefix match).

### REQ-002 — Parser is a third `scanOsc` consumer (reuse, do not reimplement) — quality/determinism
`OrkyOscParser` MUST locate marker boundaries by calling the shared `scanOsc(buf, ORKY_OSC, onBody)`,
exactly as `Osc133Parser` and `CwdParser` do — it MUST NOT reimplement the accumulate / find-prefix /
locate-terminator / slice-body / trim-carryover loop. Only the per-body decode (REQ-004) is new.
**Acceptance:** the parser source imports and calls `scanOsc` and contains no independent
`indexOf('\x07')`/`indexOf('\x1b\\')` terminator-scanning loop; a code/structure check confirms it
mirrors the `Osc133Parser`/`CwdParser` shape (single `buf` field, `push` delegating to `scanOsc`).

### REQ-003 — Chunk-boundary carry-over preserved exactly (determinism)
Feeding a marker to `push` in arbitrary chunk splits — including splits **inside the prefix**, inside
the body, and immediately before the terminator — MUST yield exactly the same heartbeat(s), exactly
once each, as feeding the whole marker in one chunk. A partial (un-terminated) marker MUST be buffered
and MUST NOT emit until its terminator arrives; a buffered partial MUST NOT be emitted twice. This is
the behavior `scanOsc` already guarantees and REQ-002 inherits.
**Acceptance:** for the worked-example marker, splitting it at **every** byte offset `0..len` and
feeding the two parts in order yields a single heartbeat equal to the whole-chunk result in every case;
feeding only `\x1b]8888;orky=v=1;f=auth-login` (no terminator) yields `[]` and leaves the parser able
to emit the full heartbeat once the remaining bytes + terminator arrive in a later `push`.

### REQ-004 — Strict, bounded, non-evaluating grammar (security)
Body decoding MUST be a strict validated parse with NO `eval` / `Function` / dynamic interpretation and
NO pipeline re-derivation from the bytes — only direct enum/range validation + mapping. It MUST enforce,
rejecting the **whole** marker (returning no heartbeat) on any violation: (a) total body length ≤ 256
bytes and ≤ 32 pairs; (b) `v` present and equal to `1` (any other/missing version → ignored); (c) every
required key (`f,k,ph,g,m,o,h,x`) present; (d) `f` matches `^[A-Za-z0-9._-]{1,64}$`; (e) `k` ∈
{`busy`,`idle`,`needs-input`,`done`}; (f) `ph` ∈ `OrkyPhase` ∪ {`done`}; (g) `g`,`m`,`o` are
non-negative integers within their ranges and `0 ≤ g ≤ m`, `1 ≤ m ≤ 32`, `o ≤ 9999`; (h) `h`,`x` ∈
{`0`,`1`}; (i) `r`, when present and non-empty, ∈ {`escalation`,`stalled`,`human-review`}. Unknown keys
are ignored (not rejected). No silent truncation/capping of a valid value (CONV-003): an over-cap or
out-of-range marker is rejected, not clamped.
**Acceptance:** a 300-byte body → `[]`; `v=2;…` → `[]`; a body missing `g` → `[]`; `f=a/b`
(slash illegal) → `[]`; `k=running` (not an enum member) → `[]`; `ph=intake` (not in `OrkyPhase`) →
`[]`; `g=9;m=8` (`g>m`) → `[]`; `o=-1` → `[]`; `r=please` → `[]`; a valid marker carrying an extra
unknown pair `z=1` still decodes (unknown key ignored); a source scan confirms no `eval`/`Function`/
`new Function` in the decode path.

### REQ-005 — Total, never-wedging tolerance of malformed/partial input (CONV-002)
`push` MUST be total: arbitrary garbage bytes, an empty body (`orky=\x07`), control-free noise, or a
malformed marker MUST yield `[]` and MUST NEVER throw. A rejected/garbage marker MUST NOT corrupt the
carry-over buffer: a subsequent **valid** marker in a later chunk MUST still parse. The parser MUST NOT
grow its buffer without bound on a stream that contains the prefix but never a terminator (it relies on
`scanOsc`'s carry-over, which retains only the pending partial sequence).
**Acceptance:** `push('garbage no markers here')` → `[]`, no throw; `push('\x1b]8888;orky=\x07')`
(empty body) → `[]`; pushing a rejected marker then a valid one (`bad…\x07` + valid `…\x07`) returns
the valid heartbeat from the second; pushing 1 MiB of the bare prefix with no terminator does not throw
and emits nothing.

### REQ-006 — Map a heartbeat to OrkyPaneStatus by REUSING 0004's presentation (quality)
`orkyHeartbeatToPaneStatus(hb)` MUST be total + pure and MUST produce its result by building a single
`OrkyFeatureStatus` from the heartbeat and delegating to 0004's existing `orkyPaneStatus([fs])` — so the
chip `label` (`feature · phase · gate N/M · ●k open`), the `inPopover` filter, the chip-kind mapping,
and the empty/cleared shape are byte-for-byte the **same logic** 0004 uses. It MUST NOT reimplement
`chipLabel`/`inPopover`/`selectChipFeature`. `phase:'done'` in the heartbeat maps to the same
`null`-phase "done" rendering 0004 produces for a complete feature (no literal `"done"`/`"null"` chip
bug — FINDING-DA-007 guard).
**Acceptance:** the worked-example busy heartbeat → `OrkyPaneStatus.kind==='busy'`,
`label==='auth-login · implement · 5/8 · ●2 open'`, `needsHuman===false`, `features.length===1`,
`chipFeature==='auth-login'`; a clean `idle` heartbeat (`k=idle;o=0;h=0;x=0`) → the same empty/idle
shape 0004 returns for an all-clean roll-up (`features:[]`, `chipFeature:null`); a `needs-input`
heartbeat with `h=1;r=human-review` → `kind:'needs-input'`, `needsHuman:true`, and the chip is included
in `features`.

### REQ-007 — Synthesized feature detail is actionable (CONV-001)
The `OrkyFeatureStatus` that `orkyHeartbeatToPaneStatus` builds MUST carry a `detail` that names the
feature and the concrete reason (mirroring 0004's actionable strings, e.g.
`"<slug>: awaiting human-review (gates 7/8) — needs you"`, `"<slug>: review gate failed"`,
`"<slug>: implement in progress"`), never a bare `"needs input"` / `"error"`.
**Acceptance:** a `h=1;r=human-review` heartbeat → `features[0].detail` contains the slug and
`human-review`; a `x=1` (failed) heartbeat → `detail` contains the slug and names the failure; a plain
`busy` heartbeat → `detail` contains the slug and the live phase.

### REQ-008 — Second SOURCE, not a second presentation or a forked type (quality)
The feature MUST NOT introduce a new pane-status type, a parallel renderer, or a new IPC channel for
Orky status. The stream-derived status MUST be the existing `OrkyPaneStatus` (`src/shared/types.ts`) and
MUST be delivered through the existing `orky:status` push channel + 0004's renderer presentation. The
parser MUST import `OrkyPhase`/`OrkyReason` from `src/shared/types.ts` rather than redefining those
literal unions (single source of truth; REQ-012).
**Acceptance:** the diff adds no new `OrkyPaneStatus`-equivalent interface and no new `orky:*` channel;
`OrkyHeartbeat.phase`/`reason` reference the shared `OrkyPhase`/`OrkyReason` types; the renderer
consumes the stream-derived status via the same component path as the filesystem-derived status.

### REQ-009 — Coexistence with 0004: filesystem source wins, no regression/duplication
For a pane whose `.orky/` tree IS filesystem-reachable, 0004's `OrkyTracker` remains authoritative and
its behavior MUST be unchanged — this feature MUST NOT modify `orky-tracker.ts`'s status derivation,
duplicate its watch, or override its output. The stream-derived status applies ONLY as a fallback for
panes with no filesystem `.orky/` source (the bare-SSH case). `selectOrkyPaneStatus(fsStatus,
streamStatus)` MUST return `fsStatus` whenever it is non-null, else `streamStatus`, else `null`.
**Acceptance:** `selectOrkyPaneStatus(fs, stream) === fs` when `fs` is non-null (for any `stream`);
`=== stream` when `fs` is null; `=== null` when both are null; a code check confirms
`src/main/orky/orky-tracker.ts`'s derivation is unchanged (no CHAR/behavior edit) and the stream parser
does not start a `.orky/` filesystem watch.

### REQ-010 — Tests use synthetic/golden OSC byte fixtures only — ZERO live-Orky dependency
Every test for this feature MUST construct its OSC marker bytes itself (golden fixtures) and assert the
parser/mapper output. No test may spawn, connect to, or otherwise depend on a live Orky CLI process,
the network, or a real `.orky/` tree. (Consistent with how `osc133-parser`/`cwd-parser` are unit-tested
today.)
**Acceptance:** the test files contain literal marker byte strings and assertions only; no
`child_process`/`execFile`/`spawn`/network/Orky-CLI invocation appears in any 0014 test; the suite
passes headless under `npm test` with no external process.

### REQ-011 — Orky-side emission is OUT OF SCOPE (documented human follow-up)
This feature MUST NOT change anything in the separate `C:/dev/Orky` repository (the emission side that
would make Orky's CLI print this marker). That work is an explicit, documented follow-up the human will
implement against this contract. Until it exists, the feature is real and tested but **dark in
production** — a bare-SSH pane running an unmodified Orky CLI shows no Orky status (same as today), never
a false one. The spec/feature doc MUST record this explicitly, with the exact contract (REQ-001) the
human must mirror.
**Acceptance:** this spec and the feature doc (REQ-012) state the Orky-side emission is out of scope and
reproduce the exact prefix + body grammar for the human to implement; the Termhalla code in this
feature reads/parses only and emits nothing into any stream.

### REQ-012 — Cross-repo contract documented prominently + drift caveat (doc-provenance/doc-drift)
A feature doc MUST be added under `docs/features/` (e.g. `orky-osc-heartbeat.md`), linked from the
CLAUDE.md "Where things live" table, and the `CHANGELOG.md [Unreleased]` section MUST record the
feature. The doc MUST reproduce the **exact contract** (prefix bytes + body grammar) as a prominent,
copy-pasteable block and cite the source file where `ORKY_OSC`/the grammar is defined, so the Orky-side
implementer (REQ-011) can mirror it byte-for-byte. The doc MUST carry a **drift caveat**: the contract
is a cross-repo agreement with `C:/dev/Orky`; the `ph`/`r` enums mirror 0004's `OrkyPhase`/`OrkyReason`
(imported, not forked — REQ-008) and Orky's pipeline phases, and the carried `m` (gateM) is expected to
equal `ORKY_PHASES.length` (8) — a divergence is a coordinated two-repo data-update, never something a
Termhalla test can catch. Tests verify only that the Termhalla code matches THIS embedded contract.
**Acceptance:** `docs/features/orky-osc-heartbeat.md` exists, is referenced from CLAUDE.md, contains the
exact prefix `\x1b]8888;orky=` and the body grammar table, names the defining source file, states the
Orky-side emission follow-up (REQ-011), and carries the cross-repo drift caveat; `CHANGELOG.md
[Unreleased]` mentions the feature; the doc-sync gate passes.

### REQ-013 — No persistence, no writes, no schema bump
The parser/mapper MUST persist nothing, write nothing to disk or to any stream, and MUST NOT bump
`SCHEMA_VERSION` (baseline REQ-024 unaffected). It is a pure read of the PTY byte stream.
**Acceptance:** `SCHEMA_VERSION` is unchanged in the diff; no `fs` write / new `userData` path is
introduced by this feature; the parser modules contain no write API.

---

## Definition of Done — verification approach

- **Pure logic (vitest, no Electron, no `../api`):** golden-fixture unit tests for the parser
  (REQ-001/004/005), chunk-split carry-over equivalence over every byte offset (REQ-003), the
  `scanOsc`-reuse structure check (REQ-002), the heartbeat→`OrkyPaneStatus` mapping reusing 0004's
  `orkyPaneStatus` (REQ-006), the actionable `detail` (REQ-007), `selectOrkyPaneStatus` precedence
  (REQ-009), and the synthetic-only constraint (REQ-010). Match the style of
  `tests/*osc133*`/`*cwd-parser*` and the existing `orky-status` unit tests.
- **Docs/integration:** the feature doc + contract block + drift caveat (REQ-012), the CLAUDE.md table
  link, and a check that `orky-tracker.ts` is unmodified and `SCHEMA_VERSION` unchanged
  (REQ-009/REQ-013). Wiring the stream-derived status into the live `pty:data` → `orky:status` path
  reuses 0004's channel/presentation and is exercised by feeding synthetic bytes (REQ-010), never a
  live Orky process.

## Open questions

None blocking. The OSC prefix (`8888`) and body grammar were a spec-writer decision per D1's guidance;
both are internally consistent and documented precisely enough (REQ-001/REQ-012) for the human to mirror
on the Orky side.
