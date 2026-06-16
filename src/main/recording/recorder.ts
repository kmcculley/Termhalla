import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { castHeader, castEvent } from '@shared/cast'

interface Rec { stream: WriteStream; start: number; file: string }

/** Records terminal output to asciinema v2 .cast files. Best-effort: write errors are swallowed. */
export class Recorder {
  private recs = new Map<string, Rec>()

  start(paneId: string, cols: number, rows: number, baseDir: string): string {
    const existing = this.recs.get(paneId)
    if (existing) return existing.file
    const dir = join(baseDir, 'recordings')
    try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    const startMs = Date.now()
    const file = join(dir, `${paneId}-${startMs}.cast`)
    const stream = createWriteStream(file, { flags: 'a' })
    stream.on('error', () => { /* best-effort */ })
    stream.write(castHeader(cols, rows, Math.floor(startMs / 1000)) + '\n')
    this.recs.set(paneId, { stream, start: startMs, file })
    return file
  }
  private elapsed(r: Rec): number { return (Date.now() - r.start) / 1000 }
  data(paneId: string, chunk: string): void {
    const r = this.recs.get(paneId); if (!r) return
    try { r.stream.write(castEvent(this.elapsed(r), 'o', chunk) + '\n') } catch { /* ignore */ }
  }
  resize(paneId: string, cols: number, rows: number): void {
    const r = this.recs.get(paneId); if (!r) return
    try { r.stream.write(castEvent(this.elapsed(r), 'r', `${cols}x${rows}`) + '\n') } catch { /* ignore */ }
  }
  stop(paneId: string): string | null {
    const r = this.recs.get(paneId); if (!r) return null
    this.recs.delete(paneId)
    try { r.stream.end() } catch { /* ignore */ }
    return r.file
  }
  isRecording(paneId: string): boolean { return this.recs.has(paneId) }
  dispose(): void { for (const id of [...this.recs.keys()]) this.stop(id) }
}
