import { describe, it, expect } from 'vitest'
import { buildSshArgs, pushRecent, nextRecentDirs } from '@shared/quick'
import type { SshConnection } from '@shared/types'

const base: SshConnection = { id: 'c1', name: 'box', host: 'example.com', user: 'kev' }

describe('buildSshArgs', () => {
  it('omits port when default (22) and identity when unset', () => {
    expect(buildSshArgs(base)).toEqual(['kev@example.com'])
    expect(buildSshArgs({ ...base, port: 22 })).toEqual(['kev@example.com'])
  })
  it('adds -p for a non-default port', () => {
    expect(buildSshArgs({ ...base, port: 2222 })).toEqual(['-p', '2222', 'kev@example.com'])
  })
  it('adds -i for an identity file', () => {
    expect(buildSshArgs({ ...base, identityFile: 'C:\\keys\\id' }))
      .toEqual(['-i', 'C:\\keys\\id', 'kev@example.com'])
  })
  it('orders port before identity before target', () => {
    expect(buildSshArgs({ ...base, port: 2200, identityFile: 'k' }))
      .toEqual(['-p', '2200', '-i', 'k', 'kev@example.com'])
  })
})

describe('pushRecent', () => {
  it('prepends, de-dupes to front, and caps', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b', 5)).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
})

describe('nextRecentDirs', () => {
  const home = 'C:\\Users\\kev'
  it('prepends a visited dir and de-dupes case-insensitively', () => {
    expect(nextRecentDirs(['C:\\a'], 'C:\\B', home)).toEqual(['C:\\B', 'C:\\a'])
    expect(nextRecentDirs(['C:\\a', 'C:\\b'], 'c:\\A', home)).toEqual(['c:\\A', 'C:\\b'])
  })
  it('skips the home directory (trailing-slash/case insensitive)', () => {
    expect(nextRecentDirs(['C:\\a'], 'C:\\Users\\kev\\', home)).toEqual(['C:\\a'])
  })
  it('ignores an empty dir and respects the cap', () => {
    expect(nextRecentDirs(['x'], '', home)).toEqual(['x'])
    expect(nextRecentDirs(['a', 'b'], 'c', home, 2)).toEqual(['c', 'a'])
  })
})
