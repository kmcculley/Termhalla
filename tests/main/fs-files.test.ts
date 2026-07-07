import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fsp from 'node:fs/promises'
import {
  readTextFile, writeTextFile, readDirectory, statPath, sortEntries, isBinary
} from '../../src/main/fs/files'
import type { AtomicFs } from '../../src/main/persistence/atomic-write'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-fs-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('files', () => {
  it('writes and reads back text', async () => {
    const f = join(dir, 'a.txt')
    await writeTextFile(f, 'hello')
    expect((await readTextFile(f)).content).toBe('hello')
  })
  it('flags files over the size cap as tooLarge without reading content', async () => {
    const f = join(dir, 'big.txt'); writeFileSync(f, 'abcdefghij') // 10 bytes
    const r = await readTextFile(f, 5) // cap 5
    expect(r).toEqual({ content: '', tooLarge: true })
  })
  it('rejects binary files', async () => {
    const f = join(dir, 'bin'); writeFileSync(f, Buffer.from([0x41, 0x00, 0x42]))
    await expect(readTextFile(f)).rejects.toThrow()
  })
  it('lists a directory dirs-first, alphabetical', async () => {
    writeFileSync(join(dir, 'b.txt'), '')
    writeFileSync(join(dir, 'a.txt'), '')
    mkdirSync(join(dir, 'zsub'))
    const entries = await readDirectory(dir)
    expect(entries.map(e => e.name)).toEqual(['zsub', 'a.txt', 'b.txt'])
    expect(entries[0].isDir).toBe(true)
  })
  it('stats a path', async () => {
    const f = join(dir, 'a.txt'); await writeTextFile(f, 'xy')
    const s = await statPath(f)
    expect(s.size).toBe(2); expect(s.isDir).toBe(false)
  })
  // 2026-07-06 quality audit (borderline finding): editor save was the app's ONE non-atomic
  // durable write — plain writeFile truncates the target before writing, so an app kill mid-save
  // leaves the user's source file truncated (the exact scenario atomic-write.ts documents).
  it('a failed save never truncates the existing file (routes through the atomic temp+rename)', async () => {
    const f = join(dir, 'a.txt')
    await writeTextFile(f, 'original')
    const failing: AtomicFs = {
      mkdir: fsp.mkdir, writeFile: fsp.writeFile, rm: fsp.rm,
      rename: async () => { throw new Error('injected rename failure') }
    }
    await expect(writeTextFile(f, 'replacement', failing)).rejects.toThrow('injected rename failure')
    expect((await readTextFile(f)).content).toBe('original')
    // and no temp litter survives the failure
    expect((await readDirectory(dir)).map(e => e.name)).toEqual(['a.txt'])
  })
  it('sortEntries puts dirs first then alphabetical (pure)', () => {
    const out = sortEntries([
      { name: 'b', path: 'b', isDir: false },
      { name: 'a', path: 'a', isDir: false },
      { name: 'dir', path: 'dir', isDir: true }
    ])
    expect(out.map(e => e.name)).toEqual(['dir', 'a', 'b'])
  })
  it('isBinary detects NUL bytes', () => {
    expect(isBinary(Buffer.from('text'))).toBe(false)
    expect(isBinary(Buffer.from([0x41, 0x00]))).toBe(true)
  })
})
