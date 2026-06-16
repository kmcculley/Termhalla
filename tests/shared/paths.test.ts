import { describe, it, expect } from 'vitest'
import { basename } from '@shared/paths'

describe('basename', () => {
  it('returns the last segment for both separators', () => {
    expect(basename('C:\\a\\b.ts')).toBe('b.ts')
    expect(basename('/usr/local/bin')).toBe('bin')
  })
  it('ignores trailing slashes', () => {
    expect(basename('C:\\a\\b\\')).toBe('b')
    expect(basename('/usr/local/')).toBe('local')
  })
  it('returns the input when there is no separator', () => {
    expect(basename('b.ts')).toBe('b.ts')
  })
  it('returns empty for an empty string', () => {
    expect(basename('')).toBe('')
  })
})
