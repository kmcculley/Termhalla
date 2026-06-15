import { describe, it, expect } from 'vitest'
import { buildSshArgs, pushRecent, nextRecentDirs, buildPaletteItems, filterPaletteItems } from '@shared/quick'
import type { SshConnection } from '@shared/types'
import type { QuickStore } from '@shared/types'

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
    expect(pushRecent(['a', 'b', 'c'], 'c', 3)).toEqual(['c', 'a', 'b'])
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

const quick: QuickStore = {
  connections: [
    { id: 'c1', name: 'alpha', host: 'a.example', user: 'kev' },
    { id: 'c2', name: 'beta', host: 'b.example', user: 'kev', port: 2222 }
  ],
  recentConnections: ['c2'],
  favoriteDirs: ['C:\\proj'],
  recentDirs: ['C:\\proj', 'C:\\work'],
  templates: []
}

describe('buildPaletteItems', () => {
  it('orders recent connections first, then the rest', () => {
    const items = buildPaletteItems(quick, 'C:\\cwd')
    const conns = items.filter(i => i.kind === 'connection')
    expect(conns.map(i => (i as { id: string }).id)).toEqual(['c2', 'c1'])
  })
  it('lists favorite dirs, then recent dirs that are not already favorites', () => {
    const dirs = buildPaletteItems(quick, 'C:\\cwd').filter(i => i.kind === 'dir') as
      { path: string; favorite: boolean }[]
    expect(dirs).toEqual([
      { kind: 'dir', path: 'C:\\proj', favorite: true, search: 'c:\\proj' },
      { kind: 'dir', path: 'C:\\work', favorite: false, search: 'c:\\work' }
    ])
  })
  it('always offers New SSH connection, and Pin only when a cwd is known', () => {
    const withCwd = buildPaletteItems(quick, 'C:\\cwd').filter(i => i.kind === 'action')
    expect(withCwd.map(i => (i as { action: string }).action)).toEqual(['new-connection', 'pin-cwd'])
    const noCwd = buildPaletteItems(quick, '').filter(i => i.kind === 'action')
    expect(noCwd.map(i => (i as { action: string }).action)).toEqual(['new-connection'])
  })
})

describe('filterPaletteItems', () => {
  const items = buildPaletteItems(quick, 'C:\\cwd')
  it('returns everything for an empty query', () => {
    expect(filterPaletteItems(items, '   ')).toEqual(items)
  })
  it('substring-matches name/host/path case-insensitively', () => {
    expect(filterPaletteItems(items, 'beta').map(i => i.kind)).toEqual(['connection'])
    expect(filterPaletteItems(items, 'work').map(i => i.kind)).toEqual(['dir'])
    expect(filterPaletteItems(items, 'b.example').map(i => i.kind)).toEqual(['connection'])
  })
})
