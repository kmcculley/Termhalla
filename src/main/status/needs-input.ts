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

function lastLine(tail: string): string {
  const lines = tail.split(/\r?\n/)
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
