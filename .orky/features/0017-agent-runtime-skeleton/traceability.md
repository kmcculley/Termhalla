# Traceability — 0017-agent-runtime-skeleton

Human-readable rendering of `traceability.json` (machine-checked by the Gatekeeper). Tests are
filled by phase 4.

| REQ | Requirement (short) | Tasks | Files |
|-----|---------------------|-------|-------|
| REQ-001 | `src/agent/` placement + isolation; app untouched | TASK-002..008 | `src/agent/*` |
| REQ-002 | Protocol via `@shared/remote/protocol` only; no re-derivation | TASK-007, TASK-008 | `session.ts`, `main.ts` |
| REQ-003 | stdout = frames only; stderr = diagnostics | TASK-008 | `main.ts` |
| REQ-004 | Agent-first hello; version = package.json; caps = `AGENT_V1_CAPABILITIES` | TASK-005, TASK-007 | `version.ts`, `session.ts` |
| REQ-005 | Handshake failure → no frames, stderr reason, exit 1 | TASK-007, TASK-008 | `session.ts`, `main.ts` |
| REQ-006 | Exactly one res per req, same id; unknown-method; internal | TASK-007 | `session.ts` |
| REQ-007 | pty method semantics (spawn adopt/fresh, write/resize/kill, unknown-pane) | TASK-006, TASK-007, TASK-003, TASK-004 | `validate.ts`, `session.ts`, `fake-backend.ts`, `node-pty-backend.ts` |
| REQ-008 | Status detection via existing `src/main/status/` engine; pty:status/pty:cwd | TASK-007 | `session.ts` |
| REQ-009 | Strict param validation; bad-params; launch/envId rejected | TASK-006, TASK-007 | `validate.ts`, `session.ts` |
| REQ-010 | pty:data/pty:exit mirroring + ordering | TASK-007, TASK-003 | `session.ts`, `fake-backend.ts` |
| REQ-011 | Injectable backend; lazy node-pty; `--pty` flag; usage exit 2 | TASK-002, TASK-004, TASK-005, TASK-008 | `pty-backend.ts`, `node-pty-backend.ts`, `args.ts`, `main.ts` |
| REQ-012 | Deterministic fake backend contract | TASK-003 | `fake-backend.ts` |
| REQ-013 | Lifecycle: stdin-end exit 0; per-frame recovery; fatal exit 1; ack/window inert (F17 retires) | TASK-007, TASK-008 | `session.ts`, `main.ts` |
| REQ-014 | Shared vocabulary `remote-agent-api.ts` | TASK-001 | `src/shared/remote-agent-api.ts` |
| REQ-015 | Build folding: artifact via `npm run build`; profile untouched | TASK-009 | `vite.agent.config.ts`, `package.json` |
| REQ-016 | Test folding: self-sufficient integration through same config | TASK-009 | `vite.agent.config.ts` |
| REQ-017 | Typecheck include + feature doc | TASK-009, TASK-010 | `tsconfig.node.json`, `docs/features/remote-agent.md` |
