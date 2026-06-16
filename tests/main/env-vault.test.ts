import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnvVault } from '../../src/main/env-vault/env-vault'

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'env-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('EnvVault', () => {
  it('create → setGlobal → envFor; persists and re-unlocks', () => {
    const dir = tmp()
    const v = new EnvVault(dir)
    expect(v.exists()).toBe(false)
    v.create('pw'); expect(v.isUnlocked()).toBe(true)
    v.setGlobal('FOO', 'bar')
    v.setTerminal('t1', 'FOO', 'override')
    v.setTerminal('t1', 'BAZ', 'qux')
    expect(v.envFor()).toEqual({ FOO: 'bar' })
    expect(v.envFor('t1')).toEqual({ FOO: 'override', BAZ: 'qux' })
    // Re-open from disk and unlock.
    const v2 = new EnvVault(dir)
    expect(v2.exists()).toBe(true)
    expect(v2.unlock('wrong')).toBe(false)
    expect(v2.isUnlocked()).toBe(false)
    expect(v2.unlock('pw')).toBe(true)
    expect(v2.envFor('t1')).toEqual({ FOO: 'override', BAZ: 'qux' })
  })
  it('envFor is empty while locked', () => {
    const v = new EnvVault(tmp())
    expect(v.envFor()).toEqual({})
  })
})
