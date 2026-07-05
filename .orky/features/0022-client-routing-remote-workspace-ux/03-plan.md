# Plan — 0022-client-routing-remote-workspace-ux (F21)

**Phase:** 3 (plan). **Input:** `02-spec.md` (REQ-001..REQ-020), the merged F15–F20 trees.
Brownfield fit: consume `src/remote-client/` + `@shared/remote/protocol` + `@shared/remote-agent-api`
from a NEW `src/main/remote/` service composed in `services.ts`; extend the IPC contract per its
existing per-domain registrar pattern; renderer work rides the existing store-slice + component
conventions. No agent-side change, no F15 barrel change, no new frame types.

**Router note:** planner dispatched at tier low (sonnet/medium) per router; this driver
environment has no parallel agent-dispatch tool, so the producer ran driver-inline
(0016/0017/0019/0020/0021 precedent).

## Target layout

```
src/shared/
  remote-home.ts            NEW   WorkspaceHome, normalizeWorkspaceHome, remoteAllowedDomains
  remote-workspace.ts       NEW   RemotePhase, RemoteDisconnectReason, RemoteWorkspaceState
  types.ts                  EDIT  Workspace.home?: WorkspaceHome; SCHEMA_VERSION = 9 (v8→v9 comment)
  workspace-model.ts        EDIT  migrate(): documented-identity v<9 case; normalizeWorkspaceHome
                                  applied in deserializeWorkspace AND workspaceFromTemplate
  ipc-contract.ts           EDIT  6 remote:* channels; PtySpawnArgs.remote?; TermhallaApi methods
src/main/remote/
  agent-artifact.ts         NEW   pure dev/packaged artifact path resolver + manifest version
  remote-workspace-manager.ts NEW connection-per-workspace lifecycle, abort, state pushes,
                                  pty op routing, evt forwarding, ack policy, reconnect/attach
src/main/ipc/
  register-remote.ts        NEW   remote:* handlers (agents list/save, connect, disconnect, current)
  register-pty.ts           EDIT  ptySpawn/write/resize/kill delegate to the manager when the pane
                                  is remote (spawn: args.remote present; others: manager.owns(id));
                                  local path byte-identical when absent
  register.ts               EDIT  compose register-remote; thread the manager into register-pty
src/main/services.ts        EDIT  construct RemoteWorkspaceManager (userData agents path, routed
                                  send, real scheduler, connectWithProvisioning injection); stop()
electron-builder.yml        EDIT  extraResources: out/agent/termhalla-agent.cjs
src/preload/index.ts        EDIT  the 6 new api methods
src/renderer/
  api.ts                    (no change needed — window.termhalla passthrough; verify)
  store/remote-slice.ts     NEW   remoteStates, namedAgents, selectors; injected IPC (op.ts pattern)
  store/types.ts            EDIT  slice state + action types (incl. newRemoteWorkspace)
  store.ts                  EDIT  compose slice; newRemoteWorkspace action; movePaneToWorkspace
                                  cross-home guard
  components/RemoteBanner.tsx      NEW  workspace-body overlay (connecting/disconnected + actions)
  components/RemoteAgentPicker.tsx NEW  Modal-substrate picker (list/add/seed/remove agents)
  components/WorkspaceView.tsx     EDIT banner mount; empty-state +Editor/+Explorer gating
  components/SplitMenu.tsx         EDIT kind-button gating (fs/orky domains) with reason titles
  components/TemplatesMenu.tsx     EDIT built-in "Remote workspace…" row (cockpit-row pattern)
  components/CommandPalette.tsx    EDIT palette entry -> newRemoteWorkspace
  components/TerminalPane.tsx      EDIT recStart gate (recording domain) for remote panes
  components/UsageWatcher.tsx      EDIT skip panes of remote-home workspaces
  components/OrkyWatcher.tsx       EDIT skip panes of remote-home workspaces
docs/features/remote-workspaces.md NEW  feature doc (REQ-020)
docs/features/remote-bootstrap.md  EDIT FINDING-005 contract note -> shipped cancel affordance
docs/superpowers/0018-...-followups.md EDIT FINDING-004/006 discharge annotations
CLAUDE.md                          EDIT "Where things live" row
CHANGELOG.md                       EDIT entry
```

Unchanged (load-bearing): everything under `src/agent/`, `src/shared/remote/`,
`src/remote-client/` (consumed as-is), the local spawn path in `register-pty.ts`/`PtyManager`,
`window-manager.ts` transit machinery (reused, not modified), `.orky/profiles/node-app.json`.

## Core design notes

- **Manager seams are injected** for vitest: `connect` (defaults to
  `connectWithProvisioning`), `loadAgents` (agents-store at the injected path), `send` (the
  routed pane-scoped send from registerHandlers), `scheduler` (real timers at the composition
  root — CONV-036), `version`/`artifactPath` (from `agent-artifact.ts`). All remote unit tests
  run in-process with stub wires (locked decision 1 posture; no ssh in tests).
- **Pane registry:** `Map<paneId, { workspaceId, state: 'live' | 'exited' }>` per connection +
  `Map<workspaceId, Entry>`; `owns(paneId)` steers register-pty delegation for write/resize/kill.
- **Reconnect determinism:** re-adopt in sorted pane-id order; `\x1bc` + snapshot exactly once;
  apply attach dims, then the renderer-driven resize (only if it differs — redundant-resize
  gotcha applies to the wire).
- **State pushes** are app-global broadcasts (`remote:state`), keyed by workspaceId in the slice;
  `remote:current` seeds on boot (cloudCurrent precedent).
- **Renderer purity:** the slice takes `() => api.*` thunks from the thin store composition; no
  `../api` import in pure logic (repo convention).

## Tasks

- **TASK-001** — `src/shared/remote-home.ts` + `Workspace.home?` in `types.ts`: the
  `WorkspaceHome` union, `normalizeWorkspaceHome` (coercion rules per REQ-001),
  `remoteAllowedDomains` (REQ-017 helper). Deps: none. Satisfies: REQ-001, REQ-017.
- **TASK-002** — Schema bump + migration: `SCHEMA_VERSION = 9` (+ v8→v9 comment), `migrate()`
  documented-identity case, `normalizeWorkspaceHome` applied in `deserializeWorkspace` and
  `workspaceFromTemplate`. Files: `types.ts`, `workspace-model.ts`. Deps: TASK-001.
  Satisfies: REQ-002, REQ-001.
- **TASK-003** — Contract: `remote-workspace.ts` (state shapes); `ipc-contract.ts` channels +
  `PtySpawnArgs.remote?` + `TermhallaApi` methods. Deps: TASK-001. Satisfies: REQ-005.
- **TASK-004** — Preload bridge: implement the 6 methods in `src/preload/index.ts`.
  Deps: TASK-003. Satisfies: REQ-005.
- **TASK-005** — `agent-artifact.ts`: pure dev/packaged resolver + the ONE manifest version;
  `electron-builder.yml` `extraResources`. Deps: none. Satisfies: REQ-006.
- **TASK-006** — Manager lifecycle core (`remote-workspace-manager.ts`): per-workspace entry,
  coalesced connect, AbortController per attempt + `stop()` abort-all (REQ-007), state machine +
  `remote:state`/`remote:current` (REQ-014), disconnect classification incl. `lease:revoked` →
  `lease-stolen` (REQ-012) and clean-exit vs lost (REQ-013), diagnostics pass-through unweakened
  (REQ-007). Deps: TASK-003, TASK-005. Satisfies: REQ-006, REQ-007, REQ-012, REQ-013, REQ-014.
- **TASK-007** — Flow-control consumption in the manager: fresh `createClientAckPolicy` per
  (re)connection, ack-on-data, scheduled quiet-flush (injectable scheduler), `paneClosed`/
  `dispose` pruning, structurally no window-frame emission. Deps: TASK-006. Satisfies: REQ-009.
- **TASK-008** — Pty routing + forwarding + reconnect: spawn param mapping (strip launch/envId),
  duplicate-spawn adoption/refusal (FINDING-004 discipline), adopted-signal polarity, write/
  resize/kill mapping + drop-while-disconnected, redundant-resize suppression, evt → routed send
  forwarding (data/status/cwd/exit; prune on exit), inventory-driven reconnect (sorted attach,
  `\x1bc`+snapshot, dims, missing→exit) per REQ-013. Deps: TASK-006, TASK-007.
  Satisfies: REQ-008, REQ-010, REQ-011, REQ-013.
- **TASK-009** — Composition: `register-remote.ts` (agents list/save via agents-store at
  `<userData>/remote-agents.json`, connect/disconnect/current), `register.ts` composition,
  `register-pty.ts` delegation branch (local path untouched — REQ-019), `services.ts`
  construction + shutdown wiring. Deps: TASK-004, TASK-006, TASK-008.
  Satisfies: REQ-004, REQ-005, REQ-006, REQ-010, REQ-019.
- **TASK-010** — Renderer `remote-slice.ts` + store composition: `remoteStates` upserts from
  `onRemoteState`, `remoteCurrent` seed, `namedAgents` load/save actions, per-workspace
  `phase`/`capabilities`/`allowedDomains` selectors; injected IPC thunks. Deps: TASK-003.
  Satisfies: REQ-014, REQ-004.
- **TASK-011** — New-remote-workspace flow: `newRemoteWorkspace(agentId?)` store action
  (registration parity with `newWorkspace` incl. `reportAssignment`; one terminal pane, cwd `''`,
  fresh ids), `RemoteAgentPicker.tsx` (Modal substrate; list/add/seed-from-favorite/remove;
  CONV-007/020/042/043/044/055), `TemplatesMenu` built-in row, `CommandPalette` entry.
  Deps: TASK-002, TASK-010. Satisfies: REQ-015.
- **TASK-012** — `RemoteBanner.tsx` + `WorkspaceView` mount: connecting (Cancel →
  `remoteDisconnect`) / disconnected (reason copy + diagnostic + Reconnect → `remoteConnect`);
  keep-mounted overlay (body-sibling, no portal); failure toast via `pushToast` chokepoint
  (indeterminate wording preserved). Deps: TASK-010. Satisfies: REQ-016, REQ-012 (copy).
- **TASK-013** — Capability greying gates: `SplitMenu` editor/explorer/orky kind buttons +
  empty-workspace `+ Editor`/`+ Explorer` (disabled + reason title), `TerminalPane` recStart
  gate, `UsageWatcher`/`OrkyWatcher` remote-pane skip, remote terminal default cwd `''` (no local
  favorite-dir seeding). Deps: TASK-001, TASK-010. Satisfies: REQ-017, REQ-011 (renderer side).
- **TASK-014** — `movePaneToWorkspace` cross-home guard (pure predicate + toast; local→local
  unchanged). Deps: TASK-001. Satisfies: REQ-018.
- **TASK-015** — Local byte-identity guard support: manager-spy seam assertion that a full local
  pty cycle never touches the manager; verify zero remote side effects with no remote workspace.
  Deps: TASK-009. Satisfies: REQ-019.
- **TASK-016** — Docs: `docs/features/remote-workspaces.md`, CLAUDE.md row,
  `remote-bootstrap.md` FINDING-005 note update, 0018 follow-ups discharge annotations,
  CHANGELOG. Deps: all. Satisfies: REQ-020.
- **TASK-017** — *(executed by the TESTS phase — the sanctioned frozen-suite amendment actor,
  CONV-019/CONV-022)* Frozen-pin amendment set per REQ-003: TEST-746 + remote-client scope-guard
  supersession; the enumerated SCHEMA_VERSION re-pins (unit + e2e). Satisfies: REQ-003.

## Order

TASK-001 → TASK-002/TASK-003 → TASK-004/TASK-005 → TASK-006 → TASK-007 → TASK-008 → TASK-009 →
TASK-010 → TASK-011/TASK-012/TASK-013/TASK-014 → TASK-015 → TASK-016 (TASK-017 rides the tests
phase before implementation).

## Open issues

None — every REQ maps to ≥1 task below (see `traceability.json`).
