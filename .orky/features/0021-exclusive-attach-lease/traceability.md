# Traceability — 0021-exclusive-attach-lease

Human-readable rendering of `traceability.json` (REQ → TASK → TEST → files), reconciled at
doc-sync against the shipped implementation.

| REQ | Requirement (short) | Tasks | Tests | Files |
|-----|---------------------|-------|-------|-------|
| REQ-001 | Agent-side only; app untouched; frozen suites survive | TASK-002, TASK-003, TASK-005 | TEST-2101, TEST-2111 (+ frozen TEST-751/746) | session-store.ts, session.ts, session-api.ts, remote-agent-api.ts, remote-agent.md |
| REQ-002 | Lease model: one holder; holder-scoped release | TASK-002, TASK-003 | TEST-2101, TEST-2104, TEST-2113 | session-store.ts, session.ts |
| REQ-003 | Steal: displace → notify → grant, atomic, identity-blind | TASK-002 | TEST-2102, TEST-1905 (amended) | session-store.ts |
| REQ-004 | `lease:revoked` final frame; exit 0; containment; silence | TASK-003, TASK-001 | TEST-2103, TEST-2114 | session.ts, session-api.ts |
| REQ-005 | F17×F18 weld preserved across a steal | TASK-002 | TEST-2105 | session-store.ts |
| REQ-006 | In-flight attach settles inert; no agent-side byte loss | TASK-002 | TEST-2106, TEST-2107 | session-store.ts |
| REQ-007 | Deterministic total order; steal-back; run-twice | TASK-002, TASK-003 | TEST-2108, TEST-2115 | session-store.ts, session.ts |
| REQ-008 | Vocabulary: one constant, two doors; closed sets closed | TASK-001 | TEST-2111 | session-api.ts, remote-agent-api.ts |
| REQ-009 | Winner is an ordinary connection; loser sees a clean prefix | TASK-003, TASK-002 | TEST-2109 | session.ts, session-store.ts |
| REQ-010 | Owned composition/artifact unchanged | TASK-003, TASK-005 | TEST-2110 (+ frozen F16 suites) | session.ts, main.ts (unchanged) |
| REQ-011 | Sanctioned frozen amendments; typecheck red→green | TASK-005 | TEST-1905 (amended; + the three stub no-ops, type-only) | three frozen 0019 test files |
| REQ-012 | Documentation | TASK-004 | TEST-2112 | docs/features/remote-agent.md |

Review findings (all resolved in-run): FINDING-001 (MEDIUM, holder-scoped release —
TEST-2113), FINDING-002 (LOW, revocation-final under reentrant sink — TEST-2114), FINDING-003
(LOW, nested-bind newest-wins — TEST-2115).
