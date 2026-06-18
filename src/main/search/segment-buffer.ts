export interface Segment { text: string; ts: number; cwd: string }

export const SEGMENT_IDLE_MS = 1000
export const SEGMENT_MAX_BYTES = 8192
/** How often the Indexer polls buffers for idle flushes. Must be < SEGMENT_IDLE_MS so an idle
 *  buffer is flushed within ~1.5× SEGMENT_IDLE_MS of its last output. */
export const FLUSH_TICK_MS = 500

/** Pure per-pane output accumulator. The caller passes ANSI-stripped text. Emits a Segment when the
 *  buffer crosses the size threshold (push), has been idle long enough (flushDue), or the pane ends
 *  (end). Whitespace-only buffers produce no segment. No I/O, no timers. */
export class SegmentBuffer {
  private buf = ''
  private startTs = 0
  private lastTs = 0

  constructor(private cwd: string = '') {}

  setCwd(cwd: string): void { this.cwd = cwd }

  push(stripped: string, now: number): Segment | null {
    if (!this.buf) this.startTs = now
    this.buf += stripped
    this.lastTs = now
    return this.buf.length >= SEGMENT_MAX_BYTES ? this.take() : null
  }

  flushDue(now: number): Segment | null {
    return this.buf && now - this.lastTs >= SEGMENT_IDLE_MS ? this.take() : null
  }

  end(): Segment | null { return this.buf ? this.take() : null }

  private take(): Segment | null {
    const text = this.buf.trim()
    const ts = this.startTs
    this.buf = ''
    return text ? { text, ts, cwd: this.cwd } : null
  }
}
