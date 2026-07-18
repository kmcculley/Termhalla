# 0026-phone-web-remote — Traceability (phase 3, v2)

Machine matrix: `traceability.json`. `tests` columns for REQ-001..027 carry the test IDs frozen at
the prior tests-phase pass (`test-freeze.json`); REQ-028..032 are new in this v2 loopback and their
`tests` are intentionally empty — phase 4 (tests) assigns them, along with any amendment-driven
additions to the existing REQs' test lists (in particular the REQ-015/019/023/025 mandated e2e
specs and the real-transport backpressure/attach-supersession vectors called out in
`03-plan.md`'s "Findings → task map").

| REQ | Tasks | Tests (frozen from prior pass; phase 4 extends) | Files |
|---|---|---|---|
| REQ-001 | TASK-007, TASK-013 | TEST-2620, TEST-2623, TEST-2650 | mirror-manager.ts, service.ts |
| REQ-002 | TASK-004, TASK-013, TASK-015 | TEST-2640, TEST-2685 | server.ts, service.ts, PhoneRemoteSettings.tsx |
| REQ-003 | TASK-001, TASK-014 | TEST-2601, TEST-2602, TEST-2603 | types.ts, phone-remote/settings.ts, quick-store.ts, register-phone-remote.ts |
| REQ-004 | TASK-002 | TEST-2604, TEST-2605, TEST-2647 | token.ts |
| REQ-005 | TASK-002, TASK-005, TASK-016, TASK-023 | TEST-2605, TEST-2606, TEST-2643, TEST-2644 | token.ts, auth.ts, static-assets.ts, cookie.ts |
| REQ-006 | TASK-005, TASK-013, TASK-023 | TEST-2645 | auth.ts, service.ts, cookie.ts |
| REQ-007 | TASK-013, TASK-014, TASK-015, TASK-029 | TEST-2647, TEST-2655, TEST-2685, TEST-2686 | service.ts, register-phone-remote.ts, PhoneRemoteSettings.tsx, network-urls.ts |
| REQ-008 | TASK-007, TASK-025 | TEST-2621 | mirror-manager.ts, register-pty.ts |
| REQ-009 | TASK-010 | TEST-2625, TEST-2648 | ws-session.ts |
| REQ-010 | TASK-009, TASK-010, TASK-031 | TEST-2610, TEST-2611, TEST-2626 | protocol.ts, ws-session.ts, main.ts |
| REQ-011 | TASK-006, TASK-020, TASK-024 | TEST-2636, TEST-2646, TEST-2673 | inventory.ts, pane-list.ts, register-phone-remote.ts, services.ts |
| REQ-012 | TASK-011 | TEST-2630, TEST-2631, TEST-2648 | ws-session.ts, service.ts |
| REQ-013 | TASK-011, TASK-020, TASK-025 | TEST-2613, TEST-2624, TEST-2632, TEST-2633, TEST-2637, TEST-2673 | ws-session.ts, terminal-view.ts, register-pty.ts |
| REQ-014 | TASK-009, TASK-012 | TEST-2613, TEST-2634 | protocol.ts, ws-session.ts |
| REQ-015 | TASK-007 | TEST-2622 | mirror-manager.ts |
| REQ-016 | TASK-010, TASK-011 | TEST-2627 | ws-session.ts |
| REQ-017 | TASK-008, TASK-026 | TEST-2615, TEST-2616, TEST-2617, TEST-2618, TEST-2629, TEST-2670 | constants.ts, backpressure.ts, ws-session.ts, service.ts |
| REQ-018 | TASK-009, TASK-012 | TEST-2612, TEST-2635 | protocol.ts, ws-session.ts |
| REQ-019 | TASK-004, TASK-013 | TEST-2641, TEST-2652 | server.ts, service.ts |
| REQ-020 | TASK-004, TASK-013, TASK-014, TASK-015, TASK-028 | TEST-2653, TEST-2686 | server.ts, service.ts, register-phone-remote.ts, PhoneRemoteSettings.tsx, App.tsx |
| REQ-021 | TASK-016, TASK-018, TASK-021 | TEST-2675, TEST-2676 | vite.phone-client.config.ts, static-assets.ts, electron-builder.yml |
| REQ-022 | TASK-016, TASK-018, TASK-023 | TEST-2643, TEST-2677 | index.html, manifest.webmanifest, icons, cookie.ts |
| REQ-023 | TASK-017, TASK-019, TASK-020, TASK-031 | TEST-2665, TEST-2671, TEST-2672, TEST-2673 | key-bar.ts, main.ts, token-storage.ts, pane-list.ts, terminal-view.ts |
| REQ-024 | TASK-019 | TEST-2628, TEST-2648, TEST-2655, TEST-2670, TEST-2674 | ws-client.ts, token-storage.ts |
| REQ-025 | TASK-003 | TEST-2660, TEST-2661 | e2e-phone-remote.ts |
| REQ-026 | TASK-007, TASK-011 | TEST-2623, TEST-2631, TEST-2636 | mirror-manager.ts, ws-session.ts |
| REQ-027 | TASK-022 | TEST-2680, TEST-2681 | docs/features/phone-web-remote.md, CLAUDE.md, CHANGELOG.md |
| REQ-028 *(new v2)* | TASK-023 | — | cookie.ts, auth.ts, service.ts, constants.ts |
| REQ-029 *(new v2)* | TASK-027 | — | store/types.ts, SettingsPanel.tsx, PhoneRemoteSettings.tsx |
| REQ-030 *(new v2)* | TASK-031 | — | main.ts, terminal-view.ts, pane-list.ts |
| REQ-031 *(new v2)* | TASK-029 | — | network-urls.ts, service.ts, phone-remote/settings.ts, PhoneRemoteSettings.tsx |
| REQ-032 *(new v2)* | TASK-030 | — | register-phone-remote.ts |

**Uncovered REQs:** none. All 32 requirements (REQ-001..REQ-032) have ≥1 TASK.
