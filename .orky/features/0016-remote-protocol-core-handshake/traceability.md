# Traceability — 0016-remote-protocol-core-handshake

Human-readable rendering of `traceability.json` (phase 3: tasks only; phase 4 fills `tests`).

| REQ | Tasks | Tests | Files |
|---|---|---|---|
| REQ-001 Pure placement | TASK-001..007 | — | `src/shared/remote/*.ts` (all seven modules) |
| REQ-002 Zero behavior change | TASK-009 | — | (constraint — no files; guard test at phase 4) |
| REQ-003 Frame encoding | TASK-004 | — | `src/shared/remote/framing.ts` |
| REQ-004 Max frame size | TASK-004 | — | `src/shared/remote/framing.ts`, `errors.ts` |
| REQ-005 Chunking invariance | TASK-004 | — | `src/shared/remote/framing.ts` |
| REQ-006 Error taxonomy | TASK-004, TASK-001 | — | `src/shared/remote/framing.ts`, `errors.ts` |
| REQ-007 Wire vocabulary | TASK-003 | — | `src/shared/remote/messages.ts` |
| REQ-008 Handshake sequence | TASK-005 | — | `src/shared/remote/handshake.ts` |
| REQ-009 Exact version check | TASK-005 | — | `src/shared/remote/handshake.ts` |
| REQ-010 Capability vocabulary | TASK-002 | — | `src/shared/remote/capabilities.ts` |
| REQ-011 v1 advertisement | TASK-002 | — | `src/shared/remote/capabilities.ts` |
| REQ-012 Correlation | TASK-006 | — | `src/shared/remote/correlation.ts` |
| REQ-013 Flow-control shape-only | TASK-003, TASK-007 | — | `messages.ts`, `protocol.ts` |
| REQ-014 Push-event fidelity | TASK-003, TASK-004 | — | `messages.ts`, `framing.ts` |
| REQ-015 Actionable errors | TASK-001 | — | `src/shared/remote/errors.ts` |
| REQ-016 Round-trip totality | TASK-004, TASK-003 | — | `framing.ts`, `messages.ts` |
| REQ-017 Documentation | TASK-008 | — | `docs/features/remote-protocol.md` |
