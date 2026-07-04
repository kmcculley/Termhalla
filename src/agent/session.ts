/**
 * The agent session core (0017 REQ-004..REQ-010, REQ-013): handshake-first, exactly-one-res
 * dispatch over the pty methods, status detection at the source, push mirroring, and the
 * lifecycle taxonomy. ALL IO is injected (`send`/`diag`/`shutdown` + the pty backend), so the
 * entire core runs in-process under vitest; `main.ts` is the only stdio wiring.
 *
 * Since 0018 (windowed flow control) the once-inert ack/window frames HAVE semantics here:
 * every emitted pty:data payload is counted through the shared flow gate, which pauses the
 * pane's backend past the unacked window and resumes it when the client's acks drain to the
 * low watermark — see src/shared/remote/flow-control.ts for the measure and hysteresis.
 *
 * Protocol comes exclusively from the F15 barrel (REQ-002). Status detection REUSES the
 * existing src/main/status/ stack (REQ-008): one StatusEngine, panes registered BEFORE the
 * backend spawn (the repo's register-before-spawn discipline — a failed spawn unwinds it),
 * fed from each pane's byte stream, unregistered on exit (CONV-011: no stale sessions).
 *
 * Outbound TerminalStatus objects are re-shaped to drop an absent `lastExit` KEY entirely:
 * the tracker's status() carries `lastExit: undefined` before any exit, and F15's strict
 * validator (deliberately) rejects `undefined` inside JSON positions — sending it raw would
 * turn the very first pty:status push into a fatal encode error.
 */
import {
  createAgentHandshake, AGENT_V1_CAPABILITIES, createAgentFlowGate
} from '@shared/remote/protocol'
import type { DecodedItem, WireFrame, ReqFrame, ResFrame, FlowDecision } from '@shared/remote/protocol'
import { CH } from '@shared/ipc-contract'
import type { TerminalStatus } from '@shared/types'
import { StatusEngine } from '../main/status/status-engine'
import type { AgentPtyBackend, AgentPtyHandle } from './pty-backend'
import type { AgentErrorCode } from './error-codes'
import {
  validateSpawnParams, validateWriteParams, validateResizeParams, validateKillParams
} from './validate'

export interface AgentSessionInit {
  /** The advertised version — main.ts passes AGENT_VERSION (the repo package.json version). */
  version: string
  backend: AgentPtyBackend
  /** Resolution target for an empty wire cwd (REQ-007) — main.ts passes the process home. */
  homeDir: string
  send: (frame: WireFrame) => void
  diag: (text: string) => void
  shutdown: (code: number) => void
}

export interface AgentSession {
  /** Send the agent hello — MUST be called before any input is fed (REQ-004). */
  start(): void
  /** Feed one decoded item from the inbound stream. */
  onItem(item: DecodedItem): void
  /** The inbound stream ended (ssh channel / parent gone): clean shutdown (REQ-013). */
  endOfInput(): void
}

const bounded = (e: unknown): string => String(e instanceof Error ? e.message : e).slice(0, 300)

export const createAgentSession = (init: AgentSessionInit): AgentSession => {
  const handshake = createAgentHandshake({ version: init.version, capabilities: AGENT_V1_CAPABILITIES })
  const panes = new Map<string, AgentPtyHandle>()
  let established = false
  let ended = false

  // Windowed flow control (0018, REQ-013): ONE gate per session; its diagnostics ride the
  // session's stderr channel. Decisions are applied to the pane's backend handle synchronously
  // inside whatever event produced them (data emission, ack, window).
  const gate = createAgentFlowGate({ onDiagnostic: init.diag })
  const applyDecisions = (decisions: FlowDecision[]): void => {
    for (const d of decisions) {
      const pane = panes.get(d.id)
      if (!pane) continue // the pane raced away; its flow state is pruned on the exit funnel
      // Containment parity with the dispatch path (FINDING-001): a throwing backend
      // pause()/resume() degrades to a diagnostic, never crashes the agent.
      try {
        if (d.action === 'pause') pane.pause()
        else pane.resume()
      } catch (e) {
        init.diag(`flow: ${d.action} on pane "${d.id}" failed: ${bounded(e)} - the session continues`)
      }
    }
  }

  /** Drop an absent lastExit KEY (see module header) and clone to inert JSON data. */
  const statusPayload = (s: TerminalStatus): Record<string, unknown> =>
    s.lastExit === undefined ? { state: s.state, since: s.since } : { state: s.state, lastExit: s.lastExit, since: s.since }

  const engine = new StatusEngine(
    (id, status) => { if (!ended) init.send({ type: 'evt', channel: CH.ptyStatus, args: [id, statusPayload(status)] }) },
    (id, cwd) => { if (!ended) init.send({ type: 'evt', channel: CH.ptyCwd, args: [id, cwd] }) }
  )

  const end = (code: number): void => {
    if (ended) return
    ended = true
    for (const [id, handle] of [...panes]) {
      panes.delete(id)
      try { handle.kill() } catch (e) { init.diag(`shutdown: killing pane "${id}" failed: ${bounded(e)}`) }
      engine.unregister(id)
    }
    gate.dispose() // session end clears ALL flow state (REQ-009)
    engine.dispose()
    init.shutdown(code)
  }

  const paneExited = (id: string, code: number): void => {
    if (!panes.has(id)) return // exactly-once: kill-initiated and self-exit funnel here
    panes.delete(id)
    gate.paneExited(id) // prune flow state (REQ-009); late acks/windows hit the untracked paths
    engine.markExit(id, code) // final status (lastExit) flows out BEFORE the exit event
    engine.unregister(id)
    if (!ended) init.send({ type: 'evt', channel: CH.ptyExit, args: [id, code] })
  }

  const dispatch = (req: ReqFrame): void => {
    let replied = false
    const reply = (res: ResFrame): void => {
      if (replied) return
      replied = true
      init.send(res)
    }
    const ok = (result: unknown): void => reply({ type: 'res', id: req.id, ok: true, result })
    const fail = (code: AgentErrorCode, message: string): void =>
      reply({ type: 'res', id: req.id, ok: false, error: { message, code } })

    try {
      switch (req.method) {
        case CH.ptySpawn: {
          const v = validateSpawnParams(req.params)
          if (!v.ok) return fail(v.code, v.message)
          const a = v.args
          if (panes.has(a.id)) return ok(true) // adopt: the pane is live, never respawn (local semantic)
          const cwd = a.cwd === '' ? init.homeDir : a.cwd
          engine.register(a.id) // register BEFORE spawn — a failed spawn unwinds cleanly
          let handle: AgentPtyHandle
          try {
            handle = init.backend.spawn({ id: a.id, cwd, cols: a.cols, rows: a.rows, shellId: a.shellId })
          } catch (e) {
            engine.unregister(a.id)
            return fail('spawn-failed', `pty:spawn "${a.id}" failed: ${bounded(e)} - no pane was registered`)
          }
          panes.set(a.id, handle)
          handle.onExit((code) => paneExited(a.id, code))
          handle.onData((data) => {
            // Liveness guard (FINDING-001): a real-backend data straggler delivered after
            // onExit must never emit pty:data AFTER pty:exit — exit-last is REQ-010's contract.
            // panes.has stays true through the legitimate pre-exit flush window.
            if (!panes.has(a.id)) return
            engine.feed(a.id, data)
            if (!ended) init.send({ type: 'evt', channel: CH.ptyData, args: [a.id, data] })
            // Flow control (0018 REQ-005): count the SAME payload string just emitted; a
            // crossing pauses the backend synchronously, within this very delivery — the
            // fake backend queues (and node-pty stops reading) from the next chunk on.
            applyDecisions(gate.onDataEmitted(a.id, data))
          })
          return ok(false) // fresh spawn
        }
        case CH.ptyWrite: {
          const v = validateWriteParams(req.params)
          if (!v.ok) return fail(v.code, v.message)
          const pane = panes.get(v.args.id)
          if (!pane) return fail('unknown-pane', `pty:write: no live pane "${v.args.id}" on this agent`)
          pane.write(v.args.data)
          return ok(null)
        }
        case CH.ptyResize: {
          const v = validateResizeParams(req.params)
          if (!v.ok) return fail(v.code, v.message)
          const pane = panes.get(v.args.id)
          if (!pane) return fail('unknown-pane', `pty:resize: no live pane "${v.args.id}" on this agent`)
          pane.resize(v.args.cols, v.args.rows)
          return ok(null)
        }
        case CH.ptyKill: {
          const v = validateKillParams(req.params)
          if (!v.ok) return fail(v.code, v.message)
          const pane = panes.get(v.id)
          if (!pane) return fail('unknown-pane', `pty:kill: no live pane "${v.id}" on this agent`)
          pane.kill() // the handle's exit funnels through paneExited (pty:exit exactly once)
          return ok(null)
        }
        default:
          return fail('unknown-method',
            `unknown method "${req.method}" - the v1 agent implements only the pty methods (${CH.ptySpawn}, ${CH.ptyWrite}, ${CH.ptyResize}, ${CH.ptyKill}); other domains are not advertised`)
      }
    } catch (e) {
      fail('internal', `handler for "${req.method}" failed: ${bounded(e)} - the session continues`)
    }
  }

  return {
    start(): void {
      init.send(handshake.helloFrame())
    },

    onItem(item: DecodedItem): void {
      if (ended) return

      if (item.kind === 'fatal') {
        init.diag(`fatal framing error (${item.error.reason}): ${item.error.message} - shutting down`)
        return end(1)
      }

      if (!established) {
        if (item.kind === 'message-error') {
          init.diag(`handshake failed (${item.error.reason}): ${item.error.message}`)
          return end(1)
        }
        const result = handshake.onMessage(item.frame)
        if (!result.ok) {
          init.diag(`handshake failed (${result.failure.reason}): ${result.failure.message}`)
          return end(1)
        }
        established = true
        return
      }

      if (item.kind === 'message-error') {
        init.diag(`protocol (${item.error.reason}): ${item.error.message} - frame skipped, session continues`)
        return
      }

      const frame = item.frame
      switch (frame.type) {
        case 'req':
          return dispatch(frame)
        case 'ack':
          // Flow control (0018, REQ-006/REQ-013 — F16's inertness superseded per TEST-773's
          // retirement path): fire-and-forget, never answered with a frame.
          applyDecisions(gate.onAck(frame.id, frame.bytes))
          return
        case 'window':
          // Per-pane with `id`, connection-wide default without (REQ-007). Fire-and-forget.
          applyDecisions(gate.onWindow(frame.size, frame.id))
          return
        case 'hello':
        case 'res':
        case 'evt':
          init.diag(`protocol: unexpected inbound "${frame.type}" frame after establishment - ignored (the agent sends no requests and owns the push direction in v1)`)
          return
      }
    },

    endOfInput(): void {
      end(0)
    }
  }
}
