# Plan — 0018-windowed-flow-control

**Phase:** 3 (plan). **Input:** `02-spec.md` (REQ-001..REQ-015), `.orky/baseline/architecture.md`
(brownfield fit), F15/F16 merged code. Smallest plan that satisfies the spec; no speculative scope.

## Target layout

```
src/shared/remote/flow-control.ts    NEW  — pure: measure, defaults, agent gate, client policy
src/shared/remote/protocol.ts        EDIT — barrel re-exports (exact enlarged surface)
src/agent/pty-backend.ts             EDIT — AgentPtyHandle gains pause()/resume()
src/agent/node-pty-backend.ts        EDIT — NodePtyProc mirror + mapping pause/resume
src/agent/fake-backend.ts            EDIT — paused queueing + deferred exit + `flood` command
src/agent/session.ts                 EDIT — gate wiring: count, ack/window handling, prune
docs/features/remote-agent.md        EDIT — flow-control section
docs/features/remote-protocol.md     EDIT — reserved-frames section gains semantics reference
CHANGELOG.md                         EDIT

tests (phase 4 writes them; named here so traceability has stable targets):
tests/remote-flow-control.test.ts        NEW  — pure module: measure/defaults/gate/policy
tests/agent-backend-flow.test.ts         NEW  — fake backend pause/resume/flood (+ node-pty structural pin)
tests/agent-session-flow.test.ts         NEW  — in-process session: stall, recovery, prune, no-reply
tests/agent-stdio-flow.test.ts           NEW  — stdio child: flood + stalled consumer + recovery
tests/agent-session.test.ts              EDIT — supersede TEST-773 inertness assertion ONLY
tests/remote-protocol-capabilities.test.ts EDIT — supersede TEST-747 export list ONLY
```

## Tasks

### TASK-001 — The pure flow-control module
**Files:** `src/shared/remote/flow-control.ts` (new)
**Deps:** none
**Satisfies:** REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-012

One pure module (TEST-745 discipline: no `node:`/`electron`/`require`/`Buffer`/`process.`/
`__dirname`; also no timers/RNG — REQ-004's scan) containing:

- `flowPayloadSize(data: string): number` — `data.length` (D1).
- `DEFAULT_FLOW_WINDOW_BYTES = 1_048_576`, `DEFAULT_ACK_EVERY_BYTES = 65_536` (D3).
- A shared positive-integer guard for construction overrides, throwing actionable errors naming
  the parameter and value (REQ-003, CONV-001).
- `createAgentFlowGate(init?: AgentFlowGateInit): AgentFlowGate` — per-pane map
  `{ unacked, paused, explicitWindow? }` + one connection default window:
  - `onDataEmitted(id, data)` creates/updates the pane entry, adds `flowPayloadSize(data)`,
    emits `pause` on the FIRST crossing of `unacked > window` only (REQ-005).
  - `onAck(id, bytes)` decrements; clamps to 0 with ONE `onDiagnostic` on over-ack; untracked id
    = silent no-op; emits `resume` when paused and `unacked <= floor(window/2)` (REQ-006, REQ-008).
  - `onWindow(size, id?)` — per-pane (tracked only; untracked = ignore + diagnostic) or
    connection default (applies to non-explicit panes now + future panes); re-evaluates every
    affected pane, possibly emitting multiple decisions (REQ-007).
  - Strict pause/resume alternation per pane enforced by the `paused` flag transitions (REQ-008).
  - `paneExited(id)` deletes the entry (unacked, paused, explicit window); `dispose()` clears
    all; `stats(id)` exposes `{ unacked, windowBytes, paused }` or `undefined` (REQ-004, REQ-009).
- `createClientAckPolicy(init?: ClientAckPolicyInit): ClientAckPolicy` — per-pane accumulator:
  `onData` returns a full-accumulation `AckFrame` at/over threshold (reset to 0) else `null`
  (zero-unit data never creates state); `flush()` returns residue acks sorted by pane id;
  `paneClosed(id)`/`dispose()` prune (REQ-012, CONV-011, CONV-036 — no timers, consumer flushes).
- Types: `FlowDecision`, `AgentFlowGateInit`, `AgentFlowGate`, `ClientAckPolicyInit`,
  `ClientAckPolicy`. `AckFrame` is imported from `./messages` (type-only, stays pure).

### TASK-002 — Barrel re-export
**Files:** `src/shared/remote/protocol.ts` (edit)
**Deps:** TASK-001
**Satisfies:** REQ-001 (barrel-only surface), Public interface (feeds REQ-014's new pin)

Re-export exactly: `flowPayloadSize`, `DEFAULT_FLOW_WINDOW_BYTES`, `DEFAULT_ACK_EVERY_BYTES`,
`createAgentFlowGate`, `createClientAckPolicy` + the five types. Update the barrel header comment
(TEST-747 reference: the flow-control API is now sanctioned, F17). Nothing else changes.

### TASK-003 — Backend interface: pause/resume
**Files:** `src/agent/pty-backend.ts` (edit)
**Deps:** none (interface-only; parallel with TASK-001)
**Satisfies:** REQ-010

Add `pause(): void` and `resume(): void` to `AgentPtyHandle` with doc comments pinning the
contract: pause stops future `onData` delivery at the source; already-delivered/buffered
stragglers may still arrive and are never dropped; both idempotent.

### TASK-004 — Real backend mapping
**Files:** `src/agent/node-pty-backend.ts` (edit)
**Deps:** TASK-003
**Satisfies:** REQ-010

Widen the `NodePtyProc` structural mirror with `pause(): void; resume(): void` and map the handle
methods directly (`pause: () => proc.pause()`, `resume: () => proc.resume()`). No other change;
the lazy dynamic-import discipline (TEST-755) is untouched.

### TASK-005 — Fake backend: paused queueing, deferred exit, `flood`
**Files:** `src/agent/fake-backend.ts` (edit)
**Deps:** TASK-003
**Satisfies:** REQ-010, REQ-011

- Add `paused` state to the closure handle. `emit()` while paused pushes to the existing
  `pendingData` queue path (one ordered queue — reuse, don't duplicate); `exit()` while paused
  defers (`pendingExit`) until resume flushes all queued data first (exit-last preserved).
  `pause()` sets the flag (no-op if set); `resume()` clears it and synchronously flushes queued
  data in order, then any deferred exit. Remains timer-free (TEST-756 survives).
- Add scripted command `flood <chunks> <chunkBytes>`: C marker; exactly `<chunks>` emissions of
  `<chunkBytes>` deterministic ASCII filler (fixed repeating pattern); `D;0`; A marker; prompt.
  Malformed/oversized args (missing, non-integer, ≤0, or chunks×chunkBytes > 16_777_216) → one
  actionable error line + `D;1` + A + prompt (the failed-command shape), handle stays alive.
  All other commands byte-unchanged (frozen 0017 vectors keep passing).

### TASK-006 — Session integration
**Files:** `src/agent/session.ts` (edit)
**Deps:** TASK-001, TASK-002, TASK-003, TASK-005
**Satisfies:** REQ-005, REQ-006, REQ-007, REQ-008, REQ-009 (session-level), REQ-013

- Construct one `createAgentFlowGate({ onDiagnostic: init.diag })` per session.
- In the pane's `onData` handler (after the liveness guard, alongside the existing
  `engine.feed` + evt send): `applyDecisions(gate.onDataEmitted(id, data))` — same payload
  string as the evt; apply = look up the pane handle and call `pause()`/`resume()`.
- Replace the inert `case 'ack': case 'window':` with `applyDecisions(gate.onAck(frame.id,
  frame.bytes))` / `applyDecisions(gate.onWindow(frame.size, frame.id))`. No reply frame either
  way.
- `paneExited` gains `gate.paneExited(id)`; session `end()` gains `gate.dispose()`.
- Update the module header comment (flow control now live; TEST-773 supersession note).

### TASK-007 — Frozen-suite supersession (tests phase, atomic with the new suites)
**Files:** `tests/agent-session.test.ts` (edit), `tests/remote-protocol-capabilities.test.ts` (edit)
**Deps:** TASK-001..TASK-006 planned surface (executed by phase 4 — the test-designer)
**Satisfies:** REQ-014

- TEST-773: replace ONLY the `'ack/window are inert'` `it` with the retirement note in the
  describe header (supersession: feature 0018, date; semantics now pinned by the F17 suites);
  sibling assertions stay verbatim.
- TEST-747: update the exact sorted export list to the Public-interface union; note the
  supersession + new sanctioned surface in the header.
- Phase 4 also writes the four NEW test files per the layout above (red until implement).

### TASK-008 — Documentation + changelog
**Files:** `docs/features/remote-agent.md`, `docs/features/remote-protocol.md`, `CHANGELOG.md`
**Deps:** TASK-001..TASK-006
**Satisfies:** REQ-015

Flow-control section in remote-agent.md (measure D1, watermarks D2, defaults D3, backend
pause/resume semantics, `flood` command, stall/recovery behavior); remote-protocol.md
reserved-frames paragraph updated (semantics landed, F17); CHANGELOG entry. CONV-008 sweep:
`grep -rn "inert\|reserved" docs/ CLAUDE.md .orky/baseline/` for stale ack/window phrasing and
reconcile every hit (baseline files are read-only context — cite, don't edit, unless a claim is
now false; expected hits are the two feature docs + remote-agent's F17 forward reference).

## Sequence

TASK-003 → TASK-001 → TASK-002 → TASK-004 → TASK-005 → TASK-006 (build stays green throughout);
phase 4 then writes TASK-007 + the new suites (red); implement makes them green; TASK-008 rides
implement (docs) per REQ-015.

## Open issues

None — every REQ maps to at least one TASK (see `traceability.md`).
