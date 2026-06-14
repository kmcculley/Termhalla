import { describe, it, expect } from 'vitest'
import {
  computeNeedsInput, looksLikePrompt,
  DEFAULT_NEEDS_INPUT_PATTERNS, type NeedsInputConfig
} from '../../src/main/status/needs-input'

const cfg = (over: Partial<NeedsInputConfig> = {}): NeedsInputConfig => ({
  enabled: true, quietMs: 10000, patterns: DEFAULT_NEEDS_INPUT_PATTERNS, heuristicIdleMs: 1500, ...over
})

describe('computeNeedsInput', () => {
  it('fires when quiet past threshold AND tail matches a y/N prompt', () => {
    expect(computeNeedsInput(11000, 'Overwrite? [y/N] ', cfg())).toBe(true)
  })
  it('fires on a password prompt', () => {
    expect(computeNeedsInput(12000, 'Enter password: ', cfg())).toBe(true)
  })
  it('does NOT fire before the quiet threshold (slow-but-chatty command)', () => {
    expect(computeNeedsInput(2000, 'Continue? [y/N] ', cfg())).toBe(false)
  })
  it('does NOT fire when the tail is just progress output', () => {
    expect(computeNeedsInput(15000, 'Building project... 42%', cfg())).toBe(false)
  })
  it('does NOT fire when disabled', () => {
    expect(computeNeedsInput(99000, 'Overwrite? [y/N] ', cfg({ enabled: false }))).toBe(false)
  })
  it('matches only the last line of the tail', () => {
    expect(computeNeedsInput(11000, 'compiled ok\nProceed? [y/N] ', cfg())).toBe(true)
    expect(computeNeedsInput(11000, 'Proceed? [y/N] \nnevermind, more logs', cfg())).toBe(false)
  })
})

describe('looksLikePrompt', () => {
  it('recognises a typical shell prompt tail', () => {
    expect(looksLikePrompt('PS C:\\Users\\kevin> ')).toBe(true)
    expect(looksLikePrompt('user@host:~$ ')).toBe(true)
  })
  it('rejects ordinary output', () => {
    expect(looksLikePrompt('still working on it')).toBe(false)
  })
})
