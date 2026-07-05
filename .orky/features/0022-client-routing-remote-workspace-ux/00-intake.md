# Intake — 0022-client-routing-remote-workspace-ux

**Captured:** 2026-07-04
**Source:** Remote Agent v1 roadmap entry F21 (`.orky/roadmap.json` / `.orky/roadmap.md`), scaffolded
by orky-app-batch (app-run mode — the concept was fixed at roadmap time; brainstorm recorded from the
roadmap entry).

## Roadmap entry (verbatim)

- **id:** F21
- **slug:** 0022-client-routing-remote-workspace-ux
- **title:** Client routing + remote-workspace UX (per-workspace home)
- **controls:** [] (none assigned)
- **deps:** [F18, F19, F20] (batch 5 — everything upstream is MERGED on this branch's base:
  F15 protocol (`src/shared/remote/`), F16 agent (`src/agent/`), F17 flow control
  (`src/shared/remote/flow-control.ts` incl. `createClientAckPolicy`, whose production consumer is
  THIS feature), F18 replay/survival (`pty:attach` snapshot + `pty:sessions`), F19 remote client
  (`src/remote-client/` incl. system-ssh tunnel + provisioning + named agents in
  `src/shared/remote-agents.ts`), F20 exclusive lease (steal notifications — the loser-drop signal
  this feature renders as the banner). Build on them, do not re-derive.)

### Summary (verbatim, from the app-run dispatch)

> Granularity = per-workspace home (locked decision 7): a workspace has a home — local, or a named
> agent — every pane in it lives at its home, one connection per workspace, and cross-workspace pane
> moves between different homes are out of scope (a running PTY cannot teleport machines). Persists
> home on the workspace record (SCHEMA_VERSION bump + migration; the constant is currently 8).
> Routes pty/status IPC for remote-home workspaces through the ssh-tunneled agent client
> transparently to the renderer; remote panes get identical status chips (agent-sourced, from F16);
> disconnect/lease-steal shows a disconnected/reconnecting banner riding the keep-mounted
> discipline — a disconnected pane freezes with a banner, NEVER unmounts (no xterm disposal);
> unsupported IPC domains (fs/editor, git, usage, orky, …) are greyed out per remote workspace from
> F15's capability handshake (locked decision 6). Hard invariants: renderer keeps ZERO Node/Electron
> imports; existing local-workspace behavior is byte-identical when no remote workspace exists;
> characterization tests stay green. Stack: TypeScript/Node/Electron + React/zustand renderer;
> already merged on main — F15 protocol (src/shared/remote/), F16 agent (src/agent/), F17 flow
> control (flow-control.ts incl. createClientAckPolicy, whose production consumer is THIS feature),
> F18 replay/survival (pty:attach snapshot + pty:sessions), F19 remote client (src/remote-client/
> incl. system-ssh tunnel + provisioning + named agents in src/shared/remote-agents.ts), F20
> exclusive lease (steal notifications — the loser-drop signal this feature renders as the banner).
> Build on them, do not re-derive. Unit tests vitest in tests/; UI/IPC integration via Playwright
> e2e (npm run build first); TDD per repo CLAUDE.md.

## Role in the app

Batch 5 — the UX capstone of the Remote Agent v1 epic. Every upstream feature (F15 protocol, F16
agent runtime, F17 windowed flow control, F18 replay/session survival, F19 remote client +
provisioning + named agents, F20 exclusive attach lease) is agent-side or plumbing-side and ships
NO renderer/main/preload wiring (frozen TEST-746 pins "no `src/main|preload|renderer` file imports
`shared/remote`" and its header names F21 as the retiring feature). THIS feature is the consumer
that wires the merged stack into the product: per-workspace home, transparent pty/status routing,
agent-sourced status chips, the disconnected/reconnecting banner (F20's loser-drop signal made
visible), and capability-based greying of unsupported domains.

## Mandatory pre-spec reading (cross-feature contract items routed to THIS feature)

1. `docs/superpowers/0018-windowed-flow-control-review-followups.md`:
   - **FINDING-004** — generate FRESH pane ids per pane (never reuse ids across spawns); this
     renders the stale delta-ack edge unreachable.
   - **FINDING-006** — derive the client ack cadence from any window it declares (keep cadence
     well below `floor(window/2)`) or flush residue when the stream goes quiet.
   - **Weld section** — flow accounting is connection-scoped: on every (re)connection create a
     FRESH `createClientAckPolicy` (never carry one across reconnects).
2. `docs/superpowers/0020-ssh-tunnel-provisioned-bootstrap-review-followups.md`:
   - **FINDING-005** — cancellation contract is caller-owned (`options.signal`); F21 MUST wire a
     user-facing cancel (and may add a convenience `timeoutMs`). Resolve that finding when the
     cancel affordance lands.
   - The remote-node / rc-noise **diagnostics contract** (FINDING-004/FINDING-006 remainders):
     provision-ineffective diagnostics name the node-missing possibility; pre-hello framing
     corruption from shell-rc noise stays a fail-fast with a hint — do not mask either.
3. CLAUDE.md load-bearing gotchas: keep-mounted discipline (`visibility: hidden`, never
   `display:none`/unmount), status-tail ANSI-strip guard, avoid redundant PTY resizes, register
   trackers BEFORE spawning, renderer pure logic must not import `../api` (inject IPC as
   arguments — see `op.ts` / `store/pane-ops.ts` pattern).

## Locked design decisions carried in (human-confirmed 2026-07-04; not to be re-opened)

6. **Capability partition = per-domain IPC registrar names** (`src/shared/remote/capabilities.ts`,
   `CAPABILITY_IDS`); the v1 agent advertises only `pty + status`. Unsupported domains are greyed
   out per remote workspace from the handshake's advertised capability set.
7. **Granularity = per-workspace home**: a workspace has a home (local or a named agent), every
   pane in it lives at its home, ONE connection per workspace, and cross-workspace pane moves
   between different homes are out of scope (a running PTY cannot teleport machines).
5. Exclusive attach (F20 — LANDED): attaching steals via the agent-side lease; the displaced
   loser receives `lease:revoked` (`AGENT_LEASE_REVOKED_EVT`, `src/agent/session-api.ts`) as its
   FINAL frame — THIS feature renders that as the disconnected banner.
1. Transport = stdio exec channel over SYSTEM ssh (F19 — LANDED); one stdio connection per agent
   process.

## Hard invariants (from the roadmap entry)

- Renderer keeps ZERO Node/Electron imports.
- Existing local-workspace behavior is byte-identical when no remote workspace exists.
- Characterization tests (`tests/characterization-*.test.ts`, CHAR-001..020) stay green.
- Persisted home rides the workspace record: SCHEMA_VERSION bump + migration (constant is
  currently 8 in `src/shared/types.ts`).

## Explicit non-goals (from the roadmap)

- Cross-workspace pane moves between different homes (a running PTY cannot teleport machines).
- Mirrored/shared attach (locked decision 5 defers it out of v1).
- New agent-side capabilities beyond `pty + status` (fs/editor, git, usage, orky, … stay greyed).
