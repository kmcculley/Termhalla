# Traceability — 0018-windowed-flow-control

Human-readable rendering of `traceability.json` (phase 3 REQ→TASK; phase 4 filled the tests).

| REQ | Requirement (short) | Tasks | Tests | Files |
|---|---|---|---|---|
| REQ-001 | One pure shared module behind the barrel; guards survive | TASK-001, TASK-002 | TEST-781, TEST-747 | src/shared/remote/flow-control.ts, src/shared/remote/protocol.ts |
| REQ-002 | The single shared measure `flowPayloadSize` | TASK-001 | TEST-779 | src/shared/remote/flow-control.ts |
| REQ-003 | Shared defaults + validated construction overrides | TASK-001 | TEST-780 | src/shared/remote/flow-control.ts |
| REQ-004 | Agent gate: per-pane unacked accounting, pure, timer-free | TASK-001 | TEST-781 | src/shared/remote/flow-control.ts |
| REQ-005 | Pause exactly once on high-watermark crossing, applied synchronously | TASK-001, TASK-006 | TEST-782, TEST-791 | src/shared/remote/flow-control.ts, src/agent/session.ts |
| REQ-006 | Ack: decrement, over-ack clamp + diagnostic, unknown-pane tolerance | TASK-001, TASK-006 | TEST-783, TEST-792 | src/shared/remote/flow-control.ts, src/agent/session.ts |
| REQ-007 | Window frames: per-pane override + connection-wide default | TASK-001, TASK-006 | TEST-784, TEST-792 | src/shared/remote/flow-control.ts, src/agent/session.ts |
| REQ-008 | Hysteresis (resume at floor(window/2)); strict alternation | TASK-001, TASK-006 | TEST-785, TEST-794 | src/shared/remote/flow-control.ts, src/agent/session.ts |
| REQ-009 | Lifecycle pruning on pane exit / dispose (CONV-011) | TASK-001, TASK-006 | TEST-786, TEST-793 | src/shared/remote/flow-control.ts, src/agent/session.ts |
| REQ-010 | Backend pause/resume: interface, node-pty mapping, fake modeling | TASK-003, TASK-004, TASK-005 | TEST-788, TEST-790 | src/agent/pty-backend.ts, src/agent/node-pty-backend.ts, src/agent/fake-backend.ts |
| REQ-011 | Fake backend `flood` command (deterministic, validated args) | TASK-005 | TEST-789 | src/agent/fake-backend.ts |
| REQ-012 | Client ack policy: ack every N KB, flush, prune, no timers | TASK-001 | TEST-787 | src/shared/remote/flow-control.ts |
| REQ-013 | Session integration: semantics, bounded under stall, recovery | TASK-006 | TEST-791..TEST-795 | src/agent/session.ts |
| REQ-014 | Frozen-suite supersession (TEST-773, TEST-747), enumerated | TASK-007 | TEST-747, TEST-773 (superseded in place) | tests/agent-session.test.ts, tests/remote-protocol-capabilities.test.ts |
| REQ-015 | Gate folding unchanged + docs + changelog | TASK-008 | TEST-796 | docs/features/remote-agent.md, docs/features/remote-protocol.md, CHANGELOG.md |

Every REQ has ≥1 TASK and ≥1 TEST; no uncovered requirements.
