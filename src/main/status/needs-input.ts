export interface NeedsInputConfig {
  enabled: boolean
  quietMs: number             // how long output must be silent before we suspect a wait
  patterns: RegExp[]          // tail patterns that indicate an input prompt
  heuristicIdleMs: number     // no-integration: quiet + recognized prompt -> idle (fast path)
  heuristicIdleHardMs: number // no-integration: sustained silence -> idle even w/o a recognized prompt
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

// A chunk that BEGINS with a cursor-home sequence is a terminal screen redraw
// (e.g. PSReadLine repainting the input area), not real program output.
// Anchored at start so that output merely *containing* a home sequence (clear, vim, less) is NOT misclassified.
const CURSOR_HOME_RE = /^(?:\x1b\[\?25[lh])*\x1b\[(?:H|1;1H)/

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
  // Skip trailing blank lines: a screen repaint can leave erase-line/newline trailers
  // after the prompt, so the meaningful prompt is the last NON-blank line.
  let i = lines.length - 1
  while (i > 0 && lines[i].trim() === '') i--
  return lines[i] ?? ''
}

/** True if the tail's last line matches one of the input-prompt patterns (timing-agnostic). */
export function tailMatchesInputPrompt(tail: string, patterns: RegExp[]): boolean {
  const line = lastLine(tail)
  return patterns.some(p => p.test(line))
}

export function computeNeedsInput(quietMs: number, tail: string, cfg: NeedsInputConfig): boolean {
  if (!cfg.enabled) return false
  if (quietMs < cfg.quietMs) return false
  return tailMatchesInputPrompt(tail, cfg.patterns)
}

export function looksLikePrompt(tail: string): boolean {
  return /[>$#%]\s*$/.test(lastLine(tail))
}

/**
 * Heuristic idle decision for a *busy* terminal: should sustained silence be treated as
 * "command finished" (idle)? Pure so it can be reasoned about and tested in isolation —
 * this logic is load-bearing (a misread silently wedges a terminal in "busy").
 *
 * Never pre-empts a genuine input prompt (that path becomes needs-input). Otherwise:
 *  - Fast path: no integration markers and we sit at a recognizable shell prompt.
 *  - Slow path: after sustained silence (hard threshold), idle when EITHER we sit at a
 *    prompt (markers stopped — e.g. a nested shell like `cmd` inside pwsh) OR there were
 *    never any markers and the prompt simply went unrecognized.
 *
 * `aiActive` marks a terminal running a detected AI agent (claude/codex). Such an agent is
 * launched as one long shell command (so markers latch busy and no command-done D fires until
 * it exits) and sits at its own TUI prompt — a box, not a shell prompt `looksLikePrompt` would
 * recognize. For these we idle on sustained silence, BUT only once the agent's own "working"
 * indicator has gone away too (`aiWorkingRecent` false): an agent that is busy-but-quiet (e.g.
 * blocked on a `sleep`/long tool, or redrawing only via screen repaints the quiet timer ignores)
 * keeps showing "esc to interrupt", so silence alone must not flip it to idle. See AGENT_WORKING_RE.
 */
export function computeIdleFallback(
  quietMs: number, tail: string, hasMarkers: boolean, cfg: NeedsInputConfig,
  aiActive = false, aiWorkingRecent = false
): boolean {
  if (quietMs < cfg.heuristicIdleMs) return false
  if (tailMatchesInputPrompt(tail, cfg.patterns)) return false
  const atRecognizedPrompt = looksLikePrompt(tail)
  if (!hasMarkers && atRecognizedPrompt) return true
  const sustainedSilence = quietMs >= cfg.heuristicIdleHardMs
  if (aiActive) return sustainedSilence && !aiWorkingRecent
  return sustainedSilence && (atRecognizedPrompt || !hasMarkers)
}

/** An AI agent's "I'm working, press esc to interrupt" status line. Matched space-insensitively
 *  because TUIs position the words with cursor moves (stripped by stripAnsi), so the text arrives
 *  jammed together as "esctointerrupt". Present the whole time the agent works (incl. while
 *  blocked on a tool); absent once it awaits input. */
export const AGENT_WORKING_RE = /esc\s*to\s*interrupt/i

/** How long after the agent last showed its working indicator we still consider it "working".
 *  Must exceed the gap between working-indicator redraws (observed ≈3 s); the agent re-renders it
 *  roughly once a second while busy. */
export const AGENT_WORKING_GRACE_MS = 6000
