export interface NeedsInputConfig {
  enabled: boolean
  quietMs: number         // how long output must be silent before we suspect a wait
  patterns: RegExp[]      // tail patterns that indicate an input prompt
  heuristicIdleMs: number // (used by the tracker's no-integration idle heuristic)
}

export const DEFAULT_NEEDS_INPUT_PATTERNS: RegExp[] = [
  /password.*:\s*$/i,
  /passphrase.*:\s*$/i,
  /\[y\/n\]\s*$/i,
  /\(yes\/no\)\s*[:?]?\s*$/i,
  /press any key/i,
  /continue\?\s*$/i,
  /\?\s$/
]

// Matches any ANSI/VT escape sequence (CSI, OSC, SS3, etc.)
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07|\][^\x1b]*\x1b\\)/g

// Matches cursor-absolute-position sequences like ESC[H or ESC[1;1H (row 1 = top of screen).
// PSReadLine uses these to repaint the input area from the top; program output never does this.
const CURSOR_HOME_RE = /^\x1b\[?25[lh]\x1b\[H|\x1b\[H|\x1b\[1;1H/

/** Strip ANSI/VT escape codes from a string, leaving only printable text. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/**
 * Returns true if the string contains no printable characters (only control codes, ANSI escapes,
 * whitespace) OR if it starts with a cursor-home sequence (indicating a terminal screen redraw
 * rather than real program output).
 */
export function isPureControl(s: string): boolean {
  if (CURSOR_HOME_RE.test(s)) return true
  return stripAnsi(s).replace(/[\x00-\x1f\x7f\s]/g, '').length === 0
}

function lastLine(tail: string): string {
  const lines = stripAnsi(tail).split(/\r?\n/)
  return lines[lines.length - 1] ?? ''
}

export function computeNeedsInput(quietMs: number, tail: string, cfg: NeedsInputConfig): boolean {
  if (!cfg.enabled) return false
  if (quietMs < cfg.quietMs) return false
  const line = lastLine(tail)
  return cfg.patterns.some(p => p.test(line))
}

export function looksLikePrompt(tail: string): boolean {
  return /[>$#%]\s*$/.test(lastLine(tail))
}
