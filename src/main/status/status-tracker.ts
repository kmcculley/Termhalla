import type { TerminalStatus, TermState } from '@shared/types'
import { computeNeedsInput, isPureControl, looksLikePrompt, type NeedsInputConfig } from './needs-input'

export class StatusTracker {
  private state: TermState = 'idle'
  private lastExit?: 'success' | 'failure'
  private since: number
  private lastOutputAt: number
  private tail = ''
  private hasMarkers = false

  constructor(now: number, private readonly cfg: NeedsInputConfig) {
    this.since = now
    this.lastOutputAt = now
  }

  onMarker(kind: 'A' | 'B' | 'C' | 'D', exit: number | undefined, now: number): TerminalStatus {
    this.hasMarkers = true
    if (kind === 'D') {
      if (exit !== undefined) this.lastExit = exit === 0 ? 'success' : 'failure'
    } else if (kind === 'A') {
      this.set('idle', now)
    } else {
      this.set('busy', now)
    }
    return this.status()
  }

  onOutput(text: string, now: number): TerminalStatus {
    const pure = isPureControl(text)
    if (!pure) {
      // Only real printable output (not ANSI-only or screen-redraw) updates
      // the quiet timer and the tail, and resets a needs-input state back to busy.
      this.lastOutputAt = now
      this.tail = (this.tail + text).slice(-400)
      if (this.state === 'needs-input') this.set('busy', now)
    }
    if (!this.hasMarkers && this.state !== 'busy') this.set('busy', now)
    return this.status()
  }

  tick(now: number): TerminalStatus {
    const quietMs = now - this.lastOutputAt
    if (!this.hasMarkers && this.state === 'busy'
        && quietMs >= this.cfg.heuristicIdleMs && looksLikePrompt(this.tail)) {
      this.set('idle', now)
    }
    if (this.state === 'busy' && computeNeedsInput(quietMs, this.tail, this.cfg)) {
      this.set('needs-input', now)
    }
    return this.status()
  }

  status(): TerminalStatus {
    return { state: this.state, lastExit: this.lastExit, since: this.since }
  }

  private set(s: TermState, now: number): void {
    if (this.state !== s) { this.state = s; this.since = now }
  }
}
