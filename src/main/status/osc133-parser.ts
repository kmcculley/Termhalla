import { scanOsc } from './osc-scanner'

export interface MarkerEvent { kind: 'A' | 'B' | 'C' | 'D'; exit?: number }

const OSC = '\x1b]133;'

/** Maximum retained no-terminator carry-over, in UTF-8 bytes (the OrkyOscParser
 *  MAX_PENDING_BYTES precedent, REQ-006 there). `scanOsc`'s own carry-over is unbounded when the
 *  prefix appears but no terminator ever arrives (an accidental `cat` of a binary suffices) —
 *  growing forever AND rescanned per chunk (O(n²)) on the StatusEngine hot path. The longest
 *  LEGAL marker is prefix + `D;<int32>` + ST ≈ 21 bytes, so 512 is orders of magnitude of
 *  headroom: no in-flight valid marker is ever clipped, only a stream already past any legal
 *  length. Pinned by tests/main/osc-pending-bound.test.ts. */
export const MAX_PENDING_BYTES = 512

function parseBody(body: string): MarkerEvent | null {
  const parts = body.split(';')
  const kind = parts[0]
  if (kind === 'A' || kind === 'B' || kind === 'C') return { kind }
  if (kind === 'D') {
    if (parts[1] === undefined || parts[1] === '') return { kind: 'D', exit: undefined }
    const n = Number(parts[1])
    return { kind: 'D', exit: Number.isNaN(n) ? undefined : n }
  }
  return null
}

/** Stateful scanner: feed PTY output chunks, get OSC 133 marker events back.
 *  Keeps a small carry-over buffer so markers split across chunks still parse. */
export class Osc133Parser {
  private buf = ''

  push(chunk: string): MarkerEvent[] {
    this.buf += chunk
    const events: MarkerEvent[] = []
    this.buf = scanOsc(this.buf, OSC, body => { const ev = parseBody(body); if (ev) events.push(ev) })
    // Explicit bounded ceiling on the no-terminator carry-over path, layered on top of scanOsc
    // (which stays shared and untouched — the OrkyOscParser pattern). Never clips a legal marker.
    if (Buffer.byteLength(this.buf, 'utf8') > MAX_PENDING_BYTES) this.buf = ''
    return events
  }
}
