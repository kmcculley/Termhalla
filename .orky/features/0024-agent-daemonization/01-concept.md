# Concept — 0024-agent-daemonization

**Phase:** 1 (brainstorm) — human-driven.
**Date:** 2026-07-06
**Intake:** `00-intake.md`

## Problem (one line)

The v1 remote agent is not daemonized (CONV-054): it's tied to the SSH stdio exec channel, so closing
Termhalla kills the agent and every remote PTY (incl. a running `claude`). Users expect tmux-like
persistence across a client close/reopen.

## Strategy (locked)

**Daemonize the existing node agent.** Detach it from any single SSH session so it keeps running on the
remote; a later SSH connection re-attaches to the still-running daemon and its live PTYs via the
already-built F18 inventory/replay path. Reuses the whole survival stack (session store that outlives a
connection, `@xterm/headless` replay, F17 flow control, F18 inventory, F20 lease) and keeps the
zero-remote-dependency posture (only `node` on the host).

## Decisions (settled in brainstorm)

### D1 — Approach: **daemonize the node agent** (not tmux delegation)
Reuse the existing node-agent architecture (it already owns PTYs + a connection-surviving session
store). Rejected: delegating persistence to remote `tmux`/`screen` — it would require tmux installed on
every host (breaks 0023's zero-setup posture) and is a large architectural departure from the
node-agent-owns-PTYs protocol.

### D2 — Transport: **unix-domain socket** (tmux model)
The detached daemon listens on a unix-domain socket under `~/.termhalla/agent/` (mode **0600**). Each
SSH exec channel becomes a **thin bridge** that pipes its stdio ↔ the socket. Local-to-the-host only,
no network surface, secured by filesystem permissions. Rejected: localhost TCP (needs port
allocation/discovery; reachable by any local user unless separately firewalled).

### D3 — Daemon lifetime: **idle-timeout after last session**
The daemon lives while any PTY session lives. Once the last session exits **AND** no client has been
attached for N minutes, it self-exits and removes its socket. Balances survival against orphaned-daemon
accumulation. (N default is a spec detail — a few minutes, likely configurable.) Rejected:
persist-until-reboot (orphans pile up) and exit-on-last-session (closing your last pane briefly destroys
everything).

### D4 — Version drift: **old daemon keeps running; survival wins**
When an upgraded client reconnects to a daemon started by an older bundle, the old daemon keeps running
and its sessions survive; version drift is tolerated until the daemon idles out, after which the next
spawn uses the new bundle. This prioritizes the feature's whole point. Rejected: kill+respawn the new
version (loses sessions on every client upgrade). **Consequence to resolve in spec (open question 1):**
the socket must be **version-stable** so a reconnecting (possibly newer) client can find the running
daemon — but F15's wire protocol uses an **exact-version handshake**, which would reject a
cross-version reattach. The spec must decide how the daemon-reattach handshake negotiates a compatible
protocol range (or bounds survival to same-version reconnects with a clean, non-destructive fallback).

### D5 — Detach mechanism: **`setsid`/double-fork, zero-dependency** (stated)
Detach via a POSIX double-fork + `setsid` (new session leader, `SIGHUP`-immune), stdio redirected off
the ssh channel. **Not** `systemd --user` (would require lingering/systemd on the host) — matches the
stock-Linux, no-root posture of F19/0023.

### D6 — Scope + single-instance: **one daemon per `~/.termhalla/agent`** (stated)
One daemon per agent dir (per-user, per-host), one socket. A single-instance guard (advisory lock or
atomic socket bind — spec/plan detail) prevents two daemons racing on the same socket.

### D7 — Stale-socket / crash recovery: **deterministic reclaim** (stated)
On connect, if the socket file exists but no daemon is listening (crash/kill left it behind), the
client cleans the stale socket and spawns a fresh daemon — never wedges on a dead socket.

### D8 — Client change is minimized to the launch/transport layer (stated)
The reattach path is already F18 inventory-driven ("daemonization lands with no client change"). The
only client-side change is the **launch/transport layer**: instead of running the agent directly on the
ssh channel, spawn+detach the daemon (if not already running) then bridge the ssh channel to its
socket. Whether ANY renderer/main change beyond this is needed → confirm in spec (expected: none).

### D9 — F20 lease survives disconnect (stated)
The exclusive-attach lease lives in the daemon's session store, so it naturally survives a client
disconnect; a reconnect re-binds and the steal semantics are unchanged.

## Concerns (reviewer routing tags for later phases)

- **networking** — ssh-exec → persistent-daemon socket bridge; reconnection routing; F17 flow control
  and F18 inventory across a persistent process; the cross-version reattach negotiation.
- **security** — the local daemon socket (0600, local-only, no secrets); no new remote attack surface;
  the detached process' stdio hygiene; version-lockstep discipline (reuse F19/0023 version-embedded path).
- **determinism** — daemon lifecycle: single-instance guarantee, spawn/detach race, idle/empty
  shutdown, stale-socket/crash reclaim; deterministic tests via the fake-ssh shim (no real
  ssh/daemon/socket/network in CI).
- **enterprise-arch / devils-advocate** — F20 lease vs a persistent daemon; orphaned-daemon
  accumulation; version-mismatch reconnect correctness; what happens if two clients race to spawn the
  daemon.
- always-on (`.orky/config.json`): security, quality, devils-advocate.

## Testing posture (locked constraints)

No real ssh, no real daemon/socket, no real network in the CI test lane. Extend the F19
`tests/fixtures/fake-ssh.mjs` shim to emulate the daemon-spawn/detach + socket-bridge command shapes,
and drive deterministically: first-connect spawns+detaches; reconnect re-attaches to the running daemon
and replays the snapshot; idle-timeout self-exit; stale-socket reclaim; single-instance race;
version-drift reattach; F20 lease across a disconnect. The in-process survival composition (session
store + replay) is already tested — this feature adds the daemon/socket/bridge layer on top.

## Non-goals (confirmed)

- Host-reboot survival / agent supervision across reboot (separately deferred — `.orky/roadmap.md` open
  question 1).
- macOS/Windows remotes (v1 remote = Linux).
- Any change to local (non-remote) workspace behavior.
- New renderer UI (expected none — the reattach path is inventory-driven; confirm in spec).

## Open questions

| # | Question | Status | Note |
|---|----------|--------|------|
| 1 | Cross-version reattach handshake (F15 exact-version vs version-stable-socket reattach) | **deferred → spec** | Recommended: negotiate a compatible protocol range for the reattach path, or bound survival to same-version reconnect with a clean non-destructive fallback. Load-bearing for D4. |
| 2 | Idle-timeout default value (N minutes) + configurability | **deferred → spec** | Sensible default; likely configurable. |
| 3 | Single-instance mechanism (advisory lock vs atomic socket bind) | **deferred → spec/plan** | Must be race-free against two simultaneous first-connects. |
| 4 | Any renderer/main client change beyond the launch/transport layer | **deferred → spec** | Investigate; expected none. |

**No blocking open questions.** Awaiting human confirmation to record the brainstorm gate.

## Post-review brainstorm refinement (2026-07-06, human: Kevin)

The review's devils-advocate lens correctly caught two under-specifications in D4/D6. Human decisions:

### D6′ (revises D6) — daemon scope: **per-WORKSPACE daemon + socket**, not per-host
FINDING-013 regression: one-daemon-per-host + F20's store-wide exclusive lease + bind-on-handshake
means two remote workspaces pointed at the SAME host share one daemon/lease, so opening the second
forcibly disconnects the first (a regression — pre-daemonization each workspace had its own agent).
**Decision:** each workspace gets its OWN daemon, with the socket keyed by a stable **workspace id**
(e.g. `~/.termhalla/agent/agent-<wsId>.sock`), so two same-host workspaces are fully independent and
F20's lease semantics stay intact per-daemon (the multi-*client* steal case is unchanged). Reconnect to
the same workspace resolves the same socket. Idle-timeout (D3) reaps unused per-workspace daemons.
Chosen over per-host-daemon-with-scoped-lease (would rework the heavily-tested session store) and
over documenting the limitation (ships a real regression). This also resolves FINDING-009.

### D4′ (extends D4) — version drift under auto-update: **decouple the wire-protocol version from the app version**
FINDING-014: Termhalla auto-updates on quit, so "close → update → reopen" bumps the client version on
the COMMON path; D4's version-stable socket + F15's exact-*app*-version handshake would then lock the
new client out of the old daemon. **Decision:** version the **wire protocol** separately from the
app/bundle version, and have the reattach handshake accept a compatible protocol **range** (not exact
app version). Routine auto-updates (which rarely change the protocol) reattach and sessions survive;
only a genuinely protocol-breaking release needs a fallback (a later, separately-decided drain/respawn).
This decouples release churn from protocol churn and preserves survival on the motivating flow. Chosen
over client-side drain+respawn (needs cross-version session hand-off) and version-scoped-socket
(loses sessions on every update — negates the feature).

### D10 (new, post-review-2) — close-tab DETACHES (survival across all three going-away gestures)
FINDING-023: the survival guarantee held for only 2 of 3 gestures — quit-app (survives) and
disconnect-banner (survives) both route through `teardownWire`, but **closing a remote workspace tab**
routed through a `pty:kill` of the remote panes, silently destroying the session. **Decision (human
Kevin):** closing a remote workspace tab must **DETACH** (route through the same `teardownWire` path,
leaving the daemon + PTYs running to reattach on reopen, idle-reaped by D3 if not) — never `pty:kill`
the remote panes. Consistent single "survival" story across all three gestures. Encode as a REQ so a
test pins close-tab-detach for remote workspaces (local workspaces unchanged).

**These decisions loop back through spec** (amend the REQs) so plan/tests/implement re-propagate,
alongside the three mechanical contract fixes FINDING-005 (umask-atomic 0600 socket), FINDING-008
(established-connection COUNT, not boolean), FINDING-016 (delete the bridge's unguarded check-then-unlink;
daemon's claimSocket owns all reclaim).
