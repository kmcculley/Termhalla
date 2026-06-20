import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWrite, atomicWriteSync, type AtomicFs } from '../../src/main/persistence/atomic-write'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-atomic-')) })
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }) })

/** Real fs ops with `rename` swapped for one that fails — simulates a process kill at the commit
 *  step. A plain Error (no errno code) is non-transient, so it is not retried. */
function failingCommitFs(): AtomicFs {
  return {
    mkdir: fsp.mkdir, writeFile: fsp.writeFile, rm: fsp.rm,
    rename: () => Promise.reject(new Error('killed mid-commit')),
  }
}

describe('atomicWrite', () => {
  it('writes content to a new file, creating the parent directory', async () => {
    const file = join(dir, 'nested', 'data.json')
    await atomicWrite(file, '{"a":1}')
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}')
  })

  it('overwrites a longer existing file completely', async () => {
    const file = join(dir, 'data.json')
    writeFileSync(file, 'OLD-AND-LONGER-CONTENT', 'utf8')
    await atomicWrite(file, 'new')
    expect(readFileSync(file, 'utf8')).toBe('new')
  })

  it('leaves no temp residue after a successful write', async () => {
    const file = join(dir, 'data.json')
    await atomicWrite(file, 'x')
    expect(readdirSync(dir)).toEqual(['data.json'])
  })

  it('preserves the existing file when the rename commit fails (the crash-safety guarantee)', async () => {
    const file = join(dir, 'data.json')
    writeFileSync(file, 'GOOD', 'utf8')
    await expect(atomicWrite(file, 'PARTIAL', failingCommitFs())).rejects.toThrow('killed mid-commit')
    // The original good file is never truncated — it is untouched.
    expect(readFileSync(file, 'utf8')).toBe('GOOD')
  })

  it('cleans up the temp file when the commit fails', async () => {
    const file = join(dir, 'data.json')
    writeFileSync(file, 'GOOD', 'utf8')
    await expect(atomicWrite(file, 'PARTIAL', failingCommitFs())).rejects.toThrow()
    expect(readdirSync(dir)).toEqual(['data.json'])
  })

  it('handles concurrent writes to the same file without corruption', async () => {
    const file = join(dir, 'data.json')
    await Promise.all([
      atomicWrite(file, JSON.stringify({ n: 1 })),
      atomicWrite(file, JSON.stringify({ n: 2 })),
      atomicWrite(file, JSON.stringify({ n: 3 })),
    ])
    // Must be one writer's complete output — valid JSON, never interleaved/truncated.
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect([1, 2, 3]).toContain(parsed.n)
    expect(readdirSync(dir)).toEqual(['data.json'])
  })
})

describe('atomicWriteSync', () => {
  it('writes content, creating the parent directory', () => {
    const file = join(dir, 'nested', 'notes.json')
    atomicWriteSync(file, '{"k":"v"}')
    expect(readFileSync(file, 'utf8')).toBe('{"k":"v"}')
  })

  it('leaves no temp residue after a successful write', () => {
    const file = join(dir, 'notes.json')
    atomicWriteSync(file, 'x')
    expect(readdirSync(dir)).toEqual(['notes.json'])
  })
})
