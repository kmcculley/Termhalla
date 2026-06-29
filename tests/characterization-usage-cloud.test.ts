// Characterization tests pin the behavior the system had at baseline. They are a CHANGE-DETECTOR, not a
// correctness oracle: a failure means behavior CHANGED — a human adjudicates whether that is an intended
// change (update the test) or a regression (fix the code). Captured by /orky:discover; do not hand-edit.
//
// Subsystem: Claude usage metrics (src/main/usage/parse-usage.ts) and cloud CLI status
// (src/main/cloud/classify.ts, src/shared/group-cloud.ts).
import { describe, it, expect } from 'vitest'
import { windowFor, computeContextWindow, parseClaudeUsage } from '../src/main/usage/parse-usage'
import { classifyProbe } from '../src/main/cloud/classify'
import type { CloudProvider } from '../src/main/cloud/providers'
import { groupCloudStatuses } from '@shared/group-cloud'
import type { CloudStatus } from '@shared/types'

describe('CHAR-009 usage: context-window selection', () => {
  it('windowFor is 1M for [1m] model or alias, else 200k', () => {
    expect(windowFor('claude-opus-4-8')).toBe(200000)
    expect(windowFor('claude-opus-4-8', 'opus[1m]')).toBe(1_000_000)
    expect(windowFor('claude-opus-4-8[1m]')).toBe(1_000_000)
  })
  it('computeContextWindow auto-bumps to 1M when observed context already exceeds 200k', () => {
    expect(computeContextWindow('unknown', '', 150000)).toBe(200000)
    expect(computeContextWindow('unknown', '', 300000)).toBe(1_000_000)
  })
})

describe('CHAR-010 usage: parseClaudeUsage over a transcript', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } }),
    'not valid json',
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 200, output_tokens: 60, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 } } })
  ].join('\n')
  it('sums token usage across assistant turns; context is the last turn input-side total', () => {
    expect(parseClaudeUsage(jsonl)).toEqual({
      input: 300, output: 110, cacheRead: 30, cacheCreation: 5,
      contextTokens: 220, contextWindow: 200000, contextPct: 0
    })
  })
  it('returns all-zero metrics for empty input', () => {
    expect(parseClaudeUsage('')).toEqual({
      input: 0, output: 0, cacheRead: 0, cacheCreation: 0,
      contextTokens: 0, contextWindow: 200000, contextPct: 0
    })
  })
})

describe('CHAR-011 cloud: classifyProbe maps a probe outcome to a status', () => {
  const provider: CloudProvider = {
    id: 'aws:default', label: 'AWS', bin: 'aws', family: 'aws', profile: 'default', probeArgs: [],
    parse: (stdout) => ({ account: (JSON.parse(stdout) as { Account: string }).Account, detail: {} }),
    login: { command: 'aws', args: ['sso', 'login'], title: 'aws sso login' }
  }
  it('ENOENT spawn failure => not-installed', () => {
    expect(classifyProbe(provider, { errorCode: 'ENOENT', stdout: '' }, 123).state).toBe('not-installed')
  })
  it('other spawn failure => error', () => {
    expect(classifyProbe(provider, { errorCode: 'ETIMEDOUT', stdout: '' }, 123).state).toBe('error')
  })
  it('non-zero exit => logged-out', () => {
    expect(classifyProbe(provider, { code: 1, stdout: '' }, 123).state).toBe('logged-out')
  })
  it('exit 0 with parseable output => logged-in with account & carried base fields', () => {
    const s = classifyProbe(provider, { code: 0, stdout: '{"Account":"12345"}' }, 123)
    expect(s).toMatchObject({ id: 'aws:default', label: 'AWS', family: 'aws', profile: 'default', state: 'logged-in', account: '12345', checkedAt: 123 })
  })
  it('exit 0 with unparseable output => error (format drift)', () => {
    expect(classifyProbe(provider, { code: 0, stdout: 'not json' }, 123).state).toBe('error')
  })
})

describe('CHAR-012 cloud: groupCloudStatuses collapses members per family', () => {
  const base = { checkedAt: 0 }
  const statuses: CloudStatus[] = [
    { ...base, id: 'aws:default', label: 'AWS', family: 'aws', state: 'logged-in' },
    { ...base, id: 'aws:prod', label: 'AWS', family: 'aws', state: 'logged-out' },
    { ...base, id: 'azure', label: 'Azure', family: 'azure', state: 'not-installed' }
  ]
  it('groups by family in first-seen order with an aggregated summary state', () => {
    const groups = groupCloudStatuses(statuses)
    expect(groups.map(g => g.family)).toEqual(['aws', 'azure'])
    const aws = groups[0]
    expect(aws).toMatchObject({ label: 'AWS', summary: 'logged-in', loggedIn: 1, total: 2 })
    expect(groups[1]).toMatchObject({ family: 'azure', summary: 'not-installed', loggedIn: 0, total: 1 })
  })
})
