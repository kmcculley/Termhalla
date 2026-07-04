# Spec — 0018-windowed-flow-control

**Phase:** 2 (spec). **Inputs:** `00-intake.md` (roadmap entry F17 verbatim + locked decisions,
human-confirmed 2026-07-04), `.orky/conventions.md`, `.orky/baseline/` (adopted brownfield repo),
F15's merged artifacts (`src/shared/remote/`, `docs/features/remote-protocol.md`), F16's merged
artifacts (`src/agent/`, `docs/features/remote-agent.md`, its frozen suite). No `01-concept.md` —
app-run mode: the concept was fixed at roadmap time.

## Concerns

`["networking", "determinism", "performance"]`

(`networking` — this feature defines end-to-end backpressure semantics between two protocol
endpoints, including peer-stall behavior. `determinism` — every CI assertion path runs through the
deterministic fake backend and pure state machines; no time, no RNG (the fake backend's TEST-756
no-timer pin survives). `performance` — the feature's whole point is a resource bound: agent
memory stays bounded under an output flood with a slow or stalled client; the spec pins the bound
and tests assert it. Always-on lenses per config: security, quality, devils-advocate.
`data-provenance` is NOT tagged: no bundled external reference data — every pinned constant is
this feature's own design decision, recorded here.)

## Scope summary

Give F15's reserved `ack`/`window` frames their semantics on BOTH sides of the wire (locked
decision 4 — day-one, protocol-level backpressure; the cat-a-huge-file problem):

1. **One pure shared flow-control module** (`src/shared/remote/flow-control.ts`, exported only via
   the `@shared/remote/protocol` barrel) defines the single payload measure, the default window
   and ack-cadence constants, the **agent-side flow gate** (per-pane unacked accounting →
   `pause`/`resume` decisions with hysteresis), and the **client-side ack policy** ("ack every
   N KB"). Both endpoints consume the SAME module, so the two sides can never disagree on the
   measure.
2. **Agent integration** (`src/agent/`): the session counts every `pty:data` evt it emits, applies
   gate decisions by calling the new `pause()`/`resume()` on the pane's backend handle, and
   replaces F16's deliberately-inert `case 'ack': case 'window':` branch with real handling. The
   real backend maps pause/resume onto node-pty's own `pause()`/`resume()`; the deterministic fake
   backend models them with synchronous queue-while-paused semantics and gains a scripted `flood`
   command so CI can produce a cat-a-huge-file flood.
3. **Proof under flood and stall**: in-process session tests plus a stdio integration test through
   the established on-demand-bundle harness (real artifact, plain Node, `--pty=fake`), covering a
   scripted flood with a deliberately stalled consumer (no acks → bounded emission, session stays
   responsive) and recovery (acks arrive → resume to completion with full data integrity).

The running Electron app's behavior stays byte-identical: nothing under `src/main/`,
`src/preload/`, or `src/renderer/` imports the protocol or the agent (F15's TEST-746 scope guard
SURVIVES unchanged). No new capabilities, no handshake change, no frame-shape change.

## Baseline note (brownfield fit)

No baseline `REQ-` in `.orky/baseline/inferred-spec.md` is superseded; no characterized behavior
changes; no `SCHEMA_VERSION` change; no IPC contract change. The feature deliberately supersedes
two of the epic's OWN frozen scope-guard assertions through the tests phase, exactly as their
headers prescribe (CONV-019): TEST-773's ack/window-inertness assertions
(`tests/agent-session.test.ts`, frozen by 0017 — its header names F17 as the retiring feature) and
TEST-747's exact barrel-export list (`tests/remote-protocol-capabilities.test.ts`, frozen by 0016
— its header calls a flow-control semantics API "that is F17's"). See REQ-014 for the exhaustive
collision enumeration and the grep evidence (CONV-023).

## Design decisions (normative, with rationale)

- **D1 — The measure is UTF-16 code units** of the `pty:data` payload string:
  `flowPayloadSize(data) === data.length`. Rationale: O(1), environment-pure (TEST-745 forbids
  `Buffer` in `src/shared/remote/`; a `TextEncoder` pass per chunk buys nothing), and — because
  BOTH sides import the same function — symmetric by construction. The F15 frame field name
  `bytes` is frozen on the wire and is retained; for ASCII-dominant terminal output code units and
  bytes coincide, and the bound only needs proportionality, not byte-exactness. This meaning is
  documented at the `AckFrame`/`WindowFrame` doc comments and in the feature doc.
- **D2 — Watermark hysteresis, not a single threshold.** Pause when `unacked > window` (high
  watermark); resume when `unacked <= floor(window / 2)` (low watermark, "drained"). A
  resume-at-exactly-zero rule would DEADLOCK against any quantized acker (a client acking in
  N-KB quanta can leave a permanent sub-quantum residue); a resume-at-window rule would thrash
  pause/resume once per chunk at the boundary. Hysteresis guarantees ≥ `window - floor(window/2)`
  units of forward progress per resume cycle.
- **D3 — Defaults**: `DEFAULT_FLOW_WINDOW_BYTES = 1_048_576` (1 MiB) and
  `DEFAULT_ACK_EVERY_BYTES = 65_536` (64 KiB). A 16:1 window:cadence ratio tolerates ack latency
  without brushing the high watermark in normal operation; 1 MiB per pane bounds agent-side
  outbound buffering to an amount irrelevant on any host that can run a shell, while 64 KiB keeps
  ack traffic negligible (one tiny frame per 64 KiB of output).
- **D4 — Over-ack clamps to zero and is diagnosed.** `bytes > unacked` indicates a client bug or
  measure drift; clamping self-heals the accounting, and the stderr diagnostic (naming pane id,
  acked bytes, and outstanding count — CONV-001) makes it observable rather than a silent cap
  (CONV-003). Acks for unknown panes are **silently ignored**: an ack racing a pane's exit is a
  NORMAL interleaving (the client acks data before learning of the exit), and diagnosing each
  would spam stderr on every pane close under load. A `window` frame for an unknown pane IS
  diagnosed (windows are one-shot configuration, not a continuous stream — a stray one indicates
  a bug worth surfacing) and never stored: storing windows for not-yet-live panes would let a
  client grow agent memory without bound — the exact failure mode this feature exists to prevent.
- **D5 — Flow control never drops or reorders data.** Pause stops FUTURE production at the source
  (node-pty stops reading the pty; the kernel buffer backpressures the child — that is where
  "cat" blocks). Every chunk the backend delivers is forwarded, counted, and fed to status
  detection exactly as in F16. The deterministic bound asserted in CI (fake backend): once paused,
  a pane emits nothing further until resume, so `unacked ≤ window + (the crossing chunk's size)`.
  The real backend may deliver a bounded number of already-read straggler chunks after `pause()`
  returns; they are forwarded and counted too (bound: kernel/socket slack, not CI-assertable —
  Linux-only per locked decision 9).

## REQ-001 — Placement and purity: ONE pure shared flow-control module behind the barrel

The flow-control semantics MUST live in a single new pure module `src/shared/remote/flow-control.ts`,
re-exported ONLY via the `@shared/remote/protocol` barrel. It MUST satisfy the existing purity
constraints (TEST-745: no `node:`/`electron` imports, no `require()`, no `Buffer`, no `process.`,
no `__dirname`) and MUST NOT change any F15 frame shape or validation rule (`messages.ts`,
`framing.ts`, `handshake.ts`, `correlation.ts`, `capabilities.ts`, `errors.ts` stay
byte-compatible: every existing frozen F15 vector still passes). Agent code MUST consume it only
through the barrel (TEST-752's `/protocol`-specifier pin survives). Nothing under `src/main/`,
`src/preload/`, or `src/renderer/` may import it (TEST-746 survives unchanged — the client-side
policy has no production consumer until F21).

**Acceptance:** structural test: `src/shared/remote/flow-control.ts` exists; the TEST-745 purity
walk still passes over the enlarged directory; every `shared/remote` import specifier under
`src/agent/` ends with `/protocol`; the TEST-746 tree scan still returns zero offenders. All
pre-existing F15 suites (`remote-protocol-*.test.ts`) pass unmodified except the TEST-747 export
pin superseded per REQ-014.

## REQ-002 — The single shared measure: `flowPayloadSize`

The module MUST export `flowPayloadSize(data: string): number` returning the UTF-16 code-unit
length of `data` (D1), and BOTH state machines (REQ-004, REQ-012) MUST derive every count from it
by accepting the raw payload string (never a caller-computed size), so a divergent measure between
the two sides is impossible by construction.

**Acceptance:** unit vectors: `flowPayloadSize('') === 0`; `flowPayloadSize('abc') === 3`;
`flowPayloadSize('a\u{1F600}')` (non-BMP emoji) `=== 3` (surrogate pair counts 2 — boundary
documented, CONV-002); a multi-KB ASCII string returns its length. API-shape check: the gate's
data entry point and the policy's data entry point accept the payload STRING (feeding the same
string to both yields identical accounting, asserted via their observable state).

## REQ-003 — Shared defaults, construction-time overrides

The module MUST export integer constants `DEFAULT_FLOW_WINDOW_BYTES = 1_048_576` and
`DEFAULT_ACK_EVERY_BYTES = 65_536` (D3). `createAgentFlowGate` MUST accept an optional
`defaultWindowBytes` override and `createClientAckPolicy` an optional `ackEveryBytes` override;
each MUST throw a specific, actionable error (CONV-001, naming the parameter and the received
value) on a non-positive-integer override. There MUST be exactly one source for each default —
no second parameter that can silently shadow it (CONV-006); the runtime window override arrives
only via `window` frames (REQ-007).

**Acceptance:** unit: the exported constants have exactly these values; a gate constructed with no
overrides reports `stats(id).windowBytes === DEFAULT_FLOW_WINDOW_BYTES` for a tracked pane;
`createAgentFlowGate({ defaultWindowBytes: 0 })`, `(-1)`, `(1.5)`, and (`NaN`) each throw with a
message naming `defaultWindowBytes` and the offending value; same matrix for `ackEveryBytes`.

## REQ-004 — Agent flow gate: per-pane unacked accounting

`createAgentFlowGate(init?)` MUST return a pure state machine that tracks, per pane id, the count
of unacknowledged payload units. `onDataEmitted(id, data)` MUST add `flowPayloadSize(data)` to the
pane's unacked count (creating the pane's entry on first use), and `stats(id)` MUST expose
`{ unacked, windowBytes, paused }` for a tracked pane and `undefined` for an untracked one. The
gate holds NO timers and performs NO IO — decisions are RETURN VALUES (`FlowDecision[]`), and
diagnostics go through an injected optional `onDiagnostic(text)` callback (pure-module discipline;
the agent wires it to stderr).

**Acceptance:** unit: three `onDataEmitted('a', <1000 units>)` calls yield
`stats('a').unacked === 3000`; panes `'a'` and `'b'` account independently; `stats('zzz')` is
`undefined`; no `setTimeout`/`setInterval`/`Date`/`Math.random` reference appears in
`flow-control.ts` (the same scan discipline as TEST-756, now applied to this module).

## REQ-005 — Pause: crossing the high watermark emits exactly one pause decision

When a pane's unacked count first EXCEEDS its effective window (`unacked > window`, D2),
`onDataEmitted` MUST include `{ id, action: 'pause' }` in its returned decisions — exactly once
per crossing: further data while already paused MUST NOT emit additional pause decisions (still
counted, per D5's no-drop rule). The agent session (REQ-013) MUST apply the decision by calling
`handle.pause()` synchronously, within the same data-delivery callback that crossed the watermark.

**Acceptance:** unit (gate): with window 100, feeding 60+60 units returns `[]` then
`[{id,'pause'}]`; a third feed returns `[]` and `stats().unacked === 180` with `paused === true`.
Session-level: with a spied fake-backend handle, a flood crossing the window calls `pause()`
exactly once, before the session returns from the delivering callback (spy order:
final `pty:data` evt send for the crossing chunk and `pause()` both happen synchronously; no
further `pty:data` for that pane follows until resume).

## REQ-006 — Ack: decrement, over-ack clamp + diagnostic, unknown-pane tolerance

`onAck(id, bytes)` MUST subtract `bytes` from the pane's unacked count. If `bytes` exceeds the
outstanding count, the count MUST clamp to 0 AND the gate MUST emit one diagnostic through
`onDiagnostic` naming the pane id, the acked amount, and the outstanding amount (D4, CONV-001,
CONV-003 — never a silent cap). An ack for an untracked pane MUST be ignored: no state change, no
decision, no diagnostic, no reply frame, and the session MUST NOT shut down (D4's documented
ack-after-exit race). Wire-level validation of `bytes` (positive integer) remains F15's parser's
job and is NOT re-implemented.

**Acceptance:** unit: unacked 5000, `onAck(id, 2000)` → `stats().unacked === 3000`, no
diagnostic; `onAck(id, 99_999)` → unacked 0 and exactly one diagnostic containing the pane id,
`99999`, and `3000`; `onAck('ghost', 10)` → returns `[]`, no diagnostic, gate state unchanged.
Session-level: after a pane exits, a late `ack` frame for it produces no outbound frame, no
stderr line, and the session still services other panes.

## REQ-007 — Window frames: per-pane override and connection-wide default

`onWindow(size, id?)` MUST implement the F15-documented meaning ("the unacked-byte window; `id`
absent = connection-wide default"):

- **With `id`:** if the pane is tracked, set THAT pane's window to `size`; if untracked, ignore
  the frame entirely (no stored state — D4's memory-growth defense) and emit one diagnostic
  naming the pane id and size.
- **Without `id`:** set the connection default. The new default MUST apply immediately to every
  tracked pane that has NOT received an explicit per-pane window, and to all future panes. A
  pane's explicit per-pane window MUST survive later connection-default changes.

Every window change MUST re-evaluate affected panes immediately and MAY emit decisions for
several panes at once: shrinking below a pane's current unacked count emits `pause` for it (if
not already paused); growing so that a paused pane's unacked count is at or below the NEW low
watermark emits `resume`.

**Acceptance:** unit: (a) per-pane: pane at unacked 500/window 1000; `onWindow(400, id)` →
`[{id,'pause'}]` and `stats(id).windowBytes === 400`. (b) connection-wide: two panes, one with an
explicit window; `onWindow(64)` (no id) changes only the non-explicit pane's `windowBytes`.
(c) growth resume: paused pane, unacked 180, `onWindow(400, id)` → `[{id,'resume'}]` (180 ≤ 200).
(d) untracked id: `onWindow(64, 'ghost')` → `[]`, one diagnostic containing `ghost`, and
`stats('ghost') === undefined`. (e) `size = 1` edge: low watermark `floor(1/2) = 0` — resume then
requires full drain to 0 (documented boundary, CONV-002).

## REQ-008 — Hysteresis: drained means the low watermark; transitions strictly alternate

While a pane is paused, `onAck`/`onWindow` MUST emit `{ id, action: 'resume' }` exactly when the
pane's unacked count first becomes ≤ `floor(window / 2)` (D2). Per pane, emitted decisions MUST
strictly alternate pause → resume → pause …; the gate MUST NOT emit a redundant pause while
paused or a resume while flowing. Progress: a resumed flood MAY immediately re-cross the high
watermark and re-pause, but each pause→resume cycle forwards at least
`window - floor(window/2)` units.

**Acceptance:** unit: window 100; feed 120 (pause at >100); `onAck(id, 50)` → unacked 70 > 50 →
`[]`; `onAck(id, 20)` → unacked 50 = low watermark → `[{id,'resume'}]`; feeding 60 more → pause
again. The full decision log for a scripted 10-cycle flood/ack interleaving alternates strictly.
Session-level (REQ-013's flood-with-acks case): fake-handle spy sees `pause,resume,pause,resume…`
with never two same-kind calls in a row for a pane.

## REQ-009 — Lifecycle pruning (CONV-011): pane exit and gate disposal

`paneExited(id)` MUST remove ALL per-pane flow state (unacked count, paused flag, and any
explicit per-pane window) so a later pane REUSING the id starts fresh under the
connection-default window, and late `ack`/`window` frames for the departed id take the
untracked-pane paths of REQ-006/REQ-007. `dispose()` MUST clear all per-pane state. The agent
session MUST call `paneExited` on the pane-exit funnel (both self-exit and kill-initiated) and
MUST drop all flow state on session end. The client policy's `paneClosed(id)`/`dispose()` MUST
prune identically on its side.

**Acceptance:** unit: pane with unacked 5000 + explicit window 64 → `paneExited(id)` →
`stats(id) === undefined`; re-tracking the same id shows `windowBytes` = the connection default
and `unacked` = fresh count. Session-level: spawn → flood to pause → `pty:kill` → the pane's exit
evt arrives; a NEW spawn with the SAME id floods and pauses at the default window (not the old
per-pane one); late acks for the old incarnation arriving BEFORE the new spawn are ignored
silently.

## REQ-010 — Backend surface: `pause()`/`resume()` on `AgentPtyHandle`, mapped and modeled

`AgentPtyHandle` (`src/agent/pty-backend.ts`) MUST gain `pause(): void` and `resume(): void`.
The node-pty backend MUST map them directly onto the underlying process handle's own
`pause()`/`resume()` (widening the `NodePtyProc` structural mirror; the lazy dynamic-import
discipline of TEST-755 is untouched). The fake backend MUST implement them deterministically:
while paused, the handle delivers NO `onData` callbacks — output produced by `write()`s processed
while paused is QUEUED in order; `resume()` flushes the queue synchronously in order, then
delivery returns to normal. A scripted `exit` processed while paused MUST defer its exit callback
until after resume has flushed all queued output (preserving F16's exit-last ordering, REQ-010 of
0017). `pause()` while already paused and `resume()` while flowing MUST be no-ops. The fake
backend MUST remain timer-free (TEST-756's scan survives).

**Acceptance:** unit (fake backend): write `echo one`; `pause()`; write `echo two` → no delivery;
`resume()` → queued output for `two` arrives in order after `one`'s; double-`pause()` /
double-`resume()` change nothing. Exit-deferral: `pause()`, write `exit 3` → no exit callback;
`resume()` → all queued output, THEN exit(3). Structural: `node-pty-backend.ts` contains
`pause` and `resume` mappings on the proc mirror; `fake-backend.ts` still passes the
no-timer/no-RNG scan.

## REQ-011 — Fake backend `flood` command: the deterministic cat-a-huge-file

The fake backend's scripted shell MUST gain the command `flood <chunks> <chunkBytes>`: emit the C
marker, then exactly `<chunks>` separate data emissions of exactly `<chunkBytes>` ASCII filler
units each (deterministic content — a fixed repeating pattern; no randomness), then `D;0`, the A
marker, and the prompt, all subject to the pause queueing of REQ-010. Malformed arguments
(missing, non-integer, non-positive, or > a documented per-command safety bound of
16_777_216 total units) MUST take the existing unknown/failed-command shape with an actionable
message (CONV-001) and `D;1` — never a silent partial flood (CONV-003). Every OTHER existing
scripted command's behavior is byte-unchanged (the frozen 0017 fake-backend vectors, including
the `frobnicate now` unknown-command vector, still pass).

**Acceptance:** unit: `flood 4 1000` delivers exactly 4 data emissions of length 1000 between the
C marker and `D;0` (total 4000 units, order stable across runs); `flood 0 100`, `flood 2 -5`,
`flood a b`, and a > bound request each produce one actionable error line + `D;1` and leave the
handle alive; the 0017 fake-backend suite passes unmodified.

## REQ-012 — Client ack policy: ack every N KB, consumer-driven flush, no timers

`createClientAckPolicy(init?)` MUST return a pure policy with:

- `onData(id, data)`: accumulate `flowPayloadSize(data)` per pane; when the accumulation reaches
  or exceeds `ackEveryBytes`, RETURN a well-formed `AckFrame` `{ type: 'ack', id, bytes }`
  acknowledging the ENTIRE accumulation (resetting it to 0) — otherwise return `null`. Every
  returned frame MUST pass F15's `parseWireMessage` (positive-integer `bytes`).
- `flush()`: return residue `AckFrame`s (one per pane with a non-zero accumulation, deterministic
  order — sorted by pane id) and reset them; `[]` when nothing is pending. WHEN to flush belongs
  to the consumer (F21's transport later, tests now) — the policy holds NO timers and makes no
  wall-clock promises (CONV-036's composition-root rule).
- `paneClosed(id)` / `dispose()`: prune per REQ-009. `onData` for an empty string (`0` units)
  MUST NOT create pane state.

**Acceptance:** unit: with `ackEveryBytes: 100`, three `onData(id, <40 units>)` calls return
`null, null, {type:'ack',id,bytes:120}`; a following 40-unit chunk returns `null` and `flush()`
returns `[{type:'ack',id,bytes:40}]` then `[]`; two panes accumulate independently and `flush()`
returns both, sorted; `onData(id, '')` returns `null` and `flush()` stays `[]`;
every returned frame round-trips `parseWireMessage` OK.

## REQ-013 — Session integration: semantics replace inertness; bounded under stall; recovers

The agent session MUST construct one flow gate per session (wiring `onDiagnostic` to stderr) and:

- count every emitted `pty:data` evt via `onDataEmitted` (the same payload string it sends),
  applying returned decisions to the pane's handle (`pause()`/`resume()`);
- handle inbound `ack` frames via `onAck` and `window` frames via `onWindow` (replacing F16's
  inert branch), applying decisions the same way;
- call `paneExited` on the exit funnel and clear the gate on session end (REQ-009);
- emit NO reply frame for `ack`/`window` (they are fire-and-forget; the wire stays
  request/response + push + flow, exactly F15's taxonomy).

End-to-end, with the fake backend:

- **Stalled consumer (in-process AND over stdio):** small window (via a connection-wide `window`
  frame), `flood` producing several× the window, ZERO acks → the pane's total emitted `pty:data`
  units are ≤ window + one chunk (D5's deterministic bound); the session REMAINS RESPONSIVE: a
  second pane spawns, echoes, and kills normally while the first stays paused; the agent process
  neither exits nor errors, and a clean stdin end still shuts down with exit 0 (F16 REQ-013
  taxonomy preserved).
- **Recovery / integrity:** the client then acks (policy-driven) → flow resumes (possibly in
  multiple pause/resume cycles, REQ-008) until the flood completes: the concatenated `pty:data`
  payloads contain the FULL flood byte-for-byte (no drop, no reorder, no duplication), followed
  by `D;0`.

The stdio variant MUST run through the established on-demand-bundle harness
(`vite.agent.config.ts` scratch build, plain Node child, `--pty=fake`, F15 client machinery) —
no `out/` dependency, no real node-pty, no ssh (locked decision 1). Timing discipline
(determinism): "no further data" is asserted behind a same-channel BARRIER (e.g. the second
pane's completed echo round-trip), never a bare sleep.

**Acceptance:** the two scenarios above, each asserted at BOTH levels (in-process session harness;
stdio child harness), plus: `ack`/`window` frames produce no `res` frame; a `window` frame
arriving pre-handshake still fails the handshake exactly as F15's frozen handshake test pins
(unchanged behavior).

## REQ-014 — Frozen-suite supersession, enumerated and atomic (CONV-019, CONV-012, CONV-022, CONV-023)

The tests phase MUST atomically retire/supersede exactly these two frozen assertions, updating
each header to record the supersession (feature id + date), and MUST NOT weaken any other frozen
assertion:

- **TEST-773** (`tests/agent-session.test.ts`, frozen by 0017): the `'ack/window are inert'`
  assertion is REPLACED by the REQ-013 semantics (its sibling assertions — wrong-direction
  frames, per-frame recovery, fatal taxonomy — survive verbatim).
- **TEST-747** (`tests/remote-protocol-capabilities.test.ts`, frozen by 0016): the exact
  runtime-export list of `@shared/remote/protocol` is UPDATED to the enlarged surface (Public
  interface below) — still an exact, sorted list, so scope stays mechanically pinned for F18+.

**Collision enumeration (CONV-023):** claimed exhaustive by these repo-wide greps at spec time —
`grep -rn "type: 'ack'\|type: 'window'\|'ack'" tests/ src/` (hits: the two suites above, plus
`remote-protocol-framing/-handshake/-messages.test.ts` which exercise ack/window only as CODEC
vectors — shapes F17 does not change — and `src/shared/remote/messages.ts`/`session.ts` sources);
`grep -rn "pause\|resume" tests/*.test.ts src/agent/ src/shared/remote/` (no agent/protocol test
pins these words today); `grep -rn "Object.keys" tests/agent-*.test.ts` (no handle-shape pin).
No other frozen test constrains this feature's surface.

**Acceptance:** after the tests phase, `npm test` is green EXCEPT the new F17 tests (red until
implementation); the diff of `tests/agent-session.test.ts` and
`tests/remote-protocol-capabilities.test.ts` touches only the enumerated assertions + headers;
every other pre-existing test file is byte-unchanged (git diff scope check at review).

## REQ-015 — Fold into the existing gates; document

The new module and tests MUST ride the existing scripts unchanged: `npm run typecheck` covers
`flow-control.ts` and the agent changes through the existing tsconfig includes; `npm test` runs
the new suites via the existing `tests/**/*.test.ts` include; `npm run build` still emits the
agent artifact (the flood/stall stdio test builds on demand as before);
`.orky/profiles/node-app.json` stays byte-unchanged (locked decision 10). Documentation MUST be
updated in the SAME feature: `docs/features/remote-protocol.md` (the reserved-frames section gains
the semantics reference), `docs/features/remote-agent.md` (flow-control section: measure D1,
watermarks D2, defaults D3, backend pause/resume, the `flood` command), and `CHANGELOG.md`
(CONV-008: grep `docs/`, `CLAUDE.md`, and `.orky/baseline/` for stale "inert"/"reserved"/"F17
gives them semantics" phrasings and reconcile every hit).

**Acceptance:** `npm run typecheck`, `npm run build`, `npm test` all exit 0 at the implement gate
with zero profile/script edits; the two feature docs contain a flow-control section naming the
defaults and the hysteresis rule; `grep -rn "inert" docs/features/remote-*.md` returns no claim
that ack/window are STILL inert (historical/superseded phrasing is reworded or explicitly dated).

## Public interface

The `@shared/remote/protocol` barrel (the ONE sanctioned surface) gains EXACTLY these runtime
exports (TEST-747's superseded pin lists the full sorted union):

```ts
// src/shared/remote/flow-control.ts (pure — TEST-745 discipline)
export const DEFAULT_FLOW_WINDOW_BYTES = 1_048_576
export const DEFAULT_ACK_EVERY_BYTES = 65_536
export const flowPayloadSize: (data: string) => number

export interface FlowDecision { id: string; action: 'pause' | 'resume' }

export interface AgentFlowGateInit {
  defaultWindowBytes?: number
  onDiagnostic?: (text: string) => void
}
export interface AgentFlowGate {
  onDataEmitted(id: string, data: string): FlowDecision[]
  onAck(id: string, bytes: number): FlowDecision[]
  onWindow(size: number, id?: string): FlowDecision[]
  paneExited(id: string): void
  dispose(): void
  stats(id: string): { unacked: number; windowBytes: number; paused: boolean } | undefined
}
export const createAgentFlowGate: (init?: AgentFlowGateInit) => AgentFlowGate

export interface ClientAckPolicyInit { ackEveryBytes?: number }
export interface ClientAckPolicy {
  onData(id: string, data: string): AckFrame | null
  flush(): AckFrame[]
  paneClosed(id: string): void
  dispose(): void
}
export const createClientAckPolicy: (init?: ClientAckPolicyInit) => ClientAckPolicy
```

New sorted runtime-export list for the superseded TEST-747 pin: `AGENT_V1_CAPABILITIES`,
`CAPABILITY_IDS`, `DEFAULT_ACK_EVERY_BYTES`, `DEFAULT_FLOW_WINDOW_BYTES`,
`DEFAULT_MAX_FRAME_BYTES`, `FRAME_HEADER_BYTES`, `ProtocolError`, `WIRE_PROTO`,
`createAgentFlowGate`, `createAgentHandshake`, `createClientAckPolicy`, `createClientHandshake`,
`createFrameDecoder`, `createRequestTracker`, `encodeFrame`, `flowPayloadSize`, `isCapabilityId`,
`parseWireMessage`.

Agent-internal surface change (not via the barrel): `AgentPtyHandle` gains
`pause(): void; resume(): void` (`src/agent/pty-backend.ts`); the fake backend's scripted shell
gains the `flood <chunks> <chunkBytes>` command (REQ-011).

## Non-goals (explicit)

- No replay / `@xterm/headless` / serialize snapshots / scrollback history-limit — F18.
- No ssh spawning, tunnel, provisioning, or version-check bootstrap — F19. No attach lease — F20.
- No renderer/main/preload wiring, no UI, no client routing — F21 (TEST-746 survives; the client
  ack policy's only consumers are tests until then).
- No frame-shape or validation change; no handshake or capability change
  (`AGENT_V1_CAPABILITIES` untouched); no new req methods or evt channels.
- No adaptive/dynamic windowing, no per-byte exactness claims (D1), no compression.
- No macOS/Windows-remote REQs or tests (decision 9); the real node-pty pause/resume mapping is
  structurally pinned, not integration-tested in CI.

## Open questions

None. The three judgment calls the roadmap left open (measure, default sizes, "drained"
threshold) are resolved as D1–D3 with recorded rationale; each is below the escalation threshold
(design-internal, reversible by a later feature without wire breakage) and is pinned by
acceptance criteria above.
