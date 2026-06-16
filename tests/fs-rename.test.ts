import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renamePath } from '../src/main/fs/files'

describe('renamePath', () => {
  it('renames a file in place', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rn-'))
    const a = join(d, 'a.txt'); const b = join(d, 'b.txt')
    writeFileSync(a, 'hi', 'utf8')
    await renamePath(a, b)
    expect(existsSync(a)).toBe(false)
    expect(readFileSync(b, 'utf8')).toBe('hi')
  })

  it('rejects when the source is missing', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rn2-'))
    await expect(renamePath(join(d, 'nope.txt'), join(d, 'x.txt'))).rejects.toBeTruthy()
  })
})
