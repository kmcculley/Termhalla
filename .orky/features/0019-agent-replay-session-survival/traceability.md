# Traceability — 0019-agent-replay-session-survival

Human-readable rendering of `traceability.json` (machine-checked by the Gatekeeper). Tests are
filled by phase 4.

| REQ | Requirement (short) | Tasks | Files |
|-----|---------------------|-------|-------|
| REQ-001 | Additive agent modules; running app untouched; frozen suites green unmodified | TASK-002..005 | `src/agent/*` |
| REQ-002 | Anti-transit-buffer: no window-manager import; no missed-event queue | TASK-002, TASK-004 | `replay.ts`, `session-store.ts` |
| REQ-003 | Replay layer: bounded headless terminal per pane; barrier-correct snapshot; dep confinement | TASK-002 | `replay.ts` |
| REQ-004 | Session store outlives a connection; caches; destroy; replay-failure containment | TASK-004 | `session-store.ts` |
| REQ-005 | Default composition = F16 byte-compatible; store composition detaches on every end path; bind guard (F20 retires) | TASK-004, TASK-005 | `session-store.ts`, `session.ts` |
| REQ-006 | `pty:attach`: strict params, snapshot result, unknown-pane races, exactly-once ordering invariant | TASK-003, TASK-004, TASK-005 | `validate.ts`, `session-store.ts`, `session.ts` |
| REQ-007 | `pty:sessions`: params null, sorted live-pane inventory | TASK-003, TASK-004, TASK-005 | `validate.ts`, `session-store.ts`, `session.ts` |
| REQ-008 | Subscription routing; detached silence; adopt ≠ replay | TASK-004, TASK-005 | `session-store.ts`, `session.ts` |
| REQ-009 | Additive vocabulary; closed sets stay closed; six-method unknown-method message | TASK-001, TASK-005 | `remote-agent-api.ts`, `session.ts` |
| REQ-010 | Snapshot fidelity vs independent reference terminal (repaints exactly) | TASK-002, TASK-004 | `replay.ts`, `session-store.ts` |
| REQ-011 | Survival round-trip: disconnect → output continues → reattach → exact repaint | TASK-004, TASK-005 | `session-store.ts`, `session.ts` |
| REQ-012 | `@xterm/headless ^5.5.0` dep; artifact bundles it; profile untouched; new stdio suite | TASK-006 | `package.json` |
| REQ-013 | Feature doc survival section + docs test | TASK-007 | `docs/features/remote-agent.md` |
