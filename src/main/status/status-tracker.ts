import type { TerminalStatus, TermState } from '@shared/types'
import {
  computeIdleFallback, computeNeedsInput, isPureControl, stripAnsi,
  AGENT_WORKING_RE, AGENT_WORKING_GRACE_MS, type NeedsInputConfig
} from './needs-input'

export class StatusTracker {
  private state: TermState = 'idle'
  private lastExit?: 'success' | 'failure'
  private since: number
  private lastOutputAt: number
  private tail = ''
  private hasMarkers = false
  private aiActive = false
  private lastWorkingAt = -Infinity   // when the AI working indicator ("esc to interrupt") was last seen
  private scanBuf = ''                 // rolling printable buffer for detecting the indicator across chunks

  constructor(now: number, private readonly cfg: NeedsInputConfig) {
    this.since = now
    this.lastOutputAt = now
  }

  /** Mark whether this terminal is running a detected AI agent. When set, sustained output
   *  silence is treated as idle (awaiting input) even without a recognized shell prompt — an
   *  AI agent is one long shell command that sits quiet at its own TUI prompt. */
  setAiActive(active: boolean): void { this.aiActive = active }

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
    // Scan ALL output (including screen-repaints classified as pure control below) for the AI
    // agent's working indicator. An agent blocked on a tool keeps redrawing "esc to interrupt"
    // via repaints that don't update the quiet timer — so this is what keeps it "busy" while quiet.
    // It also flips an *idle* AI session back to busy: once the agent has gone quiet at its prompt
    // (idle), nothing else would, because the launching shell emits no new command-start marker
    // when the agent starts its next turn — so the working indicator is the resume signal.
    this.scanBuf = (this.scanBuf + stripAnsi(text)).slice(-300)
    if (AGENT_WORKING_RE.test(this.scanBuf)) {
      this.lastWorkingAt = now
      this.scanBuf = ''
      if (this.aiActive && this.state !== 'busy') this.set('busy', now)
    }

    const pure = isPureControl(text)
    if (!pure) {
      // Only real printable output (not ANSI-only or screen-redraw) updates
      // the quiet timer and the tail, and resets a needs-input state back to busy.
      this.lastOutputAt = now
      // Store the tail as printable text (ANSI stripped). A full-screen ConPTY repaint
      // arrives as one big chunk whose trailing bytes are erase-line/cursor sequences; if
      // those were kept, slice(-400) would evict the real prompt and break needs-input.
      this.tail = (this.tail + stripAnsi(text)).slice(-400)
      if (this.state === 'needs-input') this.set('busy', now)
    }
    if (!this.hasMarkers && this.state !== 'busy') this.set('busy', now)
    return this.status()
  }

  tick(now: number): TerminalStatus {
    const quietMs = now - this.lastOutputAt
    const aiWorkingRecent = now - this.lastWorkingAt < AGENT_WORKING_GRACE_MS
    if (this.state === 'busy' && computeIdleFallback(quietMs, this.tail, this.hasMarkers, this.cfg, { aiActive: this.aiActive, aiWorkingRecent })) {
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
