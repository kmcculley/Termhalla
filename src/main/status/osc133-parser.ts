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

    while (true) {
      const start = this.buf.indexOf(OSC)
      if (start === -1) break
      const from = start + OSC.length
      const bel = this.buf.indexOf('\x07', from)
      const st = this.buf.indexOf('\x1b\\', from)
      let end = -1, termLen = 0
      if (bel !== -1 && (st === -1 || bel < st)) { end = bel; termLen = 1 }
      else if (st !== -1) { end = st; termLen = 2 }
      if (end === -1) { this.buf = this.buf.slice(start); return events }
      const ev = parseBody(this.buf.slice(from, end))
      if (ev) events.push(ev)
      this.buf = this.buf.slice(end + termLen)
    }

    const lastEsc = this.buf.lastIndexOf('\x1b')
    this.buf = lastEsc !== -1 && OSC.startsWith(this.buf.slice(lastEsc))
      ? this.buf.slice(lastEsc)
      : ''
    return events
  }
}
