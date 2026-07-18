# 0026-phone-web-remote — Traceability (phase 3, v2, reconciled at doc-sync)

Machine matrix: `traceability.json` (source of truth, regenerated here verbatim). Every listed
`TEST-NNN` id appears as a marker in the corresponding test file under `tests/`.

| REQ | Tasks | Tests | Files |
|---|---|---|---|
| REQ-001 | TASK-007, TASK-013 | TEST-2620, TEST-2623, TEST-2650, TEST-2732 | mirror-manager.ts, service.ts |
| REQ-002 | TASK-004, TASK-013, TASK-015 | TEST-2640, TEST-2685, TEST-2730 | server.ts, service.ts, PhoneRemoteSettings.tsx |
| REQ-003 | TASK-001, TASK-014 | TEST-2601, TEST-2602, TEST-2603, TEST-2697 | types.ts, settings.ts, quick-store.ts, register-phone-remote.ts |
| REQ-004 | TASK-002 | TEST-2604, TEST-2605, TEST-2647, TEST-2690, TEST-2693 | token.ts |
| REQ-005 | TASK-002, TASK-005, TASK-016, TASK-023 | TEST-2605, TEST-2606, TEST-2643, TEST-2644, TEST-2690, TEST-2691, TEST-2693 | token.ts, auth.ts, static-assets.ts, cookie.ts |
| REQ-006 | TASK-005, TASK-013, TASK-023 | TEST-2645, TEST-2692 | auth.ts, service.ts, cookie.ts |
| REQ-007 | TASK-013, TASK-014, TASK-015, TASK-029 | TEST-2647, TEST-2655, TEST-2685, TEST-2686, TEST-2698, TEST-2712 | service.ts, register-phone-remote.ts, PhoneRemoteSettings.tsx, network-urls.ts |
| REQ-008 | TASK-007, TASK-025 | TEST-2621, TEST-2699 | mirror-manager.ts, register-pty.ts |
| REQ-009 | TASK-010 | TEST-2625, TEST-2648, TEST-2705 | ws-session.ts |
| REQ-010 | TASK-009, TASK-010, TASK-031 | TEST-2610, TEST-2611, TEST-2626, TEST-2720 | protocol.ts, ws-session.ts, main.ts |
| REQ-011 | TASK-006, TASK-020, TASK-024 | TEST-2636, TEST-2646, TEST-2673, TEST-2711, TEST-2726, TEST-2729 | inventory.ts, pane-list.ts, register-phone-remote.ts, services.ts |
| REQ-012 | TASK-011 | TEST-2630, TEST-2631, TEST-2648 | ws-session.ts, service.ts |
| REQ-013 | TASK-011, TASK-020, TASK-025 | TEST-2613, TEST-2624, TEST-2632, TEST-2633, TEST-2637, TEST-2673, TEST-2700, TEST-2723 | ws-session.ts, terminal-view.ts, register-pty.ts |
| REQ-014 | TASK-009, TASK-012 | TEST-2613, TEST-2634 | protocol.ts, ws-session.ts |
| REQ-015 | TASK-007 | TEST-2622, TEST-2727 | mirror-manager.ts |
| REQ-016 | TASK-010, TASK-011 | TEST-2627 | ws-session.ts |
| REQ-017 | TASK-008, TASK-026 | TEST-2615, TEST-2616, TEST-2617, TEST-2618, TEST-2629, TEST-2670, TEST-2701, TEST-2702, TEST-2703, TEST-2704, TEST-2706, TEST-2707, TEST-2708, TEST-2713, TEST-2714 | constants.ts, backpressure.ts, ws-session.ts, service.ts |
| REQ-018 | TASK-009, TASK-012 | TEST-2612, TEST-2635 | protocol.ts, ws-session.ts |
| REQ-019 | TASK-004, TASK-013 | TEST-2641, TEST-2652, TEST-2709, TEST-2728 | server.ts, service.ts |
| REQ-020 | TASK-004, TASK-013, TASK-014, TASK-015, TASK-028 | TEST-2653, TEST-2686, TEST-2710, TEST-2717, TEST-2718 | server.ts, service.ts, register-phone-remote.ts, PhoneRemoteSettings.tsx, App.tsx |
| REQ-021 | TASK-016, TASK-018, TASK-021 | TEST-2675, TEST-2676 | vite.phone-client.config.ts, static-assets.ts, electron-builder.yml |
| REQ-022 | TASK-016, TASK-018, TASK-023 | TEST-2643, TEST-2677, TEST-2691, TEST-2731 | index.html, manifest.webmanifest, icons, cookie.ts |
| REQ-023 | TASK-017, TASK-019, TASK-020, TASK-031 | TEST-2665, TEST-2671, TEST-2672, TEST-2673, TEST-2721, TEST-2722, TEST-2723, TEST-2725, TEST-2731 | key-bar.ts, main.ts, token-storage.ts, pane-list.ts, terminal-view.ts |
| REQ-024 | TASK-019 | TEST-2628, TEST-2648, TEST-2655, TEST-2670, TEST-2674, TEST-2692, TEST-2721 | ws-client.ts, token-storage.ts |
| REQ-025 | TASK-003 | TEST-2660, TEST-2661, TEST-2715, TEST-2727 | e2e-phone-remote.ts |
| REQ-026 | TASK-007, TASK-011 | TEST-2623, TEST-2631, TEST-2636, TEST-2711 | mirror-manager.ts, ws-session.ts |
| REQ-027 | TASK-022 | TEST-2680, TEST-2681, TEST-2733 | phone-web-remote.md, CLAUDE.md, CHANGELOG.md |
| REQ-028 | TASK-023 | TEST-2690, TEST-2691, TEST-2692, TEST-2693, TEST-2672, TEST-2731 | cookie.ts, auth.ts, service.ts, constants.ts |
| REQ-029 | TASK-027 | TEST-2716, TEST-2717, TEST-2730 | types.ts, SettingsPanel.tsx, PhoneRemoteSettings.tsx |
| REQ-030 | TASK-031 | TEST-2724, TEST-2731 | main.ts, terminal-view.ts, pane-list.ts |
| REQ-031 | TASK-029 | TEST-2694, TEST-2695, TEST-2698, TEST-2719 | network-urls.ts, service.ts, settings.ts, PhoneRemoteSettings.tsx |
| REQ-032 | TASK-030 | TEST-2696 | register-phone-remote.ts |

**Uncovered REQs:** none. All 32 requirements (REQ-001..REQ-032) have >=1 TASK and >=1 TEST.
