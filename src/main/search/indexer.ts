import { stripAnsi } from '../status/needs-input'
import { SegmentBuffer, FLUSH_TICK_MS } from './segment-buffer'
import type { SearchService } from './search-service'

/** Owns a per-pane SegmentBuffer + cwd/muted maps; feeds flushed segments to SearchService. One
 *  shared low-frequency timer flushes idle buffers; size-flush is immediate; pane exit flushes the
 *  remainder. Muted panes drop all data. */
export class Indexer {
  private buffers = new Map<string, SegmentBuffer>()
  private cwds = new Map<string, string>()
  private muted = new Set<string>()
  private timer: ReturnType<typeof setInterval>

  constructor(private readonly svc: SearchService, private readonly now: () => number = () => Date.now()) {
    this.timer = setInterval(() => this.tick(), FLUSH_TICK_MS)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  setCwd(id: string, cwd: string): void { this.cwds.set(id, cwd); this.buffers.get(id)?.setCwd(cwd) }

  setMuted(id: string, muted: boolean): void {
    if (muted) { this.muted.add(id); this.buffers.delete(id) } else this.muted.delete(id)
  }

  data(id: string, raw: string): void {
    if (this.muted.has(id)) return
    let b = this.buffers.get(id)
    if (!b) { b = new SegmentBuffer(this.cwds.get(id) ?? ''); this.buffers.set(id, b) }
    const seg = b.push(stripAnsi(raw), this.now())
    if (seg) this.svc.insertSegments([{ paneId: id, ...seg }])
  }

  remove(id: string): void {
    const seg = this.buffers.get(id)?.end()
    if (seg) this.svc.insertSegments([{ paneId: id, ...seg }])
    this.buffers.delete(id); this.cwds.delete(id); this.muted.delete(id)
  }

  dispose(): void {
    clearInterval(this.timer)
    for (const [id, b] of this.buffers) { const seg = b.end(); if (seg) this.svc.insertSegments([{ paneId: id, ...seg }]) }
    this.buffers.clear()
  }

  private tick(): void {
    const t = this.now()
    const out: Array<{ paneId: string; text: string; ts: number; cwd: string }> = []
    for (const [id, b] of this.buffers) { const seg = b.flushDue(t); if (seg) out.push({ paneId: id, ...seg }) }
    if (out.length) this.svc.insertSegments(out)
  }
}
