# Intake — 0024-agent-daemonization

**Phase:** 0 (intake) — captured by `/orky:new` 2026-07-06.
**Origin:** user report + follow-up to feature 0023. The user connected to a remote via the agent,
launched `claude`, closed Termhalla, reopened — the SSH tunnel reconnected but the Claude session was
gone. They expected tmux-like persistence across a client close.

## Idea (verbatim)

Remote agent daemonization — make remote terminal sessions survive the Termhalla client closing and
reconnecting (true tmux-parity), fixing the v1 CONV-054 limitation.

### Problem
Remote Agent v1's session-survival machinery exists (the agent-side session store outlives a
*connection*, with `@xterm/headless` replay on reattach), BUT the shipped v1 agent is NOT daemonized
(CONV-054, `docs/features/remote-workspaces.md`): it runs tied to the SSH stdio exec channel. When the
user closes Termhalla, the SSH tunnel tears down, the agent process (a child of that ssh exec channel)
receives EOF/SIGHUP and exits, and its session store dies with it — killing every PTY it owns
(including a running `claude`). On reconnect the `pty:sessions` inventory is empty and every pane
surfaces as "exited." Real user report (2026-07-06): connected to a remote via the agent, launched
Claude, closed Termhalla, reopened — SSH reconnected but Claude was gone. Users reasonably expect
tmux-like persistence across a client close.

### Goal
The remote agent keeps running (detached from any single SSH session) after the client disconnects, so
a later reconnection re-attaches to the STILL-RUNNING agent and its live PTYs — the running `claude`
(and any other remote pane) is exactly where it was left. Disconnect/close/reopen survival, not
host-reboot survival.

### Key context / why this is agent-side
- The client is already **inventory-driven** (F18 flow: `pty:sessions` then per-pane `pty:attach` with
  a serialize snapshot / spawn / exited). Per the docs, "agent daemonization lands with no client
  change" — the persistence is a purely agent-side/transport change; the reattach path already exists.
- Central design question for brainstorm: once the agent detaches from the ssh stdio channel, how does
  a NEW ssh connection reach the already-running daemon? The classic model (tmux) is a persistent
  server + a per-connection client over a **unix-domain socket** on the remote: each ssh exec channel
  becomes a thin client that connects to the local agent socket. Alternatives to weigh: re-exec/adopt,
  named pipe, localhost TCP. Lifecycle: one daemon per host vs per remote-agent-dir; startup (first
  connect spawns+detaches via setsid/nohup or a small supervisor), idle/empty-session shutdown,
  stale-socket cleanup, the F20 exclusive-attach lease semantics against a persistent daemon, and
  socket permissions/security (no secrets; local-only socket, 0600).
- Relevant code: `src/agent/` (session-store.ts already survives a connection; session.ts; the stdio
  entry), `src/remote-client/` (system-ssh exec launch + bootstrap/provision), `docs/features/
  remote-agent.md` + `remote-workspaces.md`.

### Non-goals (for this feature)
- Host-reboot survival / agent supervision across reboot (separately deferred — `.orky/roadmap.md`
  open question 1).
- macOS/Windows remotes (v1 remote is Linux-only).
- Any change to local (non-remote) workspaces.
- Client-side UI changes if avoidable (inventory-driven reattach should already handle it) — confirm
  in spec.

### Open questions for brainstorm
1. Daemon transport to the running agent (unix socket vs alternatives) and the client-side wiring
   (ssh exec → socket bridge).
2. Daemon lifecycle: spawn/detach mechanism, one-per-host vs one-per-agent-dir, idle shutdown,
   stale-socket/crash recovery.
3. Interaction with the F20 exclusive-attach lease and F17 flow control across a persistent daemon.
4. Security posture of the local socket; version-lockstep with the uploaded agent bundle (reuse the
   F19/0023 version-embedded path discipline).
5. Whether ANY client change is truly needed, or if it's purely the launch/transport layer.

## Likely concern tags (to be committed in the spec, not yet)

- **networking** — the ssh-exec → persistent-daemon transport bridge (unix socket / alternatives),
  reconnection routing, interaction with F17 flow control across a persistent process.
- **security** — the local daemon socket (permissions 0600, local-only, no secrets), no new remote
  attack surface, version-lockstep with the uploaded bundle.
- **determinism** — daemon lifecycle correctness: single-instance-per-scope, spawn/detach race,
  idle/empty shutdown, stale-socket & crash recovery, deterministic tests via the fake-ssh shim (no
  real ssh/daemon in CI).
- **enterprise-arch / devils-advocate** — the F20 exclusive-attach lease semantics against a
  now-persistent daemon; orphaned-daemon accumulation; what happens on version-mismatch reconnect.
- (always-on per `.orky/config.json`: security, quality, devils-advocate.)

**Next:** phase 1 (brainstorm) is interactive and belongs to the human (ADR-006). Run
`/orky:brainstorm` to turn this intake into an agreed concept, then `/orky:run` drives
spec→plan→tests→implement→review autonomously.
