# Termhalla — Remote Agent v1 roadmap (tmux-style remote sessions)

A headless Termhalla **agent** deployed on a remote Linux server owns PTYs + session state so
terminal sessions survive client disconnection; the local Termhalla client connects over SSH and
remote workspaces feel local. The agent lives in **this repo**, sharing `src/shared/` protocol types.

Locked design decisions (human-confirmed 2026-07-04 — carried into each feature's summary as intake
anchors; not to be re-opened):

1. **Transport = stdio exec channel over SYSTEM ssh** (spawn the user's `ssh` binary; never an SSH
   library) — inherits `~/.ssh/config`, jump hosts, hardware keys, 2FA. Stdio also means CI/e2e
   spawns the agent as a plain local child process over the IDENTICAL protocol path — no real ssh in CI.
2. **Client-provisioned agent**: on connect the client version-checks the remote agent and uploads
   its own bundled matching build if absent/mismatched. Version-locked; the handshake is a version
   check, not a compatibility matrix.
3. **Reconnect/replay** = `@xterm/headless` running AGENT-side (one per PTY) + serialize-addon
   snapshot on attach; bounded scrollback (tmux history-limit analog). Explicitly **not** the
   window-manager transit buffer (a 1024-event/10s-GC same-machine handoff primitive — wrong tool).
4. **Windowed flow control from day one**: client acks every N KB; agent `pause()`s node-pty when
   unacked bytes exceed the window, `resume()`s when drained. Protocol-level, not an afterthought.
5. **Exclusive attach v1**: attaching steals the session via an agent-side lease; the loser drops to
   a disconnected banner (`tmux attach -d` semantics). No mirrored attach.
6. **Capability handshake**: the agent advertises which IPC domains it implements; the client greys
   out the rest per remote workspace. The 17 per-domain registrars ARE the capability partition.
   v1 agent = **pty + status only** (tmux parity — status detection consumes the byte stream at the
   source, so status chips work identically for remote panes).
7. **Per-workspace home**: a workspace is homed local or at a named agent; every pane lives at its
   home; one connection per workspace; cross-home pane moves are out of scope.
8. Scope = v1 core only (7 features to tmux parity). Domain ports are a future epic (see Deferred).
9. Agent platform v1 = **Linux only**; design POSIX-portable, no macOS/Windows-remote REQs/tests.
10. The verified gate profile (`.orky/profiles/node-app.json` = `npm run build` + `npm test`) must
    end up actually building and testing the agent — folded into those npm scripts (F16); the
    profile file itself does not change.
11. Hard invariants: renderer keeps ZERO Node/Electron imports; protocol code is pure `src/shared/`;
    characterization tests stay green; local-only behavior unchanged when no remote workspace exists.

## Features

| id  | slug | title | deps |
|-----|------|-------|------|
| F15 | 0016-remote-protocol-core-handshake | Remote wire protocol core + version/capability handshake | — |
| F16 | 0017-agent-runtime-skeleton | Agent runtime skeleton — pty + status domains over stdio | F15 |
| F17 | 0018-windowed-flow-control | Windowed flow control (protocol-level backpressure) | F16 |
| F18 | 0019-agent-replay-session-survival | Agent-side replay + session survival | F16 |
| F19 | 0020-ssh-tunnel-provisioned-bootstrap | SSH tunnel + client-provisioned agent bootstrap | F16 |
| F20 | 0021-exclusive-attach-lease | Exclusive attach via agent-side lease | F18 |
| F21 | 0022-client-routing-remote-workspace-ux | Client routing + remote-workspace UX (per-workspace home) | F18, F19, F20 |

Ids continue the archived T1–T4 epic's numbering (last: F14 / slug 0015 taken by a standalone
feature) so ids stay globally unambiguous in discussion.

## Dependency graph

```
F15 (protocol core + handshake)
 └─ F16 (agent skeleton: pty + status over stdio; agent folded into build/test)
     ├─ F17 (windowed flow control)
     ├─ F18 (replay + session survival)
     │   └─ F20 (exclusive attach / lease)
     └─ F19 (ssh tunnel + provisioned bootstrap)

F21 (client routing + remote-workspace UX) ← F18, F19, F20
```

## Build order + parallel batches

| batch | features | notes |
|-------|----------|-------|
| 1 | F15 | Pure shared protocol; zero behavior change to the running app. |
| 2 | F16 | The walking skeleton; everything downstream needs the agent + client round-trip. |
| 3 | F17 ∥ F18 ∥ F19 | Three independent branches off the skeleton — can run in parallel. |
| 4 | F20 | Needs F18's session inventory + reattach path. (Can overlap batch 3's F17/F19 tails.) |
| 5 | F21 | The UX capstone; needs tunnel (F19), replay (F18), and lease (F20). |
| 6 | integration | Cross-feature/e2e phase (below). |

F17 (flow control) is deliberately **not** an F21 dependency — it is transparent to the client UX
and is instead proven in the integration phase's flood scenario. It must still land before
integration.

Brownfield seams the DAG cannot encode (existing code is not a roadmap node): F16/F21 reuse the
pure `src/main/status/` modules and the `pty:*` IPC path; F19 builds on SSH favorites
(`src/shared/quick.ts` / `quick-store.ts`); F15 derives from `src/shared/ipc-contract.ts`; F21
touches the persisted workspace record (`SCHEMA_VERSION`, currently 8). The integration phase must
exercise these seams.

## Integration phase

End-to-end client↔agent proof over the **stdio loopback** (agent spawned as a local child process —
the identical protocol path as ssh):

- Full pty round-trip (spawn/write/resize/data/exit) through the real protocol.
- Disconnect → agent-side output continues → reattach → replayed serialize snapshot matches an
  independent headless reference terminal.
- Flow control holds under an output flood: agent memory stays bounded; node-pty `pause()`/`resume()`
  observed.
- Lease steal drops the losing client's workspace to disconnected (`tmux attach -d` semantics).
- Provisioning version-check/upload path exercised against the fake ssh shim (absent agent,
  mismatched agent, matching agent).
- Renderer still has zero Node imports; full CHAR suite green; local-only behavior byte-identical
  when no remote workspace exists.

## Open questions (recorded, not resolved)

1. **Agent process supervision on the host** (systemd-user vs `setsid`/`nohup`) — affects F19 and
   session survival across reboots. Sessions surviving **disconnect** is v1; surviving **host
   reboot** is not promised.
2. **Scrollback history-limit sizing + session GC policy** for never-reattached sessions (F18).
3. **Agent packaging**: single-file build (esbuild) vs a node_modules payload — affects upload size
   and the bootstrap mechanics in F19.

## Deferred (intentionally out of v1)

- **Domain ports beyond pty + status** — fs/editor, git, usage, orky for remote workspaces. This is
  the natural follow-on epic; the capability handshake (F15/F21) is designed so each ported domain
  lights up per remote workspace as the agent grows it.
- **macOS / Windows remote agents** — v1 is Linux-only; POSIX-portable design keeps macOS cheap later.
- **Mirrored / shared attach** (multiple clients viewing one session) — v1 is exclusive-attach only.
- **Cross-workspace pane moves between different homes** — a running PTY cannot teleport machines.
- **Session survival across host reboot** (agent supervision) — recorded as open question 1.
