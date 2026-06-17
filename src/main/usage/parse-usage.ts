import type { UsageMetrics } from '@shared/types'

const DEFAULT_WINDOW = 200000
const LARGE_WINDOW = 1_000_000

/** The model's context window: 1M for [1m] variants, else 200k. The `[1m]` suffix is not
 *  recorded in transcripts (they store the canonical id, e.g. `claude-opus-4-8`); it lives
 *  in the Claude settings model alias (e.g. `opus[1m]`), so both are checked. */
export function windowFor(model: string, alias = ''): number {
  return /\[1m\]/i.test(model) || /\[1m\]/i.test(alias) ? LARGE_WINDOW : DEFAULT_WINDOW
}

/** The context window to score against: the model/alias window, auto-bumped to the large window
 *  when the observed `contextTokens` already exceed it — a >200k context can only be a >200k
 *  window, even when the alias is unknown, so we never report >100%. */
export function computeContextWindow(model: string, alias: string, contextTokens: number): number {
  const w = windowFor(model, alias)
  return contextTokens > w ? LARGE_WINDOW : w
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Sum token usage across assistant turns; the last turn's input side is the current context.
 *  `alias` is the Claude settings model alias (carries the `[1m]` flag the transcript omits). */
export function parseClaudeUsage(jsonl: string, alias = ''): UsageMetrics {
  let input = 0, output = 0, cacheRead = 0, cacheCreation = 0, contextTokens = 0, model = ''
  for (const line of jsonl.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let obj: { type?: string; message?: { model?: string; usage?: Record<string, unknown> } }
    try { obj = JSON.parse(t) } catch { continue }
    const u = obj?.message?.usage
    if (obj?.type !== 'assistant' || !u) continue
    const it = num(u.input_tokens), cr = num(u.cache_read_input_tokens), cc = num(u.cache_creation_input_tokens)
    input += it; output += num(u.output_tokens); cacheRead += cr; cacheCreation += cc
    contextTokens = it + cr + cc
    if (typeof obj.message?.model === 'string') model = obj.message.model
  }
  const contextWindow = computeContextWindow(model, alias, contextTokens)
  const contextPct = contextWindow > 0 ? Math.round((contextTokens / contextWindow) * 100) : 0
  return { input, output, cacheRead, cacheCreation, contextTokens, contextWindow, contextPct }
}
