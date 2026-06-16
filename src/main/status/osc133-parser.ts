import { scanOsc } from './osc-scanner'

export interface MarkerEvent { kind: 'A' | 'B' | 'C' | 'D'; exit?: number }

const OSC = '\x1b]133;'

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
    return events
  }
}
