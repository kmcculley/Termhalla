import type { TerminalStatus, TermState } from '@shared/types'
import {
  computeNeedsInput, isPureControl, looksLikePrompt, tailMatchesInputPrompt, type NeedsInputConfig
} from './needs-input'

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
    // Heuristic idle. Never pre-empt a genuine input prompt (that becomes needs-input).
    if (this.state === 'busy' && quietMs >= this.cfg.heuristicIdleMs
        && !tailMatchesInputPrompt(this.tail, this.cfg.patterns)) {
      const prompt = looksLikePrompt(this.tail)
      if (!this.hasMarkers && prompt) {
        this.set('idle', now)                                  // no-integration: quiet + recognized prompt (fast)
      } else if (quietMs >= this.cfg.heuristicIdleHardMs && (prompt || !this.hasMarkers)) {
        // After sustained silence, fall back to idle when EITHER: we sit at a prompt
        // (integration markers stopped — e.g. a nested shell like `cmd` inside pwsh),
        // OR there were never any markers and the prompt was simply not recognized.
        this.set('idle', now)
      }
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
