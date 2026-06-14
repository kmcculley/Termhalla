import { describe, it, expect } from 'vitest'
import { applyDirChange } from '../../src/renderer/components/explorer-tree'
import type { DirEntry } from '@shared/types'

const E = (name: string, isDir = false): DirEntry => ({ name, path: `/d/${name}`, isDir })

describe('applyDirChange', () => {
  const base: DirEntry[] = [E('sub', true), E('a.txt'), E('c.txt')]

  it('inserts an added file in dirs-first sorted position', () => {
    const out = applyDirChange(base, { event: 'add', path: '/d/b.txt' })
    expect(out.map(e => e.name)).toEqual(['sub', 'a.txt', 'b.txt', 'c.txt'])
    expect(out.find(e => e.name === 'b.txt')!.isDir).toBe(false)
  })
  it('inserts an added directory before files', () => {
    const out = applyDirChange(base, { event: 'addDir', path: '/d/aaa' })
    expect(out.map(e => e.name)).toEqual(['aaa', 'sub', 'a.txt', 'c.txt'])
    expect(out.find(e => e.name === 'aaa')!.isDir).toBe(true)
  })
  it('removes an unlinked file', () => {
    const out = applyDirChange(base, { event: 'unlink', path: '/d/a.txt' })
    expect(out.map(e => e.name)).toEqual(['sub', 'c.txt'])
  })
  it('removes an unlinked directory', () => {
    const out = applyDirChange(base, { event: 'unlinkDir', path: '/d/sub' })
    expect(out.map(e => e.name)).toEqual(['a.txt', 'c.txt'])
  })
  it('ignores a plain change event (content only)', () => {
    expect(applyDirChange(base, { event: 'change', path: '/d/a.txt' })).toEqual(base)
  })
  it('is idempotent for a duplicate add', () => {
    const once = applyDirChange(base, { event: 'add', path: '/d/b.txt' })
    expect(applyDirChange(once, { event: 'add', path: '/d/b.txt' })).toEqual(once)
  })
})
