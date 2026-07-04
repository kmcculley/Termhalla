/**
 * Framing over an arbitrary byte stream (REQ-003..REQ-006, REQ-016).
 *
 * Wire format: a 4-byte BIG-ENDIAN unsigned 32-bit payload byte length, then the
 * payload — the UTF-8 encoding of `JSON.stringify(frame)`. The length counts payload
 * BYTES only (never the header, never UTF-16 code units).
 *
 * Error taxonomy (REQ-006):
 *  - FATAL (stream position unrecoverable): a declared length above the limit. The
 *    decoder yields one `fatal` item and refuses further input (`decoder-dead`).
 *  - PER-FRAME (framing intact): payload not valid UTF-8 JSON (`bad-json`) or not a
 *    valid v1 wire message (`bad-message`) — surfaced in stream order, decoding
 *    continues with the next frame.
 *
 * Determinism (REQ-005): the item sequence is a pure function of the concatenated byte
 * stream — identical under every chunk partition. Payload bytes are buffered until the
 * whole frame arrived, then decoded in one step, so split multi-byte UTF-8 sequences
 * are safe. No time, no randomness, no iteration-order dependence.
 *
 * Pure module: zero Node/Electron imports (REQ-001); binary data is Uint8Array and
 * text conversion uses the TextEncoder/TextDecoder web globals.
 */
import { ProtocolError, protocolFailure, type ProtocolFailure } from './errors'
import { parseWireMessage, type WireFrame } from './messages'

/** Size of the length prefix, in bytes. */
export const FRAME_HEADER_BYTES = 4

/** Default maximum payload size: 8 MiB (REQ-004, CONV-003 — enforced, never silent). */
export const DEFAULT_MAX_FRAME_BYTES = 8 * 1024 * 1024

export interface FrameCodecOptions {
  /** Override the maximum payload byte length (both directions default to 8 MiB). */
  maxFrameBytes?: number
}

export type DecodedItem =
  | { kind: 'message'; frame: WireFrame }
  | { kind: 'message-error'; error: ProtocolFailure }
  | { kind: 'fatal'; error: ProtocolFailure }

export interface FrameDecoder {
  /** Feed a chunk; returns the items completed by it (possibly none). Throws `decoder-dead` after a fatal item. */
  push(chunk: Uint8Array): DecodedItem[]
}

/**
 * Encode one frame (REQ-003). Validates the frame first (throws `bad-message` on a
 * malformed one — never emits unparseable bytes) and enforces the size limit (throws
 * `frame-too-large` naming both the actual byte count and the limit — REQ-004).
 */
export const encodeFrame = (frame: WireFrame, opts?: FrameCodecOptions): Uint8Array => {
  const validated = parseWireMessage(frame)
  if (!validated.ok) throw new ProtocolError(validated.error)

  const max = opts?.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
  const payload = new TextEncoder().encode(JSON.stringify(frame))
  if (payload.byteLength > max) {
    throw new ProtocolError(protocolFailure(
      'frame-too-large',
      `frame payload is ${payload.byteLength} bytes, over the ${max}-byte limit — refusing to encode (split the payload or raise maxFrameBytes)`,
      { payloadBytes: payload.byteLength, maxFrameBytes: max }
    ))
  }

  const out = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength)
  new DataView(out.buffer).setUint32(0, payload.byteLength, false)
  out.set(payload, FRAME_HEADER_BYTES)
  return out
}

/** Create an incremental decoder (REQ-005, REQ-006). One instance per byte stream. */
export const createFrameDecoder = (opts?: FrameCodecOptions): FrameDecoder => {
  const max = opts?.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
  let buffered = new Uint8Array(0)
  let dead = false

  const decodePayload = (payload: Uint8Array): DecodedItem => {
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(payload)
    } catch (e) {
      return {
        kind: 'message-error',
        error: protocolFailure(
          'bad-json',
          `frame payload (${payload.byteLength} bytes) is not valid UTF-8 — cannot parse it as JSON`,
          { payloadBytes: payload.byteLength, cause: String(e) }
        )
      }
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (e) {
      return {
        kind: 'message-error',
        error: protocolFailure(
          'bad-json',
          `frame payload (${payload.byteLength} bytes) is not valid JSON: ${String(e)}`,
          { payloadBytes: payload.byteLength, cause: String(e) }
        )
      }
    }
    const parsed = parseWireMessage(value)
    if (!parsed.ok) return { kind: 'message-error', error: parsed.error }
    return { kind: 'message', frame: parsed.frame }
  }

  return {
    push(chunk: Uint8Array): DecodedItem[] {
      if (dead) {
        throw new ProtocolError(protocolFailure(
          'decoder-dead',
          'this frame decoder hit a fatal framing error earlier and cannot resume — create a new decoder for a new stream',
          {}
        ))
      }
      if (chunk.byteLength > 0) {
        const next = new Uint8Array(buffered.byteLength + chunk.byteLength)
        next.set(buffered, 0)
        next.set(chunk, buffered.byteLength)
        buffered = next
      }

      const items: DecodedItem[] = []
      let pos = 0
      while (buffered.byteLength - pos >= FRAME_HEADER_BYTES) {
        const declared = new DataView(buffered.buffer, buffered.byteOffset + pos, FRAME_HEADER_BYTES).getUint32(0, false)
        if (declared > max) {
          dead = true
          items.push({
            kind: 'fatal',
            error: protocolFailure(
              'frame-too-large',
              `incoming frame declares ${declared} bytes, over the ${max}-byte limit — the declared length cannot be trusted, stream unrecoverable`,
              { declaredBytes: declared, maxFrameBytes: max }
            )
          })
          buffered = new Uint8Array(0)
          return items
        }
        if (buffered.byteLength - pos - FRAME_HEADER_BYTES < declared) break // incomplete frame — wait for more bytes
        const payload = buffered.subarray(pos + FRAME_HEADER_BYTES, pos + FRAME_HEADER_BYTES + declared)
        items.push(decodePayload(payload))
        pos += FRAME_HEADER_BYTES + declared
      }
      // keep only the unconsumed tail (copy, so the big backing allocation is released)
      if (pos > 0) buffered = buffered.slice(pos)
      return items
    }
  }
}
