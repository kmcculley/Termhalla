import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DraftStore } from '../../src/main/persistence/draft-store'

const dirs: string[] = []
function tempDir(): string { const d = mkdtempSync(join(tmpdir(), 'ds-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('DraftStore', () => {
  it('returns {} when no file exists', async () => {
    const s = new DraftStore(tempDir())
    expect(await s.load()).toEqual({})
  })

  it('round-trips set then load (from a fresh store)', async () => {
    const dir = tempDir()
    const s = new DraftStore(dir)
    await s.load()
    s.set('p1::a.ts', { content: 'edited', baseline: 'base' })
    await wait(50)
    expect(await new DraftStore(dir).load()).toEqual({ 'p1::a.ts': { content: 'edited', baseline: 'base' } })
  })

  it('delete removes an entry', async () => {
    const dir = tempDir()
    const s = new DraftStore(dir)
    await s.load()
    s.set('p1::a.ts', { content: 'x', baseline: 'y' })
    await wait(50)
    s.delete('p1::a.ts')
    await wait(50)
    expect(await new DraftStore(dir).load()).toEqual({})
  })

  it('sanitizes malformed entries on load', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'editor-drafts.json'), JSON.stringify({
      good: { content: 'c', baseline: 'b' },
      bad1: { content: 'c' },              // missing baseline
      bad2: { content: 5, baseline: 'b' }, // wrong type
      bad3: 'nope'
    }), 'utf8')
    expect(await new DraftStore(dir).load()).toEqual({ good: { content: 'c', baseline: 'b' } })
  })

  it('flush writes the current map synchronously', () => {
    const dir = tempDir()
    const s = new DraftStore(dir)
    s.set('p1::a.ts', { content: 'c', baseline: 'b' })
    s.flush()
    expect(existsSync(join(dir, 'editor-drafts.json'))).toBe(true)
  })
})
