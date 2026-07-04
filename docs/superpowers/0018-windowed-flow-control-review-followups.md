# 0018 windowed flow control — review follow-ups

Deferred, non-blocking findings from the 0018 review (full ledger:
`.orky/features/0018-windowed-flow-control/findings.json`). The two MEDIUMs found at review
(FINDING-001 uncontained pause/resume application; FINDING-002 fake scripted-exit-while-paused
left the shell alive for later buffered input) were fixed in the same run via a review→implement
loopback and are resolved — this doc tracks what stays open.

## Open (LOW, deliberate deferrals)

- **FINDING-003 (devils-advocate) — real-backend exit-while-paused truncates the tail.** Under
  node-pty, a pane paused at its window whose child exits fires `onExit` immediately (exit is
  signaled independent of the paused socket); the exit funnel prunes the pane and F16's liveness
  guard drops post-pause straggler data — while the fake models the friendlier
  defer-exit-behind-queued-data ordering. Inherent to F16's exit-last contract. **F18 (replay)
  must not assume a stalled pane's tail survives the child's exit**; put the truncation statement
  in F18's spec.
- **FINDING-004 (devils-advocate) — stale delta-ack after pane-id reuse.** A client that reuses a
  pane id and acks OLD-incarnation data after the new spawn decrements the NEW counter (worst
  case: one window of premature resume, or a clamp+diagnostic). Ordered-stream causality makes
  this need a lazy acker + id reuse; memory stays bounded. F21's client generates fresh ids per
  pane, which renders it unreachable — otherwise document beside D4/REQ-009.
- **FINDING-006 (networking) — ack cadence vs declared window are independently configurable.**
  A client that declares a window smaller than its `ackEveryBytes` pauses the agent and never
  crosses its own ack threshold until its consumer calls `flush()`. Deliberate v1 design
  (CONV-036: flushing is the consumer's job; the 16:1 defaults are safe). **F21's transport wiring
  must derive its cadence from any window it declares (keep it well below `floor(window/2)`) or
  flush residue when the stream goes quiet.**

## Added at the F17×F18 batch weld (2026-07-04)

- **`npm run typecheck` is red on three frozen 0019 test stubs (TS2739).** The 0018→F16 widening
  of `AgentPtyHandle` (mandatory `pause()`/`resume()`) landed in the same batch as 0019's suites,
  whose stub handles (`agent-attach-sessions.test.ts:240`, `agent-session-store.test.ts:41`,
  `agent-survival.test.ts:40`) predate it. Runtime is unaffected (stubs never cross a window;
  build + vitest fully green — vitest transforms without the project tsconfig's type-check) and it
  is NOT src-fixable (optional methods would break 0018's frozen `flowSpy` typing). Needs a
  sanctioned tests-phase touch: **route to F20's tests phase** (it already works this exact seam —
  it retires 0019's single-connection bind guard). Add `pause`/`resume` no-ops to the three stubs.
- **Flow accounting is connection-scoped across detach/reattach (weld decision, documented in
  `docs/features/remote-agent.md`).** `unbind()` resumes gate-paused backends then resets counters/
  overrides; a reattaching client starts a fresh window. The persist-counters alternative was
  rejected on evidence: pause gates the same `onData` that feeds replay (a pane paused at
  disconnect would freeze its while-away snapshot, breaking 0019's REQ-011), and persisted residue
  above `floor(window/2)` could never be acked by a fresh client (permanent wedge). Neither frozen
  suite pins the intersection; if F20/F21 specs need a different model, spec it explicitly there.

## Resolved during the run

- FINDING-001 (MEDIUM, quality) — `applyDecisions` now contains backend `pause()`/`resume()`
  throws with a stderr diagnostic (parity with the dispatch path).
- FINDING-002 (MEDIUM, quality, via the codex cross-check) — a scripted `exit` deferred by a
  pause now also sets `closing`: later buffered input is inert (real-pty fidelity) while the
  queued-data + deferred-exit delivery order is unchanged.
- FINDING-005 (LOW, quality) — promoted to **CONV-059**: a tests-phase RED verification must
  assert the failing set is exactly the feature's own suites (the TEST-384 assembled-needle
  collision was visible in the first red run and only surfaced at the implement gate).

## Process notes for the next feature in this epic

- The codex cross-check ran bounded (read-only, in-time) and its one confirmed defect
  (FINDING-002) was worth the dispatch; its flood-memory report restated the spec's accepted
  D5/REQ-011 fake-model divergence and was not filed.
- Two tests loopbacks this run: the `pty:kill` bare-string wire shape (F16 contract) and the
  CONV-059 lesson above. Both were shift-left fixes at the tests phase with the freeze
  re-captured; the implementation itself was never condemned.
