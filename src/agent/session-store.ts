/**
 * The session store (REQ-004) — pane ownership that OUTLIVES a protocol connection: PTY
 * handles, per-pane replay terminals (REQ-003), the StatusEngine (reused from src/main/status —
 * REQ-008's F16 discipline: register-before-spawn, markExit-before-exit-event,
 * unregister-on-exit), and per-pane cached metadata (resolved cwd, dims, last status). This is
 * locked decision 3's survival substance: a connection ending — however it ends — DETACHES
 * (`unbind()`); panes keep running and their output keeps feeding replay + status. Only
 * `destroy()` (the single-connection composition's end, or process teardown) kills panes.
 *
 * Routing (REQ-008): pushes flow ONLY to the currently bound connection and ONLY for panes it
 * spawned/adopted/attached during ITS life. While detached, no frames are constructed — there
 * is NO missed-event queue (REQ-002: the replay terminal is the history; the window-manager
 * transit buffer is explicitly the wrong tool and is not imported). The one bounded in-flight
 * hold is the per-attach ordering window of REQ-006(d): pty:data arriving while an attach
 * snapshot is being produced for a CONNECTED client is held and drained right after that
 * attach's res, so the snapshot ⊕ subsequent data reconstruct the stream exactly-once.
 *
 * Windowed flow control (F17 / 0018) rides HERE since the emit path moved here: ONE shared
 * flow gate per store counts every DELIVERED `pty:data` payload (live route, attach-window
 * drain, exit-time final flush — never the replay feed) and pauses/resumes the pane's backend
 * handle synchronously inside whatever event produced the decision (data emission, ack,
 * window). Flow pressure is pressure from the BOUND client, so the gate's accounting is
 * connection-scoped even though the gate object rides the store: `unbind()` resumes anything
 * the departed client's stall had paused (detached mode's only consumer is the replay
 * terminal, which applies no backpressure — output must keep feeding it, REQ-011) and resets
 * the accounting to zero, matching the client side, whose ack policy is per-connection. A
 * persisted residue could never be acked away by a fresh client and would ratchet toward a
 * permanent pause — see docs/features/remote-agent.md § Flow control.
 *
 * The binding IS the agent-side lease (F20 / 0021-exclusive-attach-lease, locked decision 5 —
 * `tmux attach -d` semantics; this replaced the 0019-era single-connection throw guard exactly
 * as its CONV-019 retirement path prescribed): exactly ONE holder at every instant. Grant =
 * `bind()` on an unbound store; release = any connection-end path (`unbind()`); STEAL =
 * `bind()` while bound — the incumbent is detached with the full unbind semantics above (with
 * `bound` null, so a resumed backlog feeds replay only), then notified via its
 * `onLeaseRevoked()` (contained — a throwing handler never blocks the grant), then the
 * newcomer holds. The newer attach always wins; binds resolve strictly in arrival order.
 * Holder-scoped release (a displaced connection's late end must not detach the winner) is
 * enforced at the session layer via its `revoked` flag — see session.ts.
 */
import { CH } from '@shared/ipc-contract'
import type { PtySpawnArgs } from '@shared/ipc-contract'
import type { TerminalStatus } from '@shared/types'
import type { WireFrame, FlowDecision } from '@shared/remote/protocol'
import { createAgentFlowGate } from '@shared/remote/protocol'
import { StatusEngine } from '../main/status/status-engine'
import type { AgentPtyBackend, AgentPtyHandle } from './pty-backend'
import { createPaneReplay, HISTORY_LIMIT_DEFAULT, type PaneReplay, type ReplayFactory } from './replay'
import { toStatusPayload, type AgentAttachResult, type AgentSessionInfo } from './session-api'

export interface AgentSessionStoreInit {
  backend: AgentPtyBackend
  /** Resolution target for an empty wire cwd (F16 REQ-007 semantics, unchanged). */
  homeDir: string
  /** Replay history bound in lines (tmux history-limit analog). Default HISTORY_LIMIT_DEFAULT. */
  scrollback?: number
  /** Injectable replay seam (tests); default = the real @xterm/headless replay. */
  replayFactory?: ReplayFactory
  /** Store-level diagnostics (replay failures, teardown failures). Default: silent. */
  diag?: (text: string) => void
}

/** What a connection registers at bind time. `send` delivers evt frames; a `send` throw is a
 *  connection death: the store unbinds FIRST, then reports through `onSendFailure`.
 *  `onLeaseRevoked` fires when a LATER bind steals the lease (F20) — invoked AFTER this
 *  connection was detached (it can no longer receive routed pane frames), so the handler's
 *  notification is its final frame; the handler must not release the store again. */
export interface BoundClient {
  send(frame: WireFrame): void
  onSendFailure(error: unknown): void
  onLeaseRevoked(): void
}

export type SpawnOutcome =
  | { ok: true; adopted: boolean }
  | { ok: false; message: string }

export type AttachOutcome =
  | { ok: true; result: AgentAttachResult; drain: () => void }
  | { ok: false; code: 'unknown-pane' | 'internal'; message: string }

export interface AgentSessionStore {
  bind(client: BoundClient): void
  unbind(): void
  spawn(args: PtySpawnArgs): SpawnOutcome
  /** true = delivered; false = no live pane with that id (the session codes unknown-pane). */
  write(id: string, data: string): boolean
  resize(id: string, cols: number, rows: number): boolean
  kill(id: string): boolean
  attach(id: string): Promise<AttachOutcome>
  list(): AgentSessionInfo[]
  /** Inbound `ack` frame (F17 REQ-006): fire-and-forget — a resume decision is applied to the
   *  pane's backend synchronously; unknown-pane acks (an ack racing the exit) stay silent. */
  flowAck(id: string, bytes: number): void
  /** Inbound `window` frame (F17 REQ-007): per-pane override with `id` (live panes only,
   *  diagnosed otherwise), connection-wide default without. Fire-and-forget. */
  flowWindow(size: number, id?: string): void
  /** Kill every pane, dispose replays + engine. Idempotent. Detach must NOT call this. */
  destroy(): void
}

const bounded = (e: unknown): string => String(e instanceof Error ? e.message : e).slice(0, 300)

interface PaneRec {
  handle: AgentPtyHandle | null // null only during the spawn call itself
  replay: PaneReplay
  replayBroken: boolean
  shellId: string
  cwd: string
  cols: number
  rows: number
  status: TerminalStatus | null
  /** Subscription of the CURRENTLY bound connection (spawned/adopted/attached this life). */
  subscribed: boolean
  /** In-flight attach window (0 or 1 — overlap is rejected, FINDING-006); while > 0,
   *  subscribed pty:data is held, not sent. */
  holds: number
  held: string[]
}

export const createSessionStore = (init: AgentSessionStoreInit): AgentSessionStore => {
  const scrollback = init.scrollback ?? HISTORY_LIMIT_DEFAULT
  const replayFactory = init.replayFactory ?? createPaneReplay
  const diag = init.diag ?? ((): void => {})
  const panes = new Map<string, PaneRec>()
  let bound: BoundClient | null = null
  let destroyed = false
  /** Bumped on every unbind: hold windows are generation-scoped, so a stale attach settling
   *  after its connection died can never corrupt the NEXT connection's hold bookkeeping. */
  let bindGen = 0

  // Windowed flow control (F17 / 0018 welded into the 0019 store split): ONE gate per
  // connection-life; its diagnostics ride the store's diag channel (= the session's stderr in
  // the owned composition). Recreated on every unbind — see unbindInternal.
  let gate = createAgentFlowGate({ onDiagnostic: diag })

  const applyFlowDecisions = (decisions: FlowDecision[]): void => {
    for (const d of decisions) {
      const rec = panes.get(d.id)
      if (!rec?.handle) continue // the pane raced away; its flow state is pruned on the exit funnel
      // Containment parity with the dispatch path (F17 FINDING-001): a throwing backend
      // pause()/resume() degrades to a diagnostic, never crashes the agent.
      try {
        if (d.action === 'pause') rec.handle.pause()
        else rec.handle.resume()
      } catch (e) {
        diag(`flow: ${d.action} on pane "${d.id}" failed: ${bounded(e)} - the session continues`)
      }
    }
  }

  const deliver = (frame: WireFrame): void => {
    if (!bound) return
    const client = bound
    try {
      client.send(frame)
    } catch (e) {
      // A throwing send is a connection death (REQ-005): detach FIRST (panes survive), then
      // let the connection map it to its shutdown taxonomy.
      unbindInternal()
      client.onSendFailure(e)
    }
  }

  /** Deliver one pty:data frame AND count it through the flow gate (F17 REQ-005: count the
   *  SAME payload just emitted; a window crossing pauses the backend synchronously, within
   *  this very delivery). Every pty:data delivery path funnels here — live route, attach
   *  drain, exit-time final flush — so agent-side accounting stays symmetric with a client
   *  policy counting every received payload. If the send itself killed the connection, the
   *  unbind already reset the gate and the count is skipped (pressure needs a live consumer). */
  const deliverData = (id: string, data: string): void => {
    deliver({ type: 'evt', channel: CH.ptyData, args: [id, data] })
    if (bound !== null) applyFlowDecisions(gate.onDataEmitted(id, data))
  }

  const routeData = (id: string, rec: PaneRec, data: string): void => {
    if (destroyed || !bound || !rec.subscribed) return
    if (rec.holds > 0) {
      rec.held.push(data) // the bounded per-attach ordering window (REQ-006d) — NOT a queue
      return
    }
    deliverData(id, data)
  }

  const engine = new StatusEngine(
    (id, status) => {
      const rec = panes.get(id)
      if (!rec) return
      rec.status = status // the cache survives detach (inventory/attach metadata)
      if (destroyed || !bound || !rec.subscribed) return
      deliver({ type: 'evt', channel: CH.ptyStatus, args: [id, toStatusPayload(status)] })
    },
    (id, cwd) => {
      const rec = panes.get(id)
      if (!rec) return
      rec.cwd = cwd
      if (destroyed || !bound || !rec.subscribed) return
      deliver({ type: 'evt', channel: CH.ptyCwd, args: [id, cwd] })
    }
  )

  const feedReplay = (id: string, rec: PaneRec, data: string): void => {
    if (rec.replayBroken) return
    try {
      rec.replay.feed(data)
    } catch (e) {
      // Containment (REQ-004): a replay failure must never tear down the live pty. The pane
      // sails on; attach on it reports `internal` (never a silently-wrong snapshot).
      rec.replayBroken = true
      diag(`replay for pane "${id}" failed and was disabled: ${bounded(e)} - the pane continues; reattach will report internal`)
    }
  }

  const paneExited = (id: string, code: number): void => {
    const rec = panes.get(id)
    if (!rec) return // exactly-once: kill-initiated and self-exit funnel here (F16)
    // FINDING-001: bytes held by an open attach window are the pane's FINAL output — flush
    // them before the final status/exit so the data-before-exit contract (REQ-010) survives an
    // exit-during-attach; the raced attach itself still fails unknown-pane, and later
    // release() calls find held already empty.
    if (!destroyed && bound && rec.subscribed && rec.held.length > 0) {
      const finalHeld = rec.held
      rec.held = []
      for (const chunk of finalHeld) {
        deliverData(id, chunk)
      }
    }
    rec.held = []
    gate.paneExited(id) // prune flow state (F17 REQ-009); late acks/windows hit the untracked paths
    engine.markExit(id, code) // final status (lastExit) flows out BEFORE the exit event
    engine.unregister(id)
    panes.delete(id)
    rec.replay.dispose() // resolves any in-flight snapshot; the attach liveness re-check rejects
    if (!destroyed && bound && rec.subscribed) {
      deliver({ type: 'evt', channel: CH.ptyExit, args: [id, code] })
    }
    rec.subscribed = false
  }

  const unbindInternal = (): void => {
    bound = null
    bindGen++
    // Flow-control weld (F17 ⊗ F18): the unacked accounting measured pressure from the
    // now-departed client, and a fresh client's ack policy starts at zero — so the agent
    // side resets to zero too (a persisted residue could never be acked away and would
    // ratchet toward a pause that no resume watermark can clear). Anything the departed
    // client's stall had paused is resumed FIRST, with bound already null: the flushed
    // backlog lands in the replay terminal (detached mode's only consumer, which applies
    // no backpressure) instead of going silent — REQ-011's "output continues while away".
    for (const [id, rec] of panes) {
      if (rec.handle === null || gate.stats(id)?.paused !== true) continue
      try {
        rec.handle.resume()
      } catch (e) {
        diag(`flow: resume on pane "${id}" at detach failed: ${bounded(e)} - the pane continues`)
      }
    }
    gate.dispose()
    gate = createAgentFlowGate({ onDiagnostic: diag })
    for (const rec of panes.values()) {
      rec.subscribed = false
      rec.holds = 0 // open windows belonged to the dead connection — their releases no-op
      rec.held = [] // the attaching connection is gone; its window dies with it (REQ-002)
    }
  }

  const currentStatus = (rec: PaneRec): TerminalStatus =>
    rec.status ?? { state: 'idle', since: 0 }

  return {
    bind(client: BoundClient): void {
      const incumbent = bound
      if (incumbent) {
        // The steal (F20, locked decision 5): the newer attach wins, identity-blind.
        // (a) Detach the incumbent with EXACTLY the established unbind semantics — paused
        //     backends resume while NO client is bound (the flushed backlog feeds the replay
        //     terminal only), the flow gate resets, bindGen invalidates its open attach
        //     windows, subscriptions/holds/held clear. (Harmless on a destroyed store.)
        unbindInternal()
        // (b) Tell it, now that it can no longer receive routed pane frames. Contained: a
        //     throwing handler is diagnosed and the grant below proceeds regardless.
        try {
          incumbent.onLeaseRevoked()
        } catch (e) {
          diag(`lease: revocation handler failed: ${bounded(e)} - the steal completes`)
        }
        // Reentrancy re-check (FINDING-003): the revocation callback may have synchronously
        // bound a NEWER connection (an embedder reconnecting inside its shutdown path). The
        // newest bind wins — that nested holder stays, and THIS older bind self-displaces
        // (its client is notified like any displaced incumbent; it was never granted, so it
        // never received a routed frame).
        if (bound !== null) {
          try {
            client.onLeaseRevoked()
          } catch (e) {
            diag(`lease: revocation handler failed: ${bounded(e)} - the steal completes`)
          }
          return
        }
      }
      // (c) Grant — on a destroyed store the holder still just answers empty inventories.
      bound = client
    },

    unbind(): void {
      unbindInternal()
    },

    spawn(args: PtySpawnArgs): SpawnOutcome {
      if (destroyed) {
        // FINDING-004: a destroyed store must never own a fresh pty — destroy() already ran
        // (idempotent), so a pane spawned now would be an unkillable zombie.
        return { ok: false, message: `pty:spawn "${args.id}" failed: this agent session store was destroyed - no pane was registered` }
      }
      const existing = panes.get(args.id)
      if (existing) {
        // Adopt: the pane is live, never respawn (the local idempotent semantic, F16).
        // Adoption subscribes but deliberately does NOT replay history — pty:attach is the
        // snapshot-bearing verb (REQ-008).
        existing.subscribed = true
        return { ok: true, adopted: true }
      }
      const cwd = args.cwd === '' ? init.homeDir : args.cwd
      // FINDING-005: the replay is created FIRST — a throwing factory unwinds nothing, and no
      // reachable rec ever carries a placeholder replay field.
      let replay: PaneReplay
      try {
        replay = replayFactory({
          cols: args.cols, rows: args.rows, scrollback,
          // Route the replay's own contained-failure diagnostics (degraded drain/dispose
          // serialize, Group A #2) onto the store's diag channel, pane-tagged.
          diag: (t) => diag(`pane "${args.id}": ${t}`)
        })
      } catch (e) {
        return { ok: false, message: `pty:spawn "${args.id}" failed: ${bounded(e)} - no pane was registered` }
      }
      const rec: PaneRec = {
        handle: null,
        replay,
        replayBroken: false,
        shellId: args.shellId,
        cwd,
        cols: args.cols,
        rows: args.rows,
        status: null,
        subscribed: true,
        holds: 0,
        held: []
      }
      // The rec is registered BEFORE the engine so the register-time initial status routes to
      // the spawning connection (TEST-769); the engine is registered BEFORE the backend spawn
      // (the repo's register-before-spawn discipline) so a failed spawn unwinds cleanly.
      panes.set(args.id, rec)
      engine.register(args.id)
      let handle: AgentPtyHandle
      try {
        handle = init.backend.spawn({ id: args.id, cwd, cols: args.cols, rows: args.rows, shellId: args.shellId })
      } catch (e) {
        engine.unregister(args.id)
        panes.delete(args.id)
        rec.replay.dispose()
        return { ok: false, message: `pty:spawn "${args.id}" failed: ${bounded(e)} - no pane was registered` }
      }
      rec.handle = handle
      handle.onExit((code) => paneExited(args.id, code))
      handle.onData((data) => {
        // Liveness guard (F16 FINDING-001): a straggler after exit must never emit pty:data
        // AFTER pty:exit; identity-checked so a respawned id cannot alias a dead handle.
        if (panes.get(args.id) !== rec) return
        feedReplay(args.id, rec, data)
        engine.feed(args.id, data)
        routeData(args.id, rec, data)
      })
      return { ok: true, adopted: false }
    },

    write(id: string, data: string): boolean {
      const rec = panes.get(id)
      if (!rec?.handle) return false
      rec.handle.write(data)
      return true
    },

    resize(id: string, cols: number, rows: number): boolean {
      const rec = panes.get(id)
      if (!rec?.handle) return false
      rec.handle.resize(cols, rows)
      rec.cols = cols
      rec.rows = rows
      if (!rec.replayBroken) {
        try {
          rec.replay.resize(cols, rows)
        } catch (e) {
          rec.replayBroken = true
          diag(`replay resize for pane "${id}" failed and the replay was disabled: ${bounded(e)}`)
        }
      }
      return true
    },

    kill(id: string): boolean {
      const rec = panes.get(id)
      if (!rec?.handle) return false
      rec.handle.kill() // the handle's exit funnels through paneExited (pty:exit exactly once)
      return true
    },

    attach(id: string): Promise<AttachOutcome> {
      const rec = panes.get(id)
      if (!rec) {
        return Promise.resolve({
          ok: false, code: 'unknown-pane',
          message: `pty:attach: no live pane "${id}" on this agent - list surviving sessions with pty:sessions`
        })
      }
      if (rec.replayBroken) {
        return Promise.resolve({
          ok: false, code: 'internal',
          message: `pty:attach "${id}": the replay terminal previously failed and was disabled - a faithful snapshot cannot be produced (kill and respawn the pane to restore replay)`
        })
      }
      if (rec.holds > 0) {
        // FINDING-006: attach windows on one pane never coexist — a byte held for window A
        // that precedes window B's barrier would sit inside B's snapshot AND flush as an event
        // (double-apply). v1 rejects the overlap deterministically; sequential re-attach (the
        // spec'd surface) is unaffected.
        return Promise.resolve({
          ok: false, code: 'internal',
          message: `pty:attach "${id}": an attach for this pane is already in flight - await its res, then retry (v1 serializes attach windows per pane)`
        })
      }
      // Attach subscribes immediately (REQ-006c) and opens its hold window SYNCHRONOUSLY with
      // the req dispatch (REQ-006d): from this exact point, subscribed pty:data is held, so no
      // data event can precede the res.
      rec.subscribed = true
      const gen = bindGen
      rec.holds++
      // The snapshot BARRIER is captured synchronously with the req dispatch: bytes fed after
      // this exact point are excluded from the snapshot and ride the hold window instead —
      // delivered exactly once, in order, AFTER the res (REQ-006d). The hold window above and
      // this barrier opening at the same instant is what makes snapshot ⊕ held ≡ stream.
      // (FINDING-009: the already-parsed fast path serializes synchronously — a throw here
      // must undo the hold, or subscribed data black-holes into held forever.)
      let barrier: Promise<string>
      try {
        barrier = rec.replay.snapshot()
      } catch (e) {
        rec.holds = Math.max(0, rec.holds - 1)
        return Promise.resolve({
          ok: false, code: 'internal',
          message: `pty:attach "${id}" failed: ${bounded(e)} - the session continues`
        })
      }
      void barrier.catch(() => '') // an early-exit run may leave it floating; never unhandled
      let released = false
      const release = (redeliver: boolean): void => {
        if (released) return
        released = true
        if (gen !== bindGen) return // the owning connection died; unbind already reset holds
        rec.holds = Math.max(0, rec.holds - 1)
        if (panes.get(id) !== rec || !bound || !rec.subscribed) {
          if (rec.holds === 0) rec.held = []
          return
        }
        if (redeliver || rec.holds === 0) {
          const heldNow = rec.held
          rec.held = []
          for (const chunk of heldNow) {
            deliverData(id, chunk) // drained held bytes are emissions too — the gate counts them
          }
        }
      }
      const unknownPane = (): AttachOutcome => ({
        ok: false, code: 'unknown-pane',
        message: `pty:attach: pane "${id}" exited before the snapshot completed - it is no longer on this agent`
      })
      const run = async (): Promise<AttachOutcome> => {
        if (panes.get(id) !== rec) {
          release(false)
          return unknownPane()
        }
        const snapshot = await barrier
        // Session-identity re-check after the await (the repo's watcher race pattern): an
        // exit-during-attach yields unknown-pane, never a snapshot of a disposed terminal.
        if (panes.get(id) !== rec) {
          release(false)
          return unknownPane()
        }
        const result: AgentAttachResult = {
          snapshot,
          cols: rec.cols,
          rows: rec.rows,
          cwd: rec.cwd,
          status: toStatusPayload(currentStatus(rec))
        }
        return {
          ok: true,
          result,
          // Called by the connection right after it sends the res, in the same synchronous
          // continuation — nothing interleaves between the res and this flush.
          drain: (): void => release(false)
        }
      }
      return run().catch((e) => {
        release(true) // pane may still be live (replay fault): better to deliver than to drop
        return {
          ok: false as const, code: 'internal' as const,
          message: `pty:attach "${id}" failed: ${bounded(e)} - the session continues`
        }
      })
    },

    flowAck(id: string, bytes: number): void {
      if (destroyed) return
      applyFlowDecisions(gate.onAck(id, bytes))
    },

    flowWindow(size: number, id?: string): void {
      if (destroyed) return
      applyFlowDecisions(gate.onWindow(size, id))
    },

    list(): AgentSessionInfo[] {
      const out: AgentSessionInfo[] = []
      for (const [id, rec] of panes) {
        out.push({
          id,
          shellId: rec.shellId,
          cwd: rec.cwd,
          cols: rec.cols,
          rows: rec.rows,
          attached: bound !== null && rec.subscribed,
          status: toStatusPayload(currentStatus(rec))
        })
      }
      out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      return out
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      unbindInternal()
      for (const [id, rec] of [...panes]) {
        panes.delete(id)
        try {
          rec.handle?.kill()
        } catch (e) {
          diag(`teardown: killing pane "${id}" failed: ${bounded(e)}`)
        }
        engine.unregister(id)
        rec.replay.dispose()
      }
      engine.dispose()
    }
  }
}
