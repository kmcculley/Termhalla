# Traceability — 0024-agent-daemonization (plan phase, revision 3)

`tests` columns are intentionally empty for anything not already carried over from a prior
tests-phase pass — phase 4 (tests) fills them in for REQ-019. `tasks`/`files` reflect the
revision-3 plan (`03-plan.md`), which amends the round-1/round-2 implementation in place: TASK-001
through TASK-018 are carried forward unchanged from revision 2 (already implemented); TASK-004 and
TASK-006 gain an amendment (FINDING-022: the shared over-long-socket-path guard now also gates the
production bind path); TASK-019 gains an amendment (three-gesture doc-sync wording); TASK-021,
TASK-022, TASK-023 are new (REQ-019, D10).

| REQ | Tasks | Files |
|---|---|---|
| REQ-001 — additive CLI modes, byte-identical stdio | TASK-001, TASK-008 | `src/agent/args.ts`, `src/agent/main.ts` |
| REQ-002 — daemon is the survival composition | TASK-006 | `src/agent/daemon-server.ts`, `src/agent/session.ts`, `src/agent/session-store.ts` |
| REQ-003 — socket/metadata security posture (amended: shared production-path guard, FINDING-022) | TASK-002, TASK-004, TASK-006 | `src/agent/daemon-constants.ts`, `src/agent/daemon-guard.ts`, `src/agent/daemon-server.ts` |
| REQ-004 — detach hygiene, bounded log | TASK-002, TASK-005, TASK-006, TASK-007 | `src/agent/daemon-constants.ts`, `src/agent/spawn-daemon.ts`, `src/agent/daemon-server.ts`, `src/agent/bridge.ts` |
| REQ-005 — exactly one daemon per workspace socket | TASK-004, TASK-006 | `src/agent/daemon-guard.ts`, `src/agent/daemon-server.ts` |
| REQ-006 — idle self-exit, established-connection COUNT | TASK-002, TASK-003, TASK-006 | `src/agent/daemon-constants.ts`, `src/agent/daemon-lifecycle.ts`, `src/agent/daemon-server.ts` |
| REQ-007 — stale-socket recovery, bridge never removes | TASK-004, TASK-006, TASK-007 | `src/agent/daemon-guard.ts`, `src/agent/daemon-server.ts`, `src/agent/bridge.ts` |
| REQ-008 — F20 lease steal reachable, byte-lossless | TASK-006 | `src/agent/daemon-server.ts`, `src/agent/session-store.ts` |
| REQ-009 — daemon-flow launch + bridge status line | TASK-002, TASK-007, TASK-011, TASK-012, TASK-014 | `src/agent/daemon-constants.ts`, `src/agent/bridge.ts`, `src/remote-client/ssh-command.ts`, `src/remote-client/bridge-status.ts`, `src/remote-client/bootstrap-daemon.ts` |
| REQ-010 — bridge byte-transparency, exit taxonomy | TASK-007, TASK-014 | `src/agent/bridge.ts`, `src/remote-client/bootstrap-daemon.ts` |
| REQ-011 — first-connect spawn-then-attach | TASK-005, TASK-007, TASK-014 | `src/agent/spawn-daemon.ts`, `src/agent/bridge.ts`, `src/remote-client/bootstrap-daemon.ts` |
| REQ-012 — protocol-range reattach, non-destructive drift | TASK-006, TASK-009, TASK-012, TASK-013, TASK-014 | `src/agent/daemon-server.ts`, `src/shared/remote/daemon-handshake.ts`, `src/shared/remote/protocol.ts`, `src/remote-client/bridge-status.ts`, `src/remote-client/classify.ts`, `src/remote-client/bootstrap-daemon.ts` |
| REQ-013 — opt-in flow integration, workspace-scoped | TASK-010, TASK-014, TASK-015, TASK-016 | `src/remote-client/ws-token.ts`, `src/remote-client/bootstrap-daemon.ts`, `src/remote-client/bootstrap.ts`, `src/main/remote/remote-workspace-manager.ts` |
| REQ-014 — scope confinement, structural guards (amended: carve-out for REQ-019 routing) | TASK-009, TASK-015, TASK-021, TASK-022 | `src/shared/remote/daemon-handshake.ts`, `src/shared/remote/protocol.ts`, `src/remote-client/bootstrap.ts`, `src/renderer/store/internals.ts`, `src/renderer/store.ts`, `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc/register-remote.ts`, `src/main/remote/remote-workspace-manager.ts` |
| REQ-015 — headline close/reopen survival scenario | TASK-018, TASK-023 | — (integration composition) |
| REQ-016 — testing posture, sanctioned shim amendment | TASK-017 | `tests/fixtures/fake-ssh.mjs` |
| REQ-017 — retire no-daemonization claims (amended: three-gesture story) | TASK-019 | `CLAUDE.md`, `docs/features/remote-agent.md`, `docs/features/remote-workspaces.md` |
| REQ-018 — same-host workspace coexistence | TASK-002, TASK-006, TASK-007, TASK-010, TASK-015, TASK-016, TASK-018 | `src/agent/daemon-constants.ts`, `src/agent/daemon-server.ts`, `src/agent/bridge.ts`, `src/remote-client/ws-token.ts`, `src/remote-client/bootstrap.ts`, `src/main/remote/remote-workspace-manager.ts` |
| REQ-019 — closing a remote workspace tab detaches (new — D10, FINDING-023) | TASK-021, TASK-022, TASK-023 | `src/renderer/store/internals.ts`, `src/renderer/store.ts`, `src/renderer/store/remote-slice.ts`, `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc/register-remote.ts`, `src/main/remote/remote-workspace-manager.ts` |

No `REQ` is left without a `TASK`.

## Findings retired by this plan

Revision 2 already retired FINDING-005, 006, 007, 008, 009/013, 010/015, 011, 012, 014, 016, 017
(each by a named task in the prior plan pass) and disclosed (not fixed) FINDING-018 per REQ-007's
own acceptance; FINDING-001..004 (non-blocking round-1 quality/dedup findings) remain opportunistic
follow-ups, not separately tasked. Revision 3 additionally retires:

- FINDING-022 (production over-long-path guard is test-seam-only; production silently loops/exits
  0) → TASK-004 (amended, shared `checkSocketPathLength` export) + TASK-006 (amended, production
  wiring + POSIX integration vector).
- FINDING-023 (close-tab silently `pty:kill`s remote panes instead of detaching — the third
  going-away gesture) → TASK-021 (renderer routing) + TASK-022 (additive `remote:disconnect`
  `{forget}` param + manager forget-guard) + TASK-023 (end-to-end proof).

## Open issues

None.
