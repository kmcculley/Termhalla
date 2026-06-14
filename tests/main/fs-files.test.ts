import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readTextFile, writeTextFile, readDirectory, statPath, sortEntries, isBinary
} from '../../src/main/fs/files'

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
