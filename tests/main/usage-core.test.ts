import { describe, it, expect } from 'vitest'
import { encodeProjectDir, pickNewestTranscript } from '../../src/main/usage/project-dir'
import { windowFor, computeContextWindow, parseClaudeUsage } from '../../src/main/usage/parse-usage'

describe('encodeProjectDir', () => {
  it('replaces every non-alphanumeric char with a dash (Claude project-dir rule)', () => {
    expect(encodeProjectDir('C:\\dev\\Termhalla')).toBe('C--dev-Termhalla')
    expect(encodeProjectDir('C:\\dev\\my.app two')).toBe('C--dev-my-app-two')
  })
})

describe('pickNewestTranscript', () => {
  it('returns the .jsonl with the greatest mtime', () => {
    expect(pickNewestTranscript([
      { name: 'a.jsonl', mtimeMs: 10 },
      { name: 'b.jsonl', mtimeMs: 30 },
      { name: 'c.jsonl', mtimeMs: 20 }
    ])).toBe('b.jsonl')
  })
  it('ignores non-jsonl and returns null when none', () => {
    expect(pickNewestTranscript([{ name: 'notes.txt', mtimeMs: 99 }])).toBeNull()
    expect(pickNewestTranscript([])).toBeNull()
  })
})

describe('windowFor', () => {
  it('defaults to 200000 and uses 1000000 for [1m] models', () => {
    expect(windowFor('claude-opus-4')).toBe(200000)
    expect(windowFor('claude-opus-4-8[1m]')).toBe(1000000)
  })
  it('detects [1m] from the model alias when the transcript model lacks it', () => {
    // Real transcripts record the canonical id (no [1m]); the 1M flag lives in the
    // settings model alias, e.g. "opus[1m]".
    expect(windowFor('claude-opus-4-8')).toBe(200000)
    expect(windowFor('claude-opus-4-8', 'opus[1m]')).toBe(1000000)
  })
})

describe('computeContextWindow', () => {
  it('uses the model/alias window when the observed context fits', () => {
    expect(computeContextWindow('claude-opus-4', '', 50000)).toBe(200000)
    expect(computeContextWindow('claude-opus-4', 'opus[1m]', 50000)).toBe(1000000)
  })
  it('auto-bumps to 1M when observed context exceeds the default window', () => {
    expect(computeContextWindow('claude-opus-4', '', 250000)).toBe(1000000)
  })
})

describe('parseClaudeUsage', () => {
  const jsonl = [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } } }),
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
    'not json — skipped',
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 150000, cache_creation_input_tokens: 0 } } })
  ].join('\n')

  it('sums token fields, takes the last turn as context, and computes pct', () => {
    const m = parseClaudeUsage(jsonl)
    expect(m.input).toBe(220)
    expect(m.output).toBe(130)
    expect(m.cacheRead).toBe(151000)
    expect(m.cacheCreation).toBe(200)
    expect(m.contextTokens).toBe(150120)   // last assistant: 120 + 150000 + 0
    expect(m.contextWindow).toBe(200000)
    expect(m.contextPct).toBe(75)           // round(150120/200000*100)
  })
  it('returns all-zero for an empty/assistant-less transcript', () => {
    expect(parseClaudeUsage('')).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, contextTokens: 0, contextWindow: 200000, contextPct: 0 })
  })

  it('uses the 1M window when the alias marks a [1m] model', () => {
    const m = parseClaudeUsage(jsonl, 'opus[1m]')
    expect(m.contextTokens).toBe(150120)
    expect(m.contextWindow).toBe(1000000)
    expect(m.contextPct).toBe(15)   // round(150120/1000000*100)
  })

  it('auto-bumps the window to 1M when observed context exceeds 200k', () => {
    // A long session whose context exceeds 200k can only be a >200k window, even if
    // the alias is unknown — never report >100%.
    const big = JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 250000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
    const m = parseClaudeUsage(big)
    expect(m.contextTokens).toBe(250000)
    expect(m.contextWindow).toBe(1000000)
    expect(m.contextPct).toBe(25)
  })

  it('handles CRLF line endings (real Windows transcripts)', () => {
    const crlf = [
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } })
    ].join('\r\n')
    const m = parseClaudeUsage(crlf)
    expect(m.input).toBe(30)
    expect(m.output).toBe(12)
    expect(m.contextTokens).toBe(120)   // last turn: 20 + 100 + 0
  })

  it('treats missing/null token fields as 0', () => {
    const line = JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: null, cache_read_input_tokens: 50 } } })
    const m = parseClaudeUsage(line)
    expect(m.input).toBe(0)
    expect(m.output).toBe(0)
    expect(m.cacheRead).toBe(50)
    expect(m.cacheCreation).toBe(0)
    expect(m.contextTokens).toBe(50)
  })
})
