import type { TerminalStatus } from '@shared/types'
import { Osc133Parser } from './osc133-parser'
import { StatusTracker } from './status-tracker'
import { DEFAULT_NEEDS_INPUT_PATTERNS, type NeedsInputConfig } from './needs-input'

interface Session { parser: Osc133Parser; tracker: StatusTracker; last: string }

function defaultConfig(): NeedsInputConfig {
  const envQuiet = Number(process.env.TERMHALLA_NEEDS_INPUT_QUIET_MS)
  return {
    enabled: true,
    quietMs: Number.isFinite(envQuiet) && envQuiet > 0 ? envQuiet : 10000,
    patterns: DEFAULT_NEEDS_INPUT_PATTERNS,
    heuristicIdleMs: 1500,
    heuristicIdleHardMs: 5000
  }
}

export class StatusEngine {
  private sessions = new Map<string, Session>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly onStatus: (id: string, status: TerminalStatus) => void,
    private readonly now: () => number = () => Date.now()
  ) {}

  register(id: string): void {
    this.sessions.set(id, {
      parser: new Osc133Parser(),
      tracker: new StatusTracker(this.now(), defaultConfig()),
      last: ''
    })
    this.emit(id)
    this.ensureTimer()
  }

  feed(id: string, data: string): void {
    const s = this.sessions.get(id); if (!s) return
    const t = this.now()
    for (const m of s.parser.push(data)) s.tracker.onMarker(m.kind, m.exit, t)
    s.tracker.onOutput(data, t)
    this.emit(id)
  }

  markExit(id: string, code: number): void {
    const s = this.sessions.get(id); if (!s) return
    const t = this.now()
    s.tracker.onMarker('D', code, t)
    s.tracker.onMarker('A', undefined, t)
    this.emit(id)
  }

  unregister(id: string): void {
    this.sessions.delete(id)
    if (this.sessions.size === 0) this.stopTimer()
  }

  dispose(): void { this.sessions.clear(); this.stopTimer() }

  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      const t = this.now()
      for (const id of this.sessions.keys()) {
        this.sessions.get(id)!.tracker.tick(t)
        this.emit(id)
      }
    }, 500)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  private stopTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private emit(id: string): void {
    const s = this.sessions.get(id); if (!s) return
    const st = s.tracker.status()
    const key = `${st.state}|${st.lastExit ?? ''}`
    if (key !== s.last) { s.last = key; this.onStatus(id, st) }
  }
}
