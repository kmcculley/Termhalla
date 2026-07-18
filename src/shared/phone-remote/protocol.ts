/**
 * The phone-remote WS wire vocabulary (feature 0026, REQ-010/REQ-013/REQ-014/REQ-018) — Electron-
 * free so it can be shared by main and the phone client. `parseClientMessage` is TOTAL over
 * untrusted frames (a string text frame, a `Buffer` binary frame, or any other raw value the
 * transport might hand back): malformed JSON, wrong shapes, unknown types, non-string fields,
 * and oversized frames each yield a typed `{ ok: false }` result with a specific code/message —
 * never a throw. The client->server type set is CLOSED (REQ-014/REQ-013): no resize, no pane
 * lifecycle capability exists anywhere in this vocabulary.
 */

/** Bumped on any wire-incompatible change; `hello` carries it so a stale cached client can detect
 *  drift and prompt a reload. */
export const PHONE_REMOTE_PROTO_VERSION = 1

/** The server->client vocabulary (REQ-010's stated minimum). */
export const SERVER_MESSAGE_TYPES: readonly string[] =
  ['hello', 'panes', 'status', 'grid', 'snapshot', 'data', 'resync', 'paneExit', 'error']

/** The CLOSED client->server vocabulary (REQ-014): subscribe/unsubscribe/input only. No resize,
 *  no lifecycle verb (kill/spawn/close/split/move/…) exists here or anywhere in this module. */
export const CLIENT_MESSAGE_TYPES: readonly string[] = ['subscribe', 'unsubscribe', 'input']

export type ClientMessageType = 'subscribe' | 'unsubscribe' | 'input'

/** Inbound frame size bound (REQ-017/REQ-018), co-located here since it gates parsing itself. */
export const PHONE_WS_MAX_FRAME = 1_048_576

export interface ParsedClientMessage {
  type: ClientMessageType
  paneId: string
  data?: string
}

export type ParseClientMessageResult =
  | { ok: true; msg: ParsedClientMessage }
  | { ok: false; error: { code: string; message: string } }

const fail = (code: string, message: string): ParseClientMessageResult => ({ ok: false, error: { code, message } })

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Total over any raw WS frame value. Order matters: binary frames are rejected before any
 *  string/JSON handling is attempted, and the frame-size bound is enforced before JSON.parse. */
export function parseClientMessage(raw: unknown): ParseClientMessageResult {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    return fail('binary-frame', 'binary frames are not supported')
  }
  if (typeof raw !== 'string') {
    return fail('invalid-frame', 'expected a text frame')
  }
  if (raw.length > PHONE_WS_MAX_FRAME) {
    return fail('frame-too-large', `frame exceeds the ${PHONE_WS_MAX_FRAME}-byte bound`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('invalid-json', 'the frame is not valid JSON')
  }
  if (!isPlainObject(parsed)) {
    return fail('invalid-shape', 'expected a JSON object frame')
  }

  const type = parsed.type
  if (typeof type !== 'string') {
    return fail('missing-type', "the 'type' field is required and must be a string")
  }
  if (!CLIENT_MESSAGE_TYPES.includes(type)) {
    return fail('unknown-type', `unknown message type '${type}'`)
  }
  const paneId = parsed.paneId
  if (typeof paneId !== 'string' || paneId.length === 0) {
    return fail('missing-pane-id', "the 'paneId' field is required and must be a non-empty string")
  }
  if (type === 'input') {
    const data = parsed.data
    if (typeof data !== 'string') {
      return fail('invalid-data', "input requires a 'data' field that is a string")
    }
    return { ok: true, msg: { type, paneId, data } }
  }
  return { ok: true, msg: { type: type as ClientMessageType, paneId } }
}
