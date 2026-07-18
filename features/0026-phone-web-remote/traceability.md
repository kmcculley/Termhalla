# 0026-phone-web-remote — Traceability (phase 3)

Machine matrix: `traceability.json`. `tests` columns are intentionally empty — phase 4 (tests) fills
them; the Gatekeeper's `traceability-plan` gate only requires every REQ to have ≥1 TASK, which holds
below.

| REQ | Tasks | Key files |
|---|---|---|
| REQ-001 | TASK-007, TASK-013 | mirror-manager.ts, service.ts |
| REQ-002 | TASK-004, TASK-013, TASK-015 | server.ts, service.ts, PhoneRemoteSettings.tsx |
| REQ-003 | TASK-001 | types.ts, phone-remote/settings.ts, quick-store.ts |
| REQ-004 | TASK-002 | token.ts |
| REQ-005 | TASK-002, TASK-005, TASK-016 | token.ts, auth.ts, static-assets.ts |
| REQ-006 | TASK-005, TASK-013 | auth.ts, service.ts |
| REQ-007 | TASK-013, TASK-014, TASK-015 | service.ts, register-phone-remote.ts, PhoneRemoteSettings.tsx |
| REQ-008 | TASK-007 | mirror-manager.ts |
| REQ-009 | TASK-010 | ws-session.ts |
| REQ-010 | TASK-009, TASK-010 | protocol.ts, ws-session.ts |
| REQ-011 | TASK-006, TASK-020 | inventory.ts, pane-list.ts |
| REQ-012 | TASK-011 | ws-session.ts, service.ts |
| REQ-013 | TASK-011, TASK-020 | ws-session.ts, terminal-view.ts |
| REQ-014 | TASK-009, TASK-012 | protocol.ts, ws-session.ts |
| REQ-015 | TASK-007 | mirror-manager.ts |
| REQ-016 | TASK-010, TASK-011 | ws-session.ts |
| REQ-017 | TASK-008 | constants.ts, backpressure.ts |
| REQ-018 | TASK-009, TASK-012 | protocol.ts, ws-session.ts |
| REQ-019 | TASK-004, TASK-013 | server.ts, service.ts |
| REQ-020 | TASK-004, TASK-013, TASK-014, TASK-015 | server.ts, service.ts, register-phone-remote.ts, PhoneRemoteSettings.tsx |
| REQ-021 | TASK-016, TASK-018, TASK-021 | vite.phone-client.config.ts, static-assets.ts, electron-builder.yml |
| REQ-022 | TASK-016, TASK-018 | index.html, manifest.webmanifest, icons |
| REQ-023 | TASK-017, TASK-019, TASK-020 | key-bar.ts, main.ts, token-storage.ts, pane-list.ts, terminal-view.ts |
| REQ-024 | TASK-019 | ws-client.ts, token-storage.ts |
| REQ-025 | TASK-003 | e2e-phone-remote.ts |
| REQ-026 | TASK-007, TASK-011 | mirror-manager.ts, ws-session.ts |
| REQ-027 | TASK-022 | docs/features/phone-web-remote.md, CLAUDE.md, CHANGELOG.md |

**Uncovered REQs:** none. All 27 requirements (REQ-001..REQ-027) have ≥1 TASK.
