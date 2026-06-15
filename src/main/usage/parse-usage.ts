import type { UsageMetrics } from '@shared/types'

const DEFAULT_WINDOW = 200000

/** The model's context window: 1M for [1m] variants, else 200k. */
export function windowFor(model: string): number {
  return /\[1m\]/i.test(model) ? 1_000_000 : DEFAULT_WINDOW
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Sum token usage across assistant turns; the last turn's input side is the current context. */
export function parseClaudeUsage(jsonl: string): UsageMetrics {
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
  const contextWindow = windowFor(model)
  const contextPct = contextWindow > 0 ? Math.round((contextTokens / contextWindow) * 100) : 0
  return { input, output, cacheRead, cacheCreation, contextTokens, contextWindow, contextPct }
}
