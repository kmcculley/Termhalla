# Remote workspaces — client routing + per-workspace home (Remote Agent v1, batch 5 — F21)

The UX capstone of the Remote Agent epic: the feature that wires the merged F15–F20 stack into the
product. Feature dir: `.orky/features/0022-client-routing-remote-workspace-ux`.

## Per-workspace home (locked decision 7)

A workspace has a **home**: local (the absent-field default — byte-identical pre-F21 behavior) or a
**named agent** (`Workspace.home = { kind: 'agent', agentId, agentName }`). Every pane in a
workspace lives at its home; a workspace holds at most **one** agent connection; cross-workspace
pane moves between different homes are refused (`paneMoveRefusalReason` in
`src/shared/remote-home.ts` — a running PTY cannot teleport machines, and even two workspaces homed
to the same agent hold two distinct connections in v1).

Persistence: `SCHEMA_VERSION` 8 → 9 (a documented-identity migration — the bump exists so a pre-v9
build rejects a v9 file instead of silently dropping the home and spawning remote-intended panes as
local shells). `normalizeWorkspaceHome` runs at every deserialization door (file load AND template
instantiation — CONV-026); a malformed agent home is coerced but **kept remote**, never silently
local. Templates carry the home (`templateFromWorkspace`/`workspaceFromTemplate`).

## The connection (`src/main/remote/remote-workspace-manager.ts`)

`RemoteWorkspaceManager` — ONE per app (`services.ts`), electron-free by construction (every impure
edge injected):

- **Connect** = F19's `connectWithProvisioning` (system-ssh stdio exec channel, client-provisioned,
  version-locked to the ONE manifest version — `agent-artifact.ts` reads the same `package.json`
  that inlines `AGENT_VERSION`; the packaged artifact ships via `extraResources`). Triggered by the
  first remote `pty:spawn` or an explicit `remote:connect`; concurrent triggers coalesce.
- **Cancellation is caller-owned** (the F19 FINDING-005 contract): an `AbortController` per
  attempt; `remote:disconnect` during `connecting` is the user-facing Cancel; `stop()` aborts
  everything at shutdown (the long-lived-child gotcha).
- **Flow control** (F17): a **fresh `createClientAckPolicy` per (re)connection** — the F17×F18 weld
  rule (flow accounting is connection-scoped; never carried across reconnects) — acking at the
  64 KiB default cadence against the agent's 1 MiB default window (well below `floor(window/2)`,
  0018 FINDING-006), with a REALLY-scheduled quiet-flush timer (CONV-036; the composition root
  injects real timers). The client never emits a `window` frame in v1.
- **Pane-id discipline** (0018 FINDING-004): pane ids are uuid-fresh per pane; the manager never
  re-issues `pty:spawn` for an id already seen on the same connection (live → adopt; exited →
  refuse with a diagnostic).
- **Lease displacement** (F20): `lease:revoked` is the displaced connection's final meaningful
  frame — everything after it is ignored — and surfaces as `disconnected/lease-stolen`; Reconnect
  steals back.

## Routing (transparent to the renderer)

`register-pty.ts` delegates by ownership: a spawn carrying `PtySpawnArgs.remote` short-circuits the
ENTIRE local stack (no StatusEngine, no Process/Ai trackers, no recorder, no search indexer, no git
hooks); write/resize/kill probe `remote.owns(id)` first. Remote spawns strip `launch`/`envId` (the
v1 agent rejects them by name) and put EXACTLY `{id, shellId, cwd, cols, rows}` on the wire
(`pty:kill` params are the bare id string — the F16 contract). Redundant resizes are suppressed
(the ConPTY-repaint gotcha applied to the wire).

Agent evt pushes forward 1:1 onto the SAME routed pane-scoped `send` local PTY events ride —
window ownership, minimize/restore transit buffering, and undock handoff all work unchanged for
remote panes. Status chips are **agent-sourced** (F16's `pty:status` payload passes through with an
absent `lastExit` kept an absent key); `pty:cwd` reaches the renderer only (the chip), never the
local git/usage/indexer hooks.

## Reconnect + daemon survival (feature 0024-agent-daemonization)

On every (re)connection the manager runs the F18 inventory flow: one `pty:sessions`, then per
tracked pane in sorted id order — in inventory → `pty:attach` (a `\x1bc` reset preamble + the
serialize snapshot exactly once, status/cwd re-pushed, the renderer-recorded dims re-applied when
they differ); tracked-but-never-spawned → first spawn; spawned-and-gone → surfaced as exited.

**The agent is now daemonized (feature 0024), and this manager needed only a one-line change for
it** (it threads the workspace id through as the daemon scope). Production connects (`services.ts`)
pass `BootstrapOptions.daemon: { workspaceId }`, which opts `connectWithProvisioning` into the
daemon flow (`docs/features/remote-agent.md` § "Daemonization"): a persistent, **per-workspace**
process listening on a workspace-keyed unix-domain socket (`agent-<wsToken>.sock`) under
`~/.termhalla/agent/`, reached through a thin ssh-exec bridge, surviving the client
closing/reopening. One daemon per remote workspace means two workspaces on the **same host** are
fully independent — opening the second never disconnects the first (locked D6′/REQ-018). Because
this manager's re-adoption is purely **inventory-driven** — it never assumed the wire's other end
dies with the connection — a reconnect finds the SAME daemon and the SAME `pty:sessions` inventory:
live panes reattach with their full scrollback intact (the headline survival story), exactly the
reattach-with-snapshot path F18/F20's suites already exercised in-process. Survival holds across a
routine Termhalla **auto-update** too: the wire protocol is versioned separately from the app
(locked D4′), so close → update → reopen reattaches to the still-running old-app-version daemon and
its sessions survive the update. Only a genuinely protocol-breaking release drifts, and it is
refused non-destructively — the old daemon's sessions keep running until it idles out or is manually
terminated. A protocol-drifted daemon, or a genuinely idled-out/dead endpoint, still surfaces
through the ordinary connect-failure path above (`disconnected/connect-failed`) — no daemon-specific
branch exists in this file at all; see remote-agent.md for the full close/reopen story and the
non-destructive drift refusal.

### Three going-away gestures, one survival story (feature 0024, locked D10 / REQ-019)

Three gestures make a remote workspace's connection go away — quitting the app, the banner's
Disconnect, and closing the workspace's TAB — and all three now DETACH rather than kill: the wire
tears down (the same `teardownWire` semantics quit-app and the banner already used) while the
daemon and its live PTYs keep running, surviving for the F18 reattach. Closing the tab
(`closeWorkspace` in `store.ts`) used to `pty:kill` every remote pane first — silently destroying
the very session this feature exists to preserve (FINDING-023) — it now routes through the pure
`routeWorkspaceTeardown` core (`src/renderer/store/pane-ops.ts`): a REMOTE workspace close issues
ZERO `pty:kill` calls and exactly one detach (`disconnectRemote(id, { forget: true })`, an additive
optional param on the EXISTING `remote:disconnect` channel — no new IPC surface); a LOCAL workspace
close stays byte-identical (one kill per pane, no detach). `RemoteWorkspaceManager
.disconnectWorkspace`'s `{ forget: true }` always forgets the manager's entry — even with panes
still tracked — so no ghost state survives in `currentStates()`/`remote:current`
(detach-then-forget, not kill-then-forget). Reopening the SAME workspace (same `wsToken`)
reattaches to the surviving daemon exactly as the headline REQ-015 scenario describes. **Disclosed
consequence (CONV-054/FINDING-027/FINDING-030):** idle-reap requires BOTH zero established
connections AND zero live panes (REQ-006's `maybeArm` gate) — an unreopened workspace whose panes
have already ended does idle-reap on its own, but a detach with a STILL-RUNNING pane (the flagship
survival case — a live `claude`) does NOT idle-reap: the daemon and its live PTYs persist until
that process exits on its own or is manually terminated (SSH, or reopen the workspace then close
the individual pane). There is no app-side affordance in v1 to enumerate or reap a detached
workspace's daemon — closing the tab trades an immediate kill for an invisible, uncapped-lifetime
remote process until one of those paths ends it; a fleet-visibility/reap follow-up is tracked in
`docs/superpowers/0024-agent-daemonization-review-followups.md` (FINDING-030). Closing an
INDIVIDUAL remote pane (not the tab) remains a deliberate kill of that one pane — unchanged.

## UX

- **The banner** (`RemoteBanner.tsx` + the pure `remote-banner-model.ts`; testid `remote-banner`):
  a workspace-body overlay (a `.mosaic` sibling — no portal). `connecting` → Cancel
  (`remote-cancel`); `disconnected` → reason copy + diagnostic + Reconnect (`remote-reconnect`).
  Panes are NEVER unmounted under it — a disconnected pane freezes with its xterm intact (the
  keep-mounted discipline). Failures also route one error toast through the store chokepoint
  (indeterminate wording preserved).
- **Capability greying** (locked decision 6): `remoteAllowedDomains` — local = all; remote
  connected = the handshake-advertised set; otherwise `['pty']`. Gated affordances (disabled with
  an actionable reason, never hidden): SplitMenu's editor/explorer/orky kind buttons, the
  empty-workspace `+ Editor`/`+ Explorer`, recording default-start, and the Usage/Orky watch
  reconcilers skip remote panes (`remote-gates.ts`).
- **Creating one**: the `Remote workspace…` templates-menu row / palette entry opens
  `RemoteAgentPicker` (list/add/seed-from-SSH-favorite/remove named agents — connection config
  only, an identity-file PATH at most; persisted at `userData/remote-agents.json` via F19's
  normalizing atomic store). Create → a workspace homed to the agent with one terminal at the agent
  home dir (`cwd: ''`), registered with the full arrangement report and focus landing in the
  terminal.

## IPC surface

`remote:agentsList` / `remote:agentsSave` / `remote:connect` / `remote:disconnect` /
`remote:current` + the `remote:state` push (`RemoteWorkspaceState` in
`src/shared/remote-workspace.ts`). Remote pty/status traffic rides the existing `pty:*` channels.
The renderer keeps ZERO Node/Electron imports; the protocol + `remote-client` stay confined to
`src/main/` (the superseded TEST-746/TEST-2001 guards now pin exactly that).

## Suite

TEST-2201..TEST-2280 (unit; `tests/{shared,main,renderer}/remote-*`, `tests/docs-feature-0022.test.ts`)
+ `tests/e2e/remote-workspace.spec.ts` (TEST-2272..2275, `npm run e2e` only — witnessed per
CONV-052). The frozen-pin amendment record lives in the feature dir's `04-tests.md`.

Since the 2026-07-09 quality/polish batch the **connected** path also runs in-app (the spec above
deliberately connects to a `.invalid` host and pins only the failure surface): the env-gated
`TERMHALLA_E2E_REMOTE_SSH` seam (`src/main/e2e-remote.ts`, structurally pinned single reader)
routes production connects through `tests/fixtures/fake-ssh.mjs` with `--pty=fake` forced, and
`tests/e2e/remote-connected.spec.ts` (TEST-QA01..03: provision → banner clears → live round-trip →
connected caps) + `tests/e2e/remote-reconnect.spec.ts` (TEST-QA20..21: transport kill →
connection-lost banner → reattach to the SAME daemon with history intact exactly once) drive the
real agent/bridge/daemon under production wiring. Shared plumbing + the load-bearing teardown
order live in `tests/e2e/remote-harness.ts`. That first in-app green run caught two real bugs: the
dev artifact path doubling under entry-file launches (`services.ts` devAppRoot) and the fake
backend's missing CR line-terminator handling.
