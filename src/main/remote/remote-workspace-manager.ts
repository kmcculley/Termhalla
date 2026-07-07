/**
 * RemoteWorkspaceManager (feature 0022 / F21) — the per-workspace-home connection + routing core.
 *
 * One workspace ⇒ at most ONE agent connection (locked decision 7). The manager:
 *  - connects via F19's provisioned bootstrap (INJECTED as `deps.connect`, defaulting at the
 *    composition root to `connectWithProvisioning` — never a re-derived handshake), version-locked
 *    to the one manifest version (REQ-006);
 *  - owns an AbortController per attempt: `disconnectWorkspace` during `connecting` is the
 *    user-facing CANCEL (the F19 FINDING-005 caller-owned-cancellation contract); `stop()` aborts
 *    everything at app shutdown (the long-lived-child gotcha) (REQ-007);
 *  - routes pty ops (spawn/write/resize/kill) onto the wire with the CH-derived method strings,
 *    STRIPPING the local-only `launch`/`envId` fields (the v1 agent rejects them by name), never
 *    re-issuing `pty:spawn` for an id already seen on the same connection (0018 FINDING-004), and
 *    suppressing redundant resizes (the ConPTY-repaint gotcha applied to the wire) (REQ-008);
 *  - forwards agent evt pushes 1:1 onto the ROUTED pane-scoped send (`deps.send` — the same
 *    teardown-guarded window-routing + transit-buffering seam local PTY events ride), engaging NO
 *    local tracker (no StatusEngine/Process/Ai/git/usage/indexer/recorder) (REQ-010/REQ-011);
 *  - consumes F17 flow control: a FRESH `createClientAckPolicy` per (re)connection (the F17×F18
 *    weld — flow accounting is connection-scoped), ack-on-data at the 64 KiB default cadence, and
 *    a REALLY-SCHEDULED quiet-flush timer (CONV-036; scheduler injected, real timers at the
 *    composition root). It never emits a `window` frame (0018 FINDING-006 discipline: the agent's
 *    1 MiB default window keeps the default cadence well below floor(window/2)) (REQ-009);
 *  - renders F20's displacement: `lease:revoked` is the connection's FINAL meaningful frame —
 *    everything after it is ignored — and surfaces as `disconnected/lease-stolen` (REQ-012);
 *  - re-adopts panes on (re)connection through F18's inventory: `pty:sessions` once per
 *    connection, then per tracked pane in SORTED id order `pty:attach` (reset preamble + snapshot
 *    exactly once, status/cwd re-pushed, the RENDERER-recorded dims re-applied when they differ),
 *    a session missing from inventory surfacing as exited. Since feature 0024 (agent
 *    daemonization) production connects (`services.ts`) opt the F19 bootstrap into the daemon
 *    flow (`BootstrapOptions.daemon: true` — a persistent unix-domain-socket daemon behind a
 *    thin ssh-exec bridge, `docs/features/remote-agent.md` § "Daemonization"), so a same-version
 *    reconnect finds the SAME daemon and inventory, and this inventory-driven re-adoption is what
 *    makes that reattach work with ZERO change to this file (REQ-013 of 0024): the manager itself
 *    stays agnostic to whether the wire's other end is a direct-exec agent or a daemon bridge.
 *    A drifted-version daemon or a genuinely dead endpoint still surface via the ordinary connect
 *    failure path above (no special-casing needed here either).
 *
 * Electron-free by construction (every impure edge is injected) so the frozen suites drive it
 * in-process — locked decision 1's test posture.
 */
import { CH, type PtySpawnArgs } from '@shared/ipc-contract'
import type { NamedAgent } from '@shared/remote-agents'
import type { RemoteWorkspaceState, RemoteDisconnectReason } from '@shared/remote-workspace'
import {
  createRequestTracker, createClientAckPolicy,
  type RequestTracker, type ClientAckPolicy, type WireFrame, type ResFrame
} from '@shared/remote/protocol'
import {
  AGENT_LEASE_REVOKED_EVT, AGENT_SESSION_METHODS,
  type AgentAttachResult, type AgentSessionInfo
} from '@shared/remote-agent-api'

// Sorted order pinned by the frozen TEST-1908: ['pty:attach', 'pty:sessions'].
const [M_ATTACH, M_SESSIONS] = AGENT_SESSION_METHODS

/** The consumed slice of F19's AgentSessionHandle (structurally compatible). */
export interface RemoteWire {
  version: string
  capabilities: string[]
  send(frame: WireFrame): void
  onFrame(cb: (frame: WireFrame) => void): () => void
  onExit(cb: (code: number | null) => void): () => void
  kill(): void
}

export type RemoteConnectResult =
  | { ok: true; session: RemoteWire }
  | { ok: false; kind: string; diagnostic: string; indeterminate?: boolean }

export type RemoteConnectFn = (opts: {
  agent: NamedAgent
  version: string
  artifactPath: string
  signal: AbortSignal
  /** The remote workspace's id — the per-workspace daemon scope (feature 0024, D6′/REQ-018): the
   *  composition root threads it into `BootstrapOptions.daemon.workspaceId`. Optional in the type
   *  so the frozen `remote-manager-harness.ts` spy stays assignable; the manager ALWAYS supplies
   *  it (`ensureConnected` passes `entry.workspaceId`). */
  workspaceId?: string
}) => Promise<RemoteConnectResult>

export interface RemoteScheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
}

export interface RemoteManagerDeps {
  /** The routed pane-scoped send (window ownership + transit buffering ride it). */
  send(channel: string, ...args: unknown[]): void
  loadAgents(): Promise<NamedAgent[]>
  connect: RemoteConnectFn
  version: string
  artifactPath: string
  scheduler: RemoteScheduler
  /** Quiet-flush delay for ack residue (CONV-036). Default 250 ms. */
  ackQuietMs?: number
  /** Ack cadence override (tests); default = DEFAULT_ACK_EVERY_BYTES (64 KiB). */
  ackEveryBytes?: number
  /** Diagnostics sink (default: console.warn). Never user-facing. */
  diag?(line: string): void
}

interface PaneRec {
  cols: number
  rows: number
  /** The renderer-requested spawn shape (for a pending pane's first wire spawn at readopt). */
  shellId: string
  cwd: string
  /** A pty:spawn req reached the wire for this pane on the CURRENT connection lifecycle. */
  spawned: boolean
  /** Settled adoption polarity for the in-flight spawn() continuation (readopt may beat it). */
  adopted?: boolean
}

interface Pending { resolve(res: ResFrame): void; reject(e: unknown): void }

interface Entry {
  workspaceId: string
  agentId: string
  agentName: string
  phase: 'connecting' | 'connected' | 'disconnected'
  reason?: RemoteDisconnectReason
  diagnostic?: string
  capabilities: string[]
  everPushed: boolean
  gen: number                       // connection generation — stale-callback guard
  wire: RemoteWire | null
  tracker: RequestTracker | null
  ack: ClientAckPolicy | null
  ackTimer: unknown | null
  abort: AbortController | null     // the in-flight connect attempt's controller
  connectPromise: Promise<void> | null
  revoked: boolean                  // lease:revoked latch — nothing is processed after it
  unsubs: Array<() => void>
  pendingReqs: Map<number, Pending>
  panes: Map<string, PaneRec>       // tracked panes (survive a disconnect — frozen under the banner)
  exited: Set<string>               // ids that exited on the CURRENT connection (FINDING-004 refusal)
  inventory: Set<string> | null     // the connection-start pty:sessions id set
  inventoryPromise: Promise<void> | null // the detached re-adoption walk (spawn() awaits it)
}

const DEFAULT_ACK_QUIET_MS = 250

export class RemoteWorkspaceManager {
  private readonly entries = new Map<string, Entry>()
  private readonly paneIndex = new Map<string, string>() // paneId -> workspaceId
  private stopped = false

  constructor(private readonly deps: RemoteManagerDeps) {}

  // ── registrar surface ─────────────────────────────────────────────────────────────────────

  async connectWorkspace(workspaceId: string, agentId: string): Promise<void> {
    if (this.stopped) return
    const entry = this.ensureEntry(workspaceId, agentId)
    if (entry.phase === 'connected') return
    await this.ensureConnected(entry)
  }

  /** Drop the workspace's connection. During `connecting` this is the user-facing CANCEL
   *  (REQ-007); while connected it tears the wire down; either way the state settles
   *  `disconnected/cancelled` exactly once.
   *
   *  `opts.forget` (feature 0024, REQ-019/D10) is the additive close-tab shape: a tab close
   *  detaches — NEVER kills the workspace's remote panes (teardownWire never sends `pty:kill`) —
   *  and always forgets this manager's entry even with panes still tracked, so no ghost survives
   *  in `currentStates()`. The daemon and its PTYs are a SEPARATE process, untouched by forgetting
   *  local bookkeeping (it idle-reaps on its own once empty, REQ-006). Every pre-0024 caller
   *  (banner disconnect, cancel) passes no opts and stays byte-identical: an entry with tracked
   *  panes survives (the banner's frozen-panes state). */
  disconnectWorkspace(workspaceId: string, opts?: { forget?: boolean }): void {
    const entry = this.entries.get(workspaceId)
    if (!entry) return
    entry.gen++ // any in-flight establish/attach settles inert
    if (entry.abort) { entry.abort.abort(); entry.abort = null }
    this.teardownWire(entry)
    this.markDisconnected(entry, 'cancelled')
    // CONV-011 (FINDING-002): a disconnect that leaves NO tracked panes is a workspace letting go
    // (close/cancel on an empty workspace) — forget the entry so currentStates()/remote:current
    // never serve ghosts. An open workspace with frozen panes keeps its entry (the banner's
    // state); a pane-less open workspace re-renders from the no-state "not connected yet" model.
    // A close-tab-shaped disconnect (`{ forget: true }`) ALWAYS forgets, even with panes still
    // tracked — those panes are never killed (detach-then-forget, REQ-019).
    if (entry.panes.size === 0 || opts?.forget) this.entries.delete(workspaceId)
  }

  currentStates(): RemoteWorkspaceState[] {
    return [...this.entries.values()].filter(e => e.everPushed).map(e => this.toState(e))
  }

  /** App shutdown: abort every in-flight attempt and kill every live wire (the abortable +
   *  unref()'d long-lived-child gotcha). No state pushes — the app is going away. */
  stop(): void {
    this.stopped = true
    for (const entry of this.entries.values()) {
      entry.gen++
      if (entry.abort) { entry.abort.abort(); entry.abort = null }
      this.teardownWire(entry)
    }
  }

  // ── pty routing surface (register-pty delegation) ─────────────────────────────────────────

  owns(paneId: string): boolean { return this.paneIndex.has(paneId) }

  /** Tracked and not exited — the same-process remount adoption probe (minimize/restore, moves). */
  isAdoptable(paneId: string): boolean { return this.paneIndex.has(paneId) }

  /** Route a remote spawn. Resolves TRUE when the pane was ADOPTED (already live on this
   *  connection, or re-attached from the agent inventory), FALSE on a genuinely fresh spawn —
   *  the renderer's auto-resume gate needs this exact polarity (REQ-008). */
  async spawn(args: PtySpawnArgs): Promise<boolean> {
    const remote = args.remote
    if (!remote) return false
    const entry = this.ensureEntry(remote.workspaceId, remote.agentId)
    if (entry.exited.has(args.id)) {
      // 0018 FINDING-004: a pane id is NEVER respawned on the same connection — fresh panes mint
      // fresh uuids, so this is unreachable from the UI; refuse loudly rather than corrupt flow
      // accounting.
      this.deps.send(CH.ptyData, args.id,
        `\r\n[remote pane refused: id ${args.id} already exited on this connection - pane ids are never reused across spawns]\r\n`)
      return false
    }
    if (entry.panes.has(args.id)) return true // live on this connection: same-process re-adoption
    entry.panes.set(args.id, {
      cols: args.cols, rows: args.rows, shellId: args.shellId, cwd: args.cwd, spawned: false
    })
    this.paneIndex.set(args.id, entry.workspaceId)
    try { await this.ensureConnected(entry) } catch { /* surfaced via state pushes */ }
    if (entry.inventoryPromise) await entry.inventoryPromise
    const rec = entry.panes.get(args.id)
    if (!rec) return false                    // pruned while connecting (killed / readopt-exited)
    if (rec.adopted !== undefined) return rec.adopted // readopt settled it during establish
    if (entry.phase !== 'connected') return false     // frozen under the banner until a reconnect
    if (entry.inventory?.has(args.id)) {
      rec.adopted = true
      rec.spawned = true
      await this.attachPane(entry, entry.gen, args.id)
      return true
    }
    rec.adopted = false
    await this.wireSpawn(entry, entry.gen, args.id, { shellId: args.shellId, cwd: args.cwd, cols: args.cols, rows: args.rows })
    return false
  }

  write(paneId: string, data: string): void {
    const entry = this.entryOfPane(paneId)
    if (!entry || entry.phase !== 'connected') return // frozen: writes are dropped (REQ-008)
    void this.request(entry, CH.ptyWrite, { id: paneId, data }).catch(() => {})
  }

  resize(paneId: string, cols: number, rows: number): void {
    const entry = this.entryOfPane(paneId)
    const rec = entry?.panes.get(paneId)
    if (!entry || !rec) return
    if (rec.cols === cols && rec.rows === rows) return // redundant resize: never forwarded
    rec.cols = cols
    rec.rows = rows // recorded even while disconnected — reconnect re-applies (REQ-013)
    if (entry.phase !== 'connected') return
    void this.request(entry, CH.ptyResize, { id: paneId, cols, rows }).catch(() => {})
  }

  kill(paneId: string): void {
    const entry = this.entryOfPane(paneId)
    if (!entry) return
    const wasTracked = entry.panes.delete(paneId)
    this.paneIndex.delete(paneId)
    if (wasTracked) entry.exited.add(paneId) // id-reuse defense on this connection
    entry.ack?.paneClosed(paneId)
    if (entry.phase === 'connected') {
      // The F16 wire contract: pty:kill params are the BARE pane-id string.
      void this.request(entry, CH.ptyKill, paneId).catch(() => {})
    }
  }

  // ── connection lifecycle ──────────────────────────────────────────────────────────────────

  private ensureEntry(workspaceId: string, agentId: string): Entry {
    let entry = this.entries.get(workspaceId)
    if (!entry) {
      entry = {
        workspaceId, agentId, agentName: '', phase: 'disconnected', capabilities: [],
        everPushed: false, gen: 0, wire: null, tracker: null, ack: null, ackTimer: null,
        abort: null, connectPromise: null, revoked: false, unsubs: [],
        pendingReqs: new Map(), panes: new Map(), exited: new Set(), inventory: null,
        inventoryPromise: null
      }
      this.entries.set(workspaceId, entry)
    } else if (entry.phase !== 'connected' && agentId && entry.agentId !== agentId) {
      entry.agentId = agentId // a re-homed (not-connected) workspace follows its record
    }
    return entry
  }

  private entryOfPane(paneId: string): Entry | undefined {
    const wsId = this.paneIndex.get(paneId)
    return wsId === undefined ? undefined : this.entries.get(wsId)
  }

  private ensureConnected(entry: Entry): Promise<void> {
    if (entry.phase === 'connected') return Promise.resolve()
    if (entry.connectPromise) return entry.connectPromise // coalesce concurrent triggers (REQ-006)
    const p = this.establish(entry).finally(() => { if (entry.connectPromise === p) entry.connectPromise = null })
    entry.connectPromise = p
    return p
  }

  private async establish(entry: Entry): Promise<void> {
    const gen = ++entry.gen
    let agents: NamedAgent[] = []
    try { agents = await this.deps.loadAgents() } catch (e) { this.diag(`remote: agents registry read failed: ${msg(e)}`) }
    if (entry.gen !== gen || this.stopped) return
    const agent = agents.find(a => a.id === entry.agentId)
    if (!agent) {
      const which = entry.agentId === ''
        ? 'this workspace\'s home carries an EMPTY agent id (a malformed persisted home was tolerated on load)'
        : `no named agent with id "${entry.agentId}" exists in the registry`
      this.fail(entry, 'connect-failed',
        `${which} - open the remote-agent picker, define the agent (host/user), and reconnect`)
      return
    }
    entry.agentName = agent.name
    entry.phase = 'connecting'
    entry.capabilities = []
    delete entry.reason
    delete entry.diagnostic
    this.push(entry)

    const ac = new AbortController()
    entry.abort = ac
    let res: RemoteConnectResult
    try {
      res = await this.deps.connect({
        agent, version: this.deps.version, artifactPath: this.deps.artifactPath, signal: ac.signal,
        workspaceId: entry.workspaceId
      })
    } catch (e) {
      res = { ok: false, kind: 'fatal', diagnostic: `connect threw: ${msg(e)}` }
    }
    if (entry.abort === ac) entry.abort = null
    if (entry.gen !== gen || this.stopped) {
      // Cancelled/superseded mid-flight: a late success is discarded (its wire is killed) and a
      // late failure is silent — whoever superseded us already pushed the terminal state.
      if (res.ok) { try { res.session.kill() } catch { /* already gone */ } }
      return
    }
    if (!res.ok) {
      this.fail(entry, res.kind === 'aborted' ? 'cancelled' : 'connect-failed', res.diagnostic)
      return
    }
    this.adopt(entry, gen, res.session)
    // Re-adoption runs DETACHED: connectWorkspace settles at establishment (the connected push),
    // while the inventory walk proceeds; spawn() continuations await inventoryPromise so the
    // attach-or-spawn decision never races the pty:sessions round-trip.
    entry.inventoryPromise = this.readopt(entry, gen)
      .catch(e => this.diag(`remote: re-adoption failed: ${msg(e)}`))
  }

  /** Wire up an established session: fresh tracker, FRESH ack policy (the weld rule), evt/exit
   *  subscriptions, connected push. */
  private adopt(entry: Entry, gen: number, wire: RemoteWire): void {
    entry.wire = wire
    entry.tracker = createRequestTracker()
    entry.ack = createClientAckPolicy(
      this.deps.ackEveryBytes !== undefined ? { ackEveryBytes: this.deps.ackEveryBytes } : {}
    )
    entry.revoked = false
    entry.exited = new Set()
    entry.inventory = null
    entry.pendingReqs = new Map()
    // `spawned` is deliberately NOT reset: it means "ever reached a wire spawn" — readopt uses it
    // to tell a PENDING pane (first-spawn it now) from one whose session died with the previous
    // connection (surface as exited — the shipped v1 reality). Only the adoption polarity resets.
    for (const rec of entry.panes.values()) { delete rec.adopted }
    entry.capabilities = [...wire.capabilities]
    entry.phase = 'connected'
    delete entry.reason
    delete entry.diagnostic
    entry.unsubs = [
      wire.onFrame(f => this.onFrame(entry, gen, f)),
      wire.onExit(code => this.onWireExit(entry, gen, code))
    ]
    this.push(entry)
  }

  /** Inventory-driven re-adoption (REQ-013): ONE pty:sessions per connection, then per tracked
   *  pane in SORTED id order: attach / first-spawn / surface-as-exited. */
  private async readopt(entry: Entry, gen: number): Promise<void> {
    let sessions: AgentSessionInfo[] = []
    try {
      const res = await this.request(entry, M_SESSIONS, null)
      if (res.ok) sessions = res.result as AgentSessionInfo[]
      else this.diag(`remote: pty:sessions failed: ${res.error.message}`)
    } catch (e) {
      this.diag(`remote: pty:sessions failed: ${msg(e)}`)
    }
    if (entry.gen !== gen || entry.revoked) return
    entry.inventory = new Set(sessions.map(s => s.id))
    for (const paneId of [...entry.panes.keys()].sort()) {
      if (entry.gen !== gen || entry.revoked) return
      const rec = entry.panes.get(paneId)
      if (!rec) continue
      if (entry.inventory.has(paneId)) {
        rec.adopted = true
        rec.spawned = true
        await this.attachPane(entry, gen, paneId)
      } else if (!rec.spawned) {
        rec.adopted = false
        await this.wireSpawn(entry, gen, paneId, rec)
      } else {
        // Spawned on a previous connection and gone from the agent's inventory: whatever the
        // reason (an idled-out daemon, a version-drift refusal that never reached this session,
        // a genuinely killed pane), the session is gone and the pane surfaces as exited —
        // identical handling whether the far end is a direct-exec agent or a daemon (0024).
        this.deps.send(CH.ptyData, paneId, '\r\n[remote session ended]\r\n')
        this.deps.send(CH.ptyExit, paneId, 0)
        this.prunePane(entry, paneId)
      }
    }
  }

  /** pty:attach re-adoption: reset preamble + snapshot EXACTLY once, status + cwd re-pushed, the
   *  renderer-recorded dims re-applied iff they differ from the agent's current dims. */
  private async attachPane(entry: Entry, gen: number, paneId: string): Promise<void> {
    let res: ResFrame
    try { res = await this.request(entry, M_ATTACH, { id: paneId }) }
    catch (e) { this.diag(`remote: pty:attach ${paneId} failed: ${msg(e)}`); return }
    if (entry.gen !== gen || entry.revoked) return
    if (!res.ok) {
      this.deps.send(CH.ptyData, paneId, `\r\n[remote attach failed: ${res.error.message}]\r\n`)
      this.deps.send(CH.ptyExit, paneId, 1)
      this.prunePane(entry, paneId)
      entry.exited.add(paneId)
      return
    }
    const r = res.result as AgentAttachResult
    this.deps.send(CH.ptyData, paneId, `\x1bc${r.snapshot}`)
    this.deps.send(CH.ptyStatus, paneId, r.status)
    this.deps.send(CH.ptyCwd, paneId, r.cwd)
    const rec = entry.panes.get(paneId)
    if (rec && (rec.cols !== r.cols || rec.rows !== r.rows)) {
      void this.request(entry, CH.ptyResize, { id: paneId, cols: rec.cols, rows: rec.rows }).catch(() => {})
    }
  }

  /** The wire spawn: EXACTLY {id, shellId, cwd, cols, rows} — launch/envId are local-only and the
   *  v1 agent rejects them by name (REQ-008). */
  private async wireSpawn(
    entry: Entry, gen: number, paneId: string,
    a: { shellId: string; cwd: string; cols: number; rows: number }
  ): Promise<void> {
    const rec = entry.panes.get(paneId)
    if (rec) rec.spawned = true
    let res: ResFrame
    try {
      res = await this.request(entry, CH.ptySpawn,
        { id: paneId, shellId: a.shellId, cwd: a.cwd, cols: a.cols, rows: a.rows })
    } catch (e) {
      this.diag(`remote: pty:spawn ${paneId} failed: ${msg(e)}`)
      return
    }
    if (entry.gen !== gen) return
    if (!res.ok) {
      this.deps.send(CH.ptyData, paneId, `\r\n[failed to launch remote pane: ${res.error.message}]\r\n`)
      this.deps.send(CH.ptyExit, paneId, 1)
      this.prunePane(entry, paneId)
      entry.exited.add(paneId)
    }
  }

  // ── inbound frames ────────────────────────────────────────────────────────────────────────

  private onFrame(entry: Entry, gen: number, frame: WireFrame): void {
    if (entry.gen !== gen || entry.revoked) return // nothing follows a revocation (REQ-012)
    switch (frame.type) {
      case 'res': {
        const settled = entry.tracker?.settle(frame)
        if (settled?.kind === 'settled') {
          const p = entry.pendingReqs.get(frame.id)
          entry.pendingReqs.delete(frame.id)
          p?.resolve(frame)
        } else if (settled) {
          this.diag(`remote: ${settled.kind} response id ${frame.id} ignored`)
        }
        return
      }
      case 'evt':
        this.onEvt(entry, frame.channel, frame.args)
        return
      default:
        // hello/req/ack/window from the agent are protocol violations at this layer; tolerate.
        this.diag(`remote: unexpected inbound ${frame.type} frame ignored`)
    }
  }

  private onEvt(entry: Entry, channel: string, args: unknown[]): void {
    if (channel === AGENT_LEASE_REVOKED_EVT) {
      // The FINAL frame of a displaced connection (F20). Latch first: nothing after it lands.
      entry.revoked = true
      this.teardownWire(entry)
      this.markDisconnected(entry, 'lease-stolen',
        `another client attached to agent "${entry.agentName}" and took this workspace's sessions (exclusive attach)`)
      return
    }
    // FINDING-007 (codex cross-check): the connection may only speak about panes IT tracks — an
    // unguarded forward would let a compromised remote host inject output/status/cwd/exit into
    // ANY pane id it guesses (including local panes; the routed send delivers wherever the pane
    // lives). Unknown ids are dropped with one diagnostic.
    const paneId = typeof args[0] === 'string' ? args[0] : ''
    if (!entry.panes.has(paneId)) {
      this.diag(`remote: evt "${channel}" for a pane this connection does not own ("${paneId}") ignored`)
      return
    }
    // Same posture for the PAYLOAD position (2026-07-06 audit): these args come off the remote
    // wire, so each position is type-checked before it reaches renderer IPC — an unvalidated cast
    // would forward whatever the agent sent (a non-string pty:data payload even crashed the ack
    // accounting on `data.length`). Mismatches drop with one diagnostic and NO side effect.
    const payload = args[1]
    const dropMalformed = (expected: string): void =>
      this.diag(`remote: evt "${channel}" for pane "${paneId}" carried a ${typeof payload} payload (expected ${expected}) — dropped`)
    switch (channel) {
      case CH.ptyData: {
        if (typeof payload !== 'string') return dropMalformed('string')
        this.deps.send(CH.ptyData, paneId, payload)
        const ackFrame = entry.ack?.onData(paneId, payload) ?? null
        if (ackFrame) this.wireSend(entry, ackFrame)
        this.armAckFlush(entry)
        return
      }
      case CH.ptyStatus: {
        if (typeof payload !== 'object' || payload === null) return dropMalformed('object')
        this.deps.send(CH.ptyStatus, paneId, payload) // AgentStatusPayload passes through unchanged
        return
      }
      case CH.ptyCwd: {
        if (typeof payload !== 'string') return dropMalformed('string')
        // Renderer-only: the remote cwd feeds the chip, NEVER the local git/usage/indexer hooks.
        this.deps.send(CH.ptyCwd, paneId, payload)
        return
      }
      case CH.ptyExit: {
        if (typeof payload !== 'number') return dropMalformed('number')
        this.deps.send(CH.ptyExit, paneId, payload)
        entry.ack?.paneClosed(paneId)
        this.prunePane(entry, paneId)
        entry.exited.add(paneId)
        return
      }
      default:
        this.diag(`remote: unknown evt channel "${channel}" ignored`)
    }
  }

  private onWireExit(entry: Entry, gen: number, code: number | null): void {
    if (entry.gen !== gen) return
    this.teardownWire(entry)
    // A terminal reason is never overwritten (a lease steal already settled the state).
    this.markDisconnected(
      entry,
      code === 0 ? 'agent-exited' : 'connection-lost',
      `the agent connection ended (exit ${code === null ? 'null' : code})`
    )
  }

  // ── flow control (REQ-009) ────────────────────────────────────────────────────────────────

  /** (Re)arm the quiet-flush timer: a REAL scheduled timer (CONV-036), armed by data arrival,
   *  cleared on dispose/teardown; on expiry it flushes ALL pending ack residue. */
  private armAckFlush(entry: Entry): void {
    if (entry.ackTimer !== null) this.deps.scheduler.clearTimeout(entry.ackTimer)
    const gen = entry.gen
    entry.ackTimer = this.deps.scheduler.setTimeout(() => {
      entry.ackTimer = null
      if (entry.gen !== gen || entry.revoked || entry.phase !== 'connected' || !entry.ack) return
      for (const f of entry.ack.flush()) this.wireSend(entry, f)
    }, this.deps.ackQuietMs ?? DEFAULT_ACK_QUIET_MS)
  }

  private wireSend(entry: Entry, frame: WireFrame): void {
    try { entry.wire?.send(frame) } catch (e) { this.diag(`remote: wire send failed: ${msg(e)}`) }
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────

  private request(entry: Entry, method: string, params: unknown): Promise<ResFrame> {
    if (!entry.tracker || !entry.wire) return Promise.reject(new Error(`no connection for ${method}`))
    const { id, frame } = entry.tracker.open(method, params)
    return new Promise<ResFrame>((resolve, reject) => {
      entry.pendingReqs.set(id, { resolve, reject })
      try {
        entry.wire!.send(frame)
      } catch (e) {
        entry.pendingReqs.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  private prunePane(entry: Entry, paneId: string): void {
    entry.panes.delete(paneId)
    this.paneIndex.delete(paneId)
  }

  private teardownWire(entry: Entry): void {
    for (const off of entry.unsubs) { try { off() } catch { /* gone */ } }
    entry.unsubs = []
    if (entry.ackTimer !== null) { this.deps.scheduler.clearTimeout(entry.ackTimer); entry.ackTimer = null }
    entry.ack?.dispose()
    entry.ack = null
    const failed = entry.tracker?.failAllPending('the connection ended') ?? []
    entry.tracker = null
    for (const f of failed) {
      const p = entry.pendingReqs.get(f.id)
      entry.pendingReqs.delete(f.id)
      p?.reject(new Error(`${f.method}: ${f.reason}`))
    }
    entry.pendingReqs.clear()
    if (entry.wire) { try { entry.wire.kill() } catch { /* already gone */ } }
    entry.wire = null
    entry.inventory = null
    entry.inventoryPromise = null
    entry.capabilities = []
  }

  private fail(entry: Entry, reason: RemoteDisconnectReason, diagnostic: string): void {
    entry.phase = 'disconnected'
    entry.capabilities = []
    entry.reason = reason
    entry.diagnostic = diagnostic // the classify contract, unweakened (REQ-007)
    this.push(entry)
  }

  /** Settle `disconnected` exactly once — the FIRST terminal reason wins (REQ-012/REQ-013). */
  private markDisconnected(entry: Entry, reason: RemoteDisconnectReason, diagnostic?: string): void {
    if (entry.phase === 'disconnected') return
    entry.phase = 'disconnected'
    entry.capabilities = []
    entry.reason = reason
    if (diagnostic !== undefined) entry.diagnostic = diagnostic
    else delete entry.diagnostic
    this.push(entry)
  }

  private toState(entry: Entry): RemoteWorkspaceState {
    const s: RemoteWorkspaceState = {
      workspaceId: entry.workspaceId,
      agentId: entry.agentId,
      agentName: entry.agentName,
      phase: entry.phase,
      capabilities: [...entry.capabilities]
    }
    if (entry.phase === 'disconnected' && entry.reason) s.reason = entry.reason
    if (entry.diagnostic !== undefined) s.diagnostic = entry.diagnostic
    return s
  }

  private push(entry: Entry): void {
    entry.everPushed = true
    this.deps.send(CH.remoteState, this.toState(entry))
  }

  private diag(line: string): void {
    if (this.deps.diag) this.deps.diag(line)
    else console.warn(line)
  }
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
