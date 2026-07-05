# Spec — 0022-client-routing-remote-workspace-ux (F21)

**Feature:** Client routing + remote-workspace UX (per-workspace home).
**Baseline:** brownfield (`.orky/baseline/`), Remote Agent v1 epic capstone. Everything upstream is
merged: F15 protocol (`src/shared/remote/`), F16 agent (`src/agent/`), F17 flow control
(`flow-control.ts`), F18 replay/survival (`pty:attach` + `pty:sessions`), F19 remote client
(`src/remote-client/`, `src/shared/remote-agents.ts`), F20 exclusive lease (`lease:revoked`).
This feature CONSUMES them; it re-derives nothing.

## Concerns

`networking`, `determinism`, `ux`

## Locked decisions honored (not re-opened)

- **D7 (per-workspace home):** a workspace has a home — local (absent field) or a named agent.
  Every pane in it lives at its home; ONE connection per workspace; cross-workspace pane moves
  between different homes are out of scope.
- **D6 (capability partition):** unsupported domains are greyed per remote workspace from the
  handshake's advertised capability set (`CAPABILITY_IDS` vocabulary; v1 agent = `pty` + `status`).
- **D5 (exclusive attach):** the client renders F20's `lease:revoked` displacement as the
  disconnected banner.
- **D1 (transport):** system-ssh stdio exec channel via `src/remote-client/` — never an SSH
  library, never a hand-built handshake.

## Terminology

- **Remote-home workspace:** a `Workspace` whose `home` field is `{ kind: 'agent', ... }`.
- **The manager:** the new main-process `RemoteWorkspaceManager` (composition: `services.ts`).
- **Advertised capabilities:** the `capabilities` array from the agent hello, surfaced through the
  connection state push.

---

## A. Persisted model + schema

### REQ-001 — `WorkspaceHome` model (MUST)

A new environment-pure shared module `src/shared/remote-home.ts` MUST define:

```ts
export type WorkspaceHome = { kind: 'agent'; agentId: string; agentName: string }
```

and `Workspace` (`src/shared/types.ts`) MUST gain an optional `home?: WorkspaceHome` field.
An ABSENT `home` means local — the byte-identical default. The module MUST export
`normalizeWorkspaceHome(raw: unknown): WorkspaceHome | undefined` applied at EVERY
deserialization path of the persisted workspace shape (CONV-026: `deserializeWorkspace` AND
template instantiation `workspaceFromTemplate`):

- A value that is not a plain object, or whose `kind !== 'agent'` → `undefined` (local).
- `kind === 'agent'` with a missing/empty/non-string `agentId` or `agentName` → the field is
  COERCED to `''` (kept remote, never silently local): a workspace meant for a remote machine
  MUST NOT fall back to spawning local shells (REQ-006 refuses an empty `agentId` with an
  actionable diagnostic instead). Unknown extra keys are stripped.
- A well-formed home passes through untouched; the serialize→deserialize round trip of a
  well-formed record is byte-identical.

**Acceptance:** unit tests over `normalizeWorkspaceHome` and `deserializeWorkspace` cover: absent
(local), well-formed round-trip byte-identity, non-object / wrong-kind → local, missing
`agentId` → coerced `''` + still `kind:'agent'`, unknown keys stripped, malformed input never
throws (CONV-002).

### REQ-002 — SCHEMA_VERSION 8 → 9 (MUST)

`SCHEMA_VERSION` (`src/shared/types.ts`) MUST become `9`. The `migrate` step in
`workspace-model.ts` MUST add the `v < 9` case as a DOCUMENTED IDENTITY (a pre-v9 record cannot
contain a `home`, so nothing is rewritten; the bump exists so a pre-v9 build rejects a v9 file via
the "newer than supported" guard instead of silently DROPPING the home and spawning panes meant
for a remote machine as local shells — the v7→v8 precedent, with a sharper safety rationale).
`migrateAppState` needs no new case (it is version-tolerant; only the newer-than-supported guard
moves with the constant).

**Acceptance:** unit tests assert `SCHEMA_VERSION === 9`; v6/v7/v8 fixtures still deserialize with
all panes + view-state preserved (existing migration semantics byte-for-byte); a v8 fixture gains
no `home`; a v9 record with `home` round-trips; migration is idempotent and deterministic (the
TEST-376/377/378 pattern); a v10 file is rejected with the actionable "newer than supported" error.

### REQ-003 — Frozen-pin amendments + scope-guard retirements (MUST, tests phase only)

Per CONV-019/CONV-022, the following frozen tests are amended ATOMICALLY at THIS feature's tests
phase (never during implementation), then the freeze is re-captured. Enumeration per CONV-023 —
grep patterns `toBe\(8\)`, `SCHEMA_VERSION = 8`, and `schemaVersion.*8` run repo-wide over
`tests/` at spec time (2026-07-04), audited hit-by-hit; the tests-phase RED run MUST re-verify the
failing set is exactly this list plus this feature's own new suites (CONV-059 — the red run sees
assembled needles grep cannot):

1. `tests/remote-protocol-guards.test.ts` TEST-746 — the zero-consumer scope guard names F21 as
   its retiring feature. It MUST be SUPERSEDED (not deleted) by its natural successor: no file
   under `src/preload/` or `src/renderer/` imports `shared/remote`; `src/main/` MAY (the renderer
   zero-Node invariant survives; the header's retirement note is updated).
2. `tests/remote-client-structure.test.ts` (the `remote-client` zero-consumer guard, retirement
   named F21) — same treatment: `src/main/` MAY import `remote-client`; preload/renderer MUST NOT.
3. SCHEMA_VERSION literal pins re-pinned at `9` (each cites the sanctioned amendment in a comment):
   `tests/main/orky-needs-you-quickstore.test.ts` (TEST-559), `tests/main/orky-osc-structural.test.ts`
   (TEST-038), `tests/main/orky-registry-store.test.ts` (TEST-087),
   `tests/main/quick-store-toasts.test.ts` (TEST-008),
   `tests/renderer/decision-queue-panel-structure.test.ts` (TEST-344),
   `tests/shared/minimize-persistence.test.ts` (TEST-001),
   `tests/shared/orky-pane-migration.test.ts` (TEST-375 and the TEST-377 serialized
   `schemaVersion` expectation), `tests/shared/orky-status.test.ts` (the REQ/TEST-408-line pin),
   `tests/renderer/orky-cockpit-structure.test.ts` (TEST-671's
   `toContain('export const SCHEMA_VERSION = 8')` → `= 9`).
4. e2e (outside the unit gate, updated in the same tests phase): `tests/e2e/orky-cockpit.spec.ts`
   (`parsed.schemaVersion` 8→9), `tests/e2e/orky-pane.spec.ts` (same).

**Acceptance:** after the tests phase, `npm test` on the frozen suite set fails ONLY for
implementation-absence reasons (RED), not pin collisions; after implement, the whole suite is
green with `SCHEMA_VERSION === 9`.

### REQ-004 — Named-agent registry wiring (MUST)

The F19 path-injected store (`src/remote-client/agents-store.ts`) MUST be wired at
`<userData>/remote-agents.json`. New IPC (read/write the FULL list, `quick:save` posture):
`remote:agentsList` → `NamedAgent[]`, `remote:agentsSave(agents)` → the normalized saved list.
Both run `normalizeNamedAgents` (no secret can ride a round-trip; identity-file PATH at most —
baseline no-secrets posture). A save that fails at the disk MUST reject (the envSetGlobal
precedent) so the UI never toasts a false success.

**Acceptance:** unit tests over the registrar seam (store path injection, normalize-on-both-doors,
reject-on-write-failure); malformed/missing file → `[]`, never a throw.

---

## B. Connection + routing (main process)

### REQ-005 — IPC contract additions; renderer purity (MUST)

`src/shared/ipc-contract.ts` gains (domain:verb, push channels commented as such):

- `remoteAgentsList: 'remote:agentsList'`, `remoteAgentsSave: 'remote:agentsSave'`
- `remoteConnect: 'remote:connect'` (renderer → main; begin/retry the workspace's connection)
- `remoteDisconnect: 'remote:disconnect'` (renderer → main; cancels an IN-FLIGHT connect too)
- `remoteState: 'remote:state'` (main → renderer push; one `RemoteWorkspaceState`)
- `remoteCurrent: 'remote:current'` (renderer → main pull of ALL current states — recovers a
  missed push; the `cloudCurrent` precedent)

`PtySpawnArgs` gains an OPTIONAL `remote?: { workspaceId: string; agentId: string }`; local spawns
omit it (wire-compatible). `TermhallaApi` gains the matching methods
(`remoteAgentsList/remoteAgentsSave/remoteConnect/remoteDisconnect/remoteCurrent/onRemoteState`),
implemented in preload + a new per-domain registrar `src/main/ipc/register-remote.ts` composed by
`register.ts`. A new pure shared type module (`src/shared/remote-workspace.ts`) defines:

```ts
export type RemotePhase = 'connecting' | 'connected' | 'disconnected'
export type RemoteDisconnectReason =
  | 'lease-stolen' | 'connection-lost' | 'connect-failed' | 'cancelled' | 'agent-exited'
export interface RemoteWorkspaceState {
  workspaceId: string
  agentId: string
  agentName: string
  phase: RemotePhase
  capabilities: string[]           // advertised set while connected; [] otherwise
  reason?: RemoteDisconnectReason  // present iff phase === 'disconnected'
  diagnostic?: string              // bounded, control-char-sanitized (REQ-007)
}
```

The renderer keeps ZERO Node/Electron imports: everything above reaches it only through
`window.api`; renderer pure logic takes the IPC calls as injected arguments (the `op.ts` /
`store/pane-ops.ts` pattern).

**Acceptance:** structural tests — the superseded TEST-746/TEST-2001-class guards (REQ-003) pin
preload/renderer purity; a contract test pins the new channel names + `PtySpawnArgs.remote`
optionality (absent for local spawns).

### REQ-006 — One connection per workspace; version-locked auto-connect (MUST)

A new `RemoteWorkspaceManager` (`src/main/remote/`) MUST hold AT MOST one agent connection per
workspaceId (D7). It connects via F19's `connectWithProvisioning` — never a re-derived handshake —
with:

- the `NamedAgent` seed resolved by `agentId` from the REQ-004 registry (an unknown or empty
  `agentId` → `disconnected/connect-failed` with an actionable diagnostic naming the id, CONV-001;
  never a local fallback);
- ONE canonical `version` read from the same manifest that inlines `AGENT_VERSION`
  (`package.json` `version`) — never hand-typed;
- the bundled artifact path resolved by a pure helper: dev → `out/agent/termhalla-agent.cjs`,
  packaged → under `process.resourcesPath` (electron-builder gains the matching `extraResources`
  entry so the artifact ships).

Connection establishment is triggered by the FIRST remote `pty:spawn` for the workspace or an
explicit `remote:connect`. Concurrent triggers while connecting MUST coalesce onto the in-flight
attempt (never a second ssh child per workspace).

**Acceptance:** unit tests against an injected connect function: one attempt per workspace under
concurrent spawn+connect triggers; unknown-agent refusal shape; version/artifact injection
(resolver tested for both dev and packaged shapes).

### REQ-007 — Caller-owned cancellation + diagnostics contract (MUST)

Per F19's FINDING-005 (`docs/features/remote-bootstrap.md` Contract notes): the manager MUST own
an `AbortController` per connection attempt and wire `options.signal`. `remote:disconnect` during
`connecting` aborts the attempt (state → `disconnected/cancelled`); it is the user-facing cancel.
All live connections and in-flight attempts are aborted on app shutdown (the abortable +
`unref()`'d long-lived-child gotcha; `spawnSsh` already unrefs). Diagnostics surfaced into
`RemoteWorkspaceState.diagnostic` MUST pass through the bootstrap's classify output UNWEAKENED:
the node-missing conflation hint (`provision-ineffective`) and the shell-rc framing-noise hint
stay visible, bounded, control-char-sanitized; an indeterminate outcome keeps its indeterminate
wording (CONV-015).

**Acceptance:** unit tests: abort mid-connect settles the attempt and pushes
`disconnected/cancelled`; a `provision-ineffective` result's diagnostic reaches the state push
intact; `stop()`/dispose aborts everything (no dangling child keeps the loop alive under the fake
ssh shim).

### REQ-008 — Remote pty op routing (MUST)

For a spawn carrying `args.remote`, `register-pty.ts` MUST delegate to the manager INSTEAD of the
local `PtyManager` (local spawns take the existing path untouched — REQ-019). Routing rules:

- `pty:spawn` → wire req `pty:spawn` with EXACTLY `{ id, shellId, cwd, cols, rows }` — `launch`
  and `envId` MUST be stripped before the wire (the v1 agent validator rejects them by name);
  a remote spawn that carried them still works locally-authored UI-wise (they simply don't apply).
- `pty:write` / `pty:resize` / `pty:kill` for a pane the manager owns → the matching wire req
  (`AGENT_PTY_METHODS` / `AGENT_SESSION_METHODS` constants — never hand-typed strings).
  A redundant resize (unchanged cols/rows) MUST NOT be forwarded (the ConPTY-repaint gotcha
  applied to the wire).
- Pane ids: the manager MUST NOT issue `pty:spawn` twice for the same id on ONE connection
  (0018 FINDING-004): a spawn for an id currently LIVE on the connection is an adoption —
  `claimPane` + `replayInto` (transit/undock semantics, exactly the local `pty.has` branch) and
  resolves `true`; a spawn for an id that already EXITED on this connection is refused with a
  diagnostic (fresh panes always mint fresh uuids, so this is unreachable from the UI).
- `pty:spawn` resolves `false` on a genuinely fresh remote spawn, `true` on adoption (the
  renderer's auto-resume gate depends on this distinction).
- While the workspace is `disconnected`/`connecting`, write/resize are DROPPED (the pane is
  frozen under the banner); kill removes the pane client-side.

**Acceptance:** unit tests over the manager with an injected wire: exact spawn param shape
(launch/envId stripped), duplicate-spawn adoption vs refused-after-exit, redundant-resize
suppression, dropped ops while disconnected, kill routing.

### REQ-009 — Flow-control consumption (MUST)

The manager MUST create a FRESH `createClientAckPolicy()` per (re)connection — never carried
across reconnects (F17×F18 weld: flow accounting is connection-scoped). On every delivered
`pty:data` evt it runs `onData` and sends any produced ack frame. v1 declares NO `window` frames
(the agent's `DEFAULT_FLOW_WINDOW_BYTES` = 1 MiB with the default 64 KiB ack cadence keeps the
cadence well below `floor(window/2)` — 0018 FINDING-006); the manager exposes NO API that emits a
`window` frame. Residue MUST be flushed when the stream goes quiet: a REAL scheduled timer armed
by data arrival and cleared on quiet-flush/disconnect/dispose (CONV-036 — never only
lazily-on-next-event), scheduler injectable for tests, composition root injects real timers.
`paneClosed` prunes on pane exit; `dispose` on connection end.

**Acceptance:** unit tests: ack cadence at the 64 KiB default over accumulated chunks; quiet-flush
fires via the injected scheduler and empties residue; a reconnect gets a policy with ZERO carried
state; pane exit prunes its pending residue; no `window` frame is ever emitted.

### REQ-010 — Push forwarding rides the routed pane-scoped send (MUST)

Agent evt frames MUST be forwarded to the renderer through the SAME teardown-guarded, pane-scoped
routed `send` the local PTY stack uses (window ownership via `claimPane`, transit buffering via
`WindowManager.transit`/`replayInto`): `pty:data` → `CH.ptyData`, `pty:status` → `CH.ptyStatus`,
`pty:exit` → `CH.ptyExit`, `pty:cwd` → `CH.ptyCwd`. Consequently minimize/restore, same-window
cross-workspace moves, and multi-window undock of REMOTE panes work unchanged (keep-mounted +
transit disciplines inherited, no new buffer). `pty:exit` additionally prunes the pane from the
manager and the ack policy.

**Acceptance:** unit tests with an injected send spy: each evt channel maps 1:1 with args
`[id, payload…]`; after `pty:exit` the pane is pruned; a transit-armed pane's forwarded data is
buffered and replayed in order (exercised through the WindowManager seam or an injected
equivalent).

### REQ-011 — Agent-sourced status chips; zero local-tracker engagement (MUST)

Remote panes get IDENTICAL status chips: the forwarded `pty:status` payload
(`AgentStatusPayload`: `state`, optional `lastExit` as a dropped key, `since`) is consumed by the
existing renderer status path unchanged. For remote panes the main process MUST NOT engage any
local machine-coupled consumer: no `StatusEngine` registration, no `ProcessTracker`, no
`AiSessionTracker`, no git hooks (`onCwd`/`onCommandDone`/`onPaneGone` git side), no search
`indexer`, no `Recorder` data feed; the forwarded `pty:cwd` reaches the RENDERER only (the cwd
chip shows the remote cwd) — never the local git/usage/indexer cwd hooks.

**Acceptance:** unit tests: forwarding a remote `pty:status` produces the same
`CH.ptyStatus` payload shape a local pane would (absent `lastExit` stays absent, never
`undefined`-injected); with tracker/git/indexer/recorder spies injected, a remote pane's
spawn+data+cwd+exit cycle records ZERO invocations on all of them (scoped per CONV-051 to the
remote pane's id).

### REQ-012 — Lease displacement renders as the banner (MUST)

On the `lease:revoked` evt (`AGENT_LEASE_REVOKED_EVT` via `@shared/remote-agent-api` — never a
hand-typed literal), the manager MUST mark that workspace `disconnected/lease-stolen` and push the
state; the connection then ends per F20 (revoked-final-frame; nothing after it is processed —
inbound frames post-revocation are ignored). The banner copy for `lease-stolen` MUST say another
client attached (the loser-drop signal made visible) and offer Reconnect (which, per F20
semantics, steals back).

**Acceptance:** unit test: injecting a `lease:revoked` evt flips the state push to
`disconnected/lease-stolen` exactly once, ignores subsequent frames, and a `remote:connect`
afterwards starts a FRESH attempt (fresh ack policy per REQ-009).

### REQ-013 — Disconnect / reconnect lifecycle (MUST)

Transport death (ssh child exit, agent exit, handshake-established connection dropping) MUST push
`disconnected` with reason `connection-lost` (or `agent-exited` when the session handle reported a
clean agent exit) and a bounded diagnostic. `remote:connect` on a disconnected workspace starts a
fresh connection; ON establishment the manager MUST re-adopt its panes deterministically:

1. `pty:sessions` inventory (one req);
2. for each pane the manager still tracks for that workspace, IN SORTED pane-id order
   (determinism): present in inventory → `pty:attach`; the result repaints via the routed send —
   a reset preamble (`\x1bc`) then the snapshot, so the still-mounted xterm renders the agent
   snapshot EXACTLY once (no duplicated content; client-side scrollback beyond the agent's
   serialize depth is accepted lost) — then the pane is resized to the RENDERER's current dims
   (cols/rows from the attach result are applied first, per the F18 contract);
   absent from inventory → `CH.ptyExit` is surfaced for it (with a short
   `[remote session ended]`-class data line first) and it is pruned.
3. App-start flow needs no special path: mounted panes call `pty:spawn`, and the manager
   attach-or-spawns per pane against the fresh connection's inventory.

**v1 consequence stated (CONV-054):** the SHIPPED v1 agent is not daemonized — its owned session
store is destroyed when its stdio connection ends — so after a real transport drop the inventory
is empty and every pane surfaces as exited; live reattach-with-snapshot is exercised against the
in-process survival composition (`createAgentSession({ sessions: store })`) exactly as F18/F20's
suites do. The client-side flow above is REQUIRED to be inventory-driven so agent daemonization
(recorded open question) lands with no client change.

Disconnected panes FREEZE: they stay mounted (no xterm disposal — the keep-mounted discipline),
writes/resizes are dropped (REQ-008), and status chips keep their last state.

**Acceptance:** unit tests over the survival composition (in-process, injected stubs, no network —
locked decision 1's test posture): reconnect attaches in sorted order, emits reset+snapshot
exactly once per pane, applies attach dims then the renderer resize, surfaces exits for missing
panes, prunes them; the empty-inventory case surfaces every tracked pane as exited (the shipped
v1 reality).

### REQ-014 — Connection state surface (MUST)

Every phase transition pushes `remote:state` (app-global broadcast; the renderer keys by
`workspaceId`). `remote:current` returns all current states (pull-on-mount recovers a missed
push). A new renderer slice (`src/renderer/store/remote-slice.ts`, IPC injected — never importing
`../api` from pure logic) holds `remoteStates` + `namedAgents` and derives per-workspace
`phase`/`capabilities` selectors.

**Acceptance:** slice unit tests (injected IPC): state upserts by workspaceId; `remoteCurrent`
seeding; selector defaults (no state ⇒ not remote / empty capabilities).

---

## C. Renderer UX

### REQ-015 — New-remote-workspace flow + named-agent picker (MUST)

A store action `newRemoteWorkspace(agentId?)` MUST create a fresh workspace whose `home` is the
picked agent, containing ONE terminal pane with `cwd: ''` (the agent home dir per the wire
contract), minted with fresh pane ids; registration MUST match `newWorkspace` IN FULL including
the arrangement report (`reportAssignment` — the 0011 FINDING-001 lesson: an unreported workspace
is silently lost). Entry points: a Command Palette entry and a TemplatesMenu built-in row (the
cockpit precedent). Without an argument it opens a picker modal (portalled, the shared `Modal`
substrate) that lists named agents and supports: add (name/host/user/port/identity-file path —
never key material), seed from an existing SSH favorite (`seedNamedAgentFromConnection` — never
the tmux fields), and remove. A11y per standing conventions: focus moves into the first field on
open (CONV-020/CONV-042), Enter submits the single-submit form (CONV-043), a successful submit
disarms the form (CONV-044), visible focus/hover styling outside `.mosaic` (CONV-007), and on
create the picker closes with keyboard focus landing in the new workspace's terminal (CONV-055 —
never `<body>`). Cancel creates nothing.

**Acceptance:** e2e: open picker → add agent → create → a new workspace tab exists with a terminal
pane, `workspaces/<id>.json` persists `home` (schemaVersion 9), focus is in the terminal
(exact-locator per CONV-056); slice/unit tests for the store action's registration parity +
fresh-id minting; agents persist through `remote:agentsSave` (REQ-004).

### REQ-016 — Disconnected / connecting banner (MUST)

`WorkspaceView` MUST render a banner overlay (`data-testid="remote-banner"`, a workspace-body
sibling of `.mosaic` like `MinimizedTray` — no portal needed) whenever the workspace is
remote-home AND `phase !== 'connected'`:

- `connecting`: "Connecting to <agentName>…" + a **Cancel** button (→ `remote:disconnect`;
  REQ-007's user-facing cancel affordance).
- `disconnected`: reason-specific copy (`lease-stolen` names another client; `connection-lost`/
  `connect-failed`/`agent-exited`/`cancelled` name the cause + the bounded diagnostic) + a
  **Reconnect** button (→ `remote:connect`).

The banner NEVER unmounts panes: the mosaic and every pane body stay mounted under it
(`visibility`/overlay only — never `display:none`, never unmount; the keep-mounted discipline).
Buttons are target-guarded (CONV-030/CONV-041). A connect/reconnect FAILURE additionally routes
one error toast through the store's `pushToast` chokepoint (errors always show — CONV-004; the
banner is state, the toast is the never-silently-dropped outcome signal, CONV-034/CONV-053) with
indeterminate wording preserved where the outcome is indeterminate (CONV-015).

**Acceptance:** e2e (built app): a remote workspace with an unreachable agent shows the banner with
Reconnect + diagnostic; panes remain in the DOM under it (locator asserts the pane host is still
attached/mounted); Cancel appears during connecting. Unit: banner-visibility selector logic;
toast-on-failure via the chokepoint spy.

### REQ-017 — Capability greying (MUST)

A pure helper (`src/shared/remote-home.ts` or the slice) `remoteAllowedDomains(state)` MUST derive
the allowed capability set for a workspace: local ⇒ ALL; remote+connected ⇒ the advertised set;
remote+not-connected ⇒ `['pty']` (the connection trigger stays reachable). Gated affordances (each
DISABLED — not hidden — with an actionable title/aria-disabled reason naming the missing domain,
CONV-001):

- pane creation: SplitMenu kind buttons `editor`/`explorer` (need `fs`) and `orky` (needs `orky`);
  the empty-workspace `+ Editor` / `+ Explorer` buttons;
- recording: the default `recStart`-on-spawn and the rec toolbar control (need `recording`);
- usage/orky watch initiation (`UsageWatcher`/`OrkyWatcher`) MUST NOT start for panes of a remote
  workspace (need `usage`/`orky`); the git chip never appears (main never engages git for remote
  panes, REQ-011);
- env-vault injection and launch commands don't apply to remote spawns (stripped, REQ-008) — the
  terminal-create paths for a remote workspace MUST NOT offer local favorite dirs as the cwd (new
  remote terminals default `cwd: ''`).

**Acceptance:** unit tests over `remoteAllowedDomains` (all three states); component/e2e checks:
in a remote workspace the editor/explorer/orky split buttons are disabled with the reason text
while terminal stays enabled; a remote pane's spawn triggers no `recStart`/`usageWatch`/`orkyWatch`
(spy-scoped per CONV-051).

### REQ-018 — Cross-home pane moves are refused (MUST)

`movePaneToWorkspace` MUST refuse any move where the source and destination workspaces' homes
differ, AND any move between two REMOTE workspaces (even the same agent — connections are
per-workspace, and a running PTY cannot teleport connections in v1), with one actionable toast via
the chokepoint. Local→local moves are unchanged. Workspace-level undock/redock (the whole
workspace moving windows) is unaffected (the home travels with the workspace record).

**Acceptance:** unit test over the move guard (pure, injected): local→local allowed;
local→remote, remote→local, remote-A→remote-A(other ws), remote-A→remote-B all refused with the
reason string; e2e optional.

### REQ-019 — Local behavior byte-identical; characterization green (MUST)

When NO remote-home workspace exists: no ssh child is ever spawned, no remote module side effect
runs (manager construction is inert), local `pty:spawn` takes the exact pre-F21 path
(`PtySpawnArgs.remote` absent), and the FULL existing suite — including
`tests/characterization-*.test.ts` (CHAR-001..020) and every frozen suite not enumerated in
REQ-003 — stays green unmodified.

**Acceptance:** the gate itself (`npm run build` + `npm test`) plus a structural test asserting
`register-pty.ts`'s local branch is reached without touching the manager when `remote` is absent
(spy: zero manager invocations across a local spawn/write/resize/kill cycle).

### REQ-020 — Documentation (MUST)

`docs/features/remote-workspaces.md` (new) documents: per-workspace home, the connection
lifecycle + banner semantics, capability greying, the v1 no-daemonization consequence, and the
flow-control consumption contract. `CLAUDE.md`'s "Where things live" gains the row;
`docs/features/remote-bootstrap.md`'s FINDING-005 contract note is updated to point at the shipped
cancel affordance (and the 0020 ledger finding is resolved through the CLI at review/doc-sync,
citing it). The 0018 follow-ups doc's FINDING-004/FINDING-006 entries are annotated with how F21
discharged them. CHANGELOG updated.

**Acceptance:** doc-sync traceability green; docs name no stale claim (CONV-008 sweep for
"no renderer/main/preload wiring" claims that F21 retires — `docs/features/remote-*.md`,
`docs/superpowers/*`, `.orky/baseline/` checked for the zero-consumer phrasing).

---

## Public interface (summary)

- `src/shared/types.ts`: `Workspace.home?: WorkspaceHome`; `SCHEMA_VERSION = 9`.
- `src/shared/remote-home.ts`: `WorkspaceHome`, `normalizeWorkspaceHome`, `remoteAllowedDomains`.
- `src/shared/remote-workspace.ts`: `RemotePhase`, `RemoteDisconnectReason`, `RemoteWorkspaceState`.
- `src/shared/ipc-contract.ts`: the six `remote:*` channels; `PtySpawnArgs.remote?`;
  `TermhallaApi` additions (`remoteAgentsList`, `remoteAgentsSave`, `remoteConnect`,
  `remoteDisconnect`, `remoteCurrent`, `onRemoteState`).
- `src/main/remote/`: `RemoteWorkspaceManager` (+ pure helpers: artifact path resolver, routing
  tables); `src/main/ipc/register-remote.ts`.
- Renderer: `store/remote-slice.ts`, `newRemoteWorkspace` store action, `RemoteBanner` +
  `RemoteAgentPicker` components, SplitMenu/WorkspaceView/watcher gates.

## Non-goals

- Agent daemonization / session GC / reboot survival (open questions stay open; REQ-013 states
  the v1 consequence).
- Mirrored/shared attach (D5).
- Remote fs/editor/git/usage/orky/recording/env domains (greyed, not implemented).
- Cross-home pane moves (refused, REQ-018).
- Artifact GC on the remote host (0020 FINDING-007 stays deferred).
- No new agent-side code, no new wire frame types, no F15 barrel extension.

## Open questions

None blocking — all design decisions are locked by the roadmap (D1/D5/D6/D7) or resolved above by
the stated seams' existing contracts.
