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

## Reconnect + the v1 daemonization reality

On every (re)connection the manager runs the F18 inventory flow: one `pty:sessions`, then per
tracked pane in sorted id order — in inventory → `pty:attach` (a `\x1bc` reset preamble + the
serialize snapshot exactly once, status/cwd re-pushed, the renderer-recorded dims re-applied when
they differ); tracked-but-never-spawned → first spawn; spawned-and-gone → surfaced as exited.

**Shipped v1 consequence (CONV-054):** the v1 agent is **not daemonized** — its owned session store
dies with the stdio connection — so after a real transport drop the inventory is empty and every
pane surfaces as exited. The client flow is inventory-driven so agent daemonization (a recorded
open question) lands with no client change; live reattach-with-snapshot is exercised in-process
against the survival composition exactly as F18/F20's suites do.

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
