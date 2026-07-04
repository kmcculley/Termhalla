/**
 * The agent session core — ONE protocol CONNECTION (F16 REQ-004..REQ-010, REQ-013; F18/0019
 * REQ-005..REQ-009): handshake-first, exactly-one-res dispatch, and the lifecycle taxonomy.
 * ALL IO is injected (`send`/`diag`/`shutdown`), so the entire core runs in-process under
 * vitest; `main.ts` is the only stdio wiring.
 *
 * Since 0019 the pane ownership lives in an injectable SESSION STORE (`session-store.ts`):
 *  - `init.backend` + `init.homeDir` (the F16 composition, what `main.ts` ships): the session
 *    creates its OWN store and `destroy()`s it on every end path — byte-compatible with F16
 *    (end of input kills every live pane and exits 0; a live pane never outlives the process).
 *  - `init.sessions` (the survival composition, locked decision 3): the session is one
 *    connection over a LONGER-LIVED store; every end path — clean EOF, fatal framing,
 *    handshake failure, an outbound send failure — DETACHES (`unbind()`): panes keep running,
 *    replay + status keep consuming, and a later connection reattaches via `pty:attach` /
 *    `pty:sessions`. F19/F21 wire this seam to a reattachable transport.
 *
 * Since 0018 (windowed flow control) the once-inert ack/window frames HAVE semantics: every
 * emitted pty:data payload is counted through the shared flow gate, which pauses the pane's
 * backend past the unacked window and resumes it when the client's acks drain to the low
 * watermark — see src/shared/remote/flow-control.ts for the measure and hysteresis. The gate
 * itself lives in the session store (the emit path moved there with 0019); this connection
 * merely forwards inbound ack/window frames, fire-and-forget (never answered with a frame).
 *
 * Protocol comes exclusively from the F15 barrel (REQ-002). Outbound TerminalStatus objects
 * are re-shaped to drop an absent `lastExit` KEY (see `session-api.ts` — F15's strict validator
 * rejects `undefined` inside JSON positions).
 */
import {
  createAgentHandshake, AGENT_V1_CAPABILITIES
} from '@shared/remote/protocol'
import type { DecodedItem, WireFrame, ReqFrame, ResFrame } from '@shared/remote/protocol'
import { CH } from '@shared/ipc-contract'
import type { AgentPtyBackend } from './pty-backend'
import type { AgentErrorCode } from './error-codes'
import { AGENT_SESSION_METHODS } from './session-api'
import { createSessionStore, type AgentSessionStore } from './session-store'
import {
  validateSpawnParams, validateWriteParams, validateResizeParams, validateKillParams,
  validateAttachParams, validateSessionsParams
} from './validate'

interface AgentSessionBaseInit {
  /** The advertised version — main.ts passes AGENT_VERSION (the repo package.json version). */
  version: string
  send: (frame: WireFrame) => void
  diag: (text: string) => void
  shutdown: (code: number) => void
}

export type AgentSessionInit = AgentSessionBaseInit & (
  | {
      backend: AgentPtyBackend
      /** Resolution target for an empty wire cwd (REQ-007) — main.ts passes the process home. */
      homeDir: string
      sessions?: undefined
    }
  | {
      /** The survival composition: an external store that OUTLIVES this connection. */
      sessions: AgentSessionStore
      backend?: undefined
      homeDir?: undefined
    }
)

export interface AgentSession {
  /** Send the agent hello — MUST be called before any input is fed (REQ-004). */
  start(): void
  /** Feed one decoded item from the inbound stream. */
  onItem(item: DecodedItem): void
  /** The inbound stream ended (ssh channel / parent gone): end THIS connection (REQ-013). */
  endOfInput(): void
}

const bounded = (e: unknown): string => String(e instanceof Error ? e.message : e).slice(0, 300)

const [ATTACH_METHOD, SESSIONS_METHOD] = AGENT_SESSION_METHODS

export const createAgentSession = (init: AgentSessionInit): AgentSession => {
  const handshake = createAgentHandshake({ version: init.version, capabilities: AGENT_V1_CAPABILITIES })
  const owned = init.sessions === undefined
  const store: AgentSessionStore = init.sessions !== undefined
    ? init.sessions
    : createSessionStore({ backend: init.backend, homeDir: init.homeDir, diag: init.diag })
  let established = false
  let ended = false

  const end = (code: number): void => {
    if (ended) return
    ended = true
    // The owned store dies with its one connection (F16 behavior: panes killed, exit code
    // taxonomy unchanged). An external store merely detaches — the survival substance.
    if (owned) store.destroy()
    else store.unbind()
    init.shutdown(code)
  }

  const dispatch = (req: ReqFrame): void => {
    let replied = false
    const reply = (res: ResFrame): void => {
      if (replied || ended) return
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
          const outcome = store.spawn(v.args)
          if (!outcome.ok) return fail('spawn-failed', outcome.message)
          return ok(outcome.adopted)
        }
        case CH.ptyWrite: {
          const v = validateWriteParams(req.params)
          if (!v.ok) return fail(v.code, v.message)
          if (!store.write(v.args.id, v.args.data)) {
            return fail('unknown-pane', `pty:write: no live pane "${v.args.id}" on this agent`)
          }
          return ok(null)
        }
        case CH.ptyResize: {
          const v = validateResizeParams(req.params)
          if (!v.ok) return fail(v.code, v.message)
          if (!store.resize(v.args.id, v.args.cols, v.args.rows)) {
            return fail('unknown-pane', `pty:resize: no live pane "${v.args.id}" on this agent`)
          }
          return ok(null)
        }
        case CH.ptyKill: {
          const v = validateKillParams(req.params)
          if (!v.ok) return fail(v.code, v.message)
          if (!store.kill(v.id)) {
            return fail('unknown-pane', `pty:kill: no live pane "${v.id}" on this agent`)
          }
          return ok(null)
        }
        case ATTACH_METHOD: {
          const v = validateAttachParams(req.params)
          if (!v.ok) return fail(v.code, v.message)
          // The ONLY async handler: the res is sent when the replay snapshot barrier resolves.
          // Exactly-once rides the shared reply guard; the ordering invariant (REQ-006d) rides
          // the store's hold window, opened synchronously inside store.attach().
          void store.attach(v.id)
            .then((outcome) => {
              if (ended) return // the connection died while the snapshot was in flight
              if (!outcome.ok) return fail(outcome.code, outcome.message)
              try {
                ok(outcome.result) // the res goes out FIRST...
              } finally {
                // FINDING-007: the window must release even when the res send throws — the
                // drain's own deliver path detects a broken sink (store unbinds + the
                // connection ends), instead of wedging the pane's data in held forever.
                outcome.drain()    // ...then the window's held bytes, in the same continuation
              }
            })
            .catch((e) => {
              // FINDING-003: terminal catch — a throw anywhere above (including a throwing
              // send) must never surface as an unhandledRejection in a long-lived agent.
              try {
                init.diag(`${ATTACH_METHOD} "${v.id}" continuation failed: ${bounded(e)}`)
                if (!ended) fail('internal', `${ATTACH_METHOD} "${v.id}" failed: ${bounded(e)} - the session continues`)
              } catch {
                // the send itself is broken; the diag (or the connection's own death path)
                // already recorded the failure — swallowing here is the terminal backstop
              }
            })
          return
        }
        case SESSIONS_METHOD: {
          const v = validateSessionsParams(req.params)
          if (!v.ok) return fail(v.code, v.message)
          return ok(store.list())
        }
        default:
          return fail('unknown-method',
            `unknown method "${req.method}" - the v1 agent implements only the pty methods (${CH.ptySpawn}, ${CH.ptyWrite}, ${CH.ptyResize}, ${CH.ptyKill}, ${ATTACH_METHOD}, ${SESSIONS_METHOD}); other domains are not advertised`)
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
        // Bind BEFORE flipping established: a second concurrent connection is rejected here
        // (the store's single-connection guard — F20 retires it with lease semantics).
        store.bind({
          send: (frame) => { if (!ended) init.send(frame) },
          onSendFailure: (e) => {
            if (ended) return
            init.diag(`connection send failed: ${bounded(e)} - ending this connection (panes survive on an external store)`)
            end(1)
          }
        })
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
          // retirement path): fire-and-forget, never answered with a frame. The gate rides
          // the store (where the emit path lives since 0019).
          store.flowAck(frame.id, frame.bytes)
          return
        case 'window':
          // Per-pane with `id`, connection-wide default without (REQ-007). Fire-and-forget.
          store.flowWindow(frame.size, frame.id)
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
