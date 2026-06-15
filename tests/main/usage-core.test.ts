import { describe, it, expect } from 'vitest'
import { encodeProjectDir, pickNewestTranscript } from '../../src/main/usage/project-dir'
import { windowFor, parseClaudeUsage } from '../../src/main/usage/parse-usage'

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
})
