# Traceability — 0022-client-routing-remote-workspace-ux

Reconciled at doc-sync against the shipped implementation. Every REQ maps to ≥1 TASK and ≥1 TEST.

| REQ | Tasks | Tests | Primary files |
|---|---|---|---|
| REQ-001 WorkspaceHome model | TASK-001, TASK-002 | TEST-2201..2206, 2212, 2215..2217 | shared/remote-home.ts, shared/types.ts, shared/workspace-model.ts |
| REQ-002 SCHEMA_VERSION 9 + migration | TASK-002 | TEST-2210..2214, 2272 | shared/types.ts, shared/workspace-model.ts |
| REQ-003 Frozen-pin amendments (tests phase) | TASK-017 | TEST-746, 2001, 559, 038, 087, 008, 344, 001, 375, 377, 020, 671 | the enumerated frozen suites |
| REQ-004 Named-agent registry wiring | TASK-009, TASK-010 | TEST-2222..2225, 2255, 2261, 2262 | main/ipc/register-remote.ts, main/services.ts, renderer/store/remote-slice.ts |
| REQ-005 IPC contract + purity + sender gate | TASK-003, TASK-004, TASK-009 | TEST-2254, 2255, 746, 2001, 2281 | shared/ipc-contract.ts, shared/remote-workspace.ts, preload/index.ts, main/ipc/register-remote.ts |
| REQ-006 One connection per ws; version-locked connect | TASK-005, TASK-006, TASK-009 | TEST-2218..2221, 2226..2229, 2257 | main/remote/agent-artifact.ts, main/remote/remote-workspace-manager.ts, main/services.ts, electron-builder.yml |
| REQ-007 Caller-owned cancellation + diagnostics | TASK-006 | TEST-2230..2232 | main/remote/remote-workspace-manager.ts |
| REQ-008 Remote pty op routing | TASK-008 | TEST-2242..2248, 2256 | main/remote/remote-workspace-manager.ts, main/ipc/register-pty.ts |
| REQ-009 Flow-control consumption | TASK-007 | TEST-2236..2241 | main/remote/remote-workspace-manager.ts |
| REQ-010 Routed pane-scoped push forwarding | TASK-008, TASK-009 | TEST-2249, 2257 | main/remote/remote-workspace-manager.ts, main/ipc/register.ts, main/services.ts |
| REQ-011 Agent-sourced chips; zero local trackers | TASK-008, TASK-013 | TEST-2250, 2267 | main/remote/remote-workspace-manager.ts, renderer watchers |
| REQ-012 Lease displacement banner semantics | TASK-006, TASK-012 | TEST-2233, 2263 | main/remote/remote-workspace-manager.ts, renderer/components/RemoteBanner.tsx |
| REQ-013 Disconnect/reconnect lifecycle | TASK-006, TASK-008 | TEST-2234, 2235, 2251..2253, 2273 | main/remote/remote-workspace-manager.ts |
| REQ-014 Connection state surface | TASK-006, TASK-010 | TEST-2226, 2258, 2260, 2277, 2282, 2283 | main/remote/remote-workspace-manager.ts, renderer/store/remote-slice.ts |
| REQ-015 New-remote-workspace flow + picker | TASK-011 | TEST-2268, 2269, 2272 | renderer/store.ts, renderer/components/RemoteAgentPicker.tsx |
| REQ-016 Banner UX | TASK-012 | TEST-2259, 2263, 2264, 2273, 2275 | renderer/components/RemoteBanner.tsx, remote-banner-model.ts, WorkspaceView.tsx |
| REQ-017 Capability greying | TASK-001, TASK-013 | TEST-2207, 2276, 2208, 2266, 2267, 2274 | shared/remote-home.ts, renderer/store/remote-gates.ts, renderer gates |
| REQ-018 Cross-home pane-move refusal | TASK-014 | TEST-2209, 2270, 2283 | renderer/store.ts, shared/remote-home.ts |
| REQ-019 Local byte-identity + CHAR green | TASK-009, TASK-015 | TEST-2256, 2257 | main/ipc/register-pty.ts, main/services.ts |
| REQ-020 Documentation | TASK-016 | TEST-2278, 2279, 2280 | docs/features/remote-workspaces.md, CLAUDE.md, CHANGELOG.md |

Finding-vector additions (review→tests→implement loopback): TEST-2281 (REQ-005 sender gate,
FINDING-001), TEST-2282 (REQ-014 pane-less entry forget, FINDING-002), TEST-2283 (REQ-014/REQ-018
closeWorkspace order + guard-first move, FINDING-002/003). Open follow-up: FINDING-006 (multi-window
duplicate toasts) + the FINDING-007 negative vector — `docs/superpowers/0022-client-routing-remote-workspace-ux-review-followups.md`.
