import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnvVault, parseVaultData, UNLOCK_BACKOFF_BASE_MS } from '../../src/main/env-vault/env-vault'

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
    // Re-open from disk and unlock. (Advance the injected clock past the post-failure backoff.)
    const v2 = new EnvVault(dir)
    expect(v2.exists()).toBe(true)
    expect(v2.unlock('wrong', 1000)).toBe(false)
    expect(v2.isUnlocked()).toBe(false)
    expect(v2.unlock('pw', 1000 + UNLOCK_BACKOFF_BASE_MS * 4)).toBe(true)
    expect(v2.envFor('t1')).toEqual({ FOO: 'override', BAZ: 'qux' })
  })
  it('envFor is empty while locked', () => {
    const v = new EnvVault(tmp())
    expect(v.envFor()).toEqual({})
  })
  it('propagates a write failure instead of silently swallowing it', () => {
    // Point the vault at a path that is a file, not a directory, so the persist mkdir/write throws.
    // A swallowed error would let create() return normally and the UI would toast a false success.
    const dir = tmp()
    const occupied = join(dir, 'occupied')
    writeFileSync(occupied, 'x')
    const v = new EnvVault(occupied)
    expect(() => v.create('pw')).toThrow()
  })
  it('rejects a correct passphrase while inside the failure backoff window', () => {
    const dir = tmp()
    new EnvVault(dir).create('pw')
    const v = new EnvVault(dir)
    expect(v.unlock('wrong', 1000)).toBe(false)   // arms backoff (until 1000 + 2000)
    expect(v.unlock('pw', 1500)).toBe(false)       // correct, but still throttled
    expect(v.unlock('pw', 5000)).toBe(true)        // past backoff -> succeeds
  })
})

describe('parseVaultData', () => {
  it('accepts a well-formed payload (with or without a version)', () => {
    expect(parseVaultData({ global: { A: '1' }, terminals: { t: { B: '2' } } }))
      .toEqual({ global: { A: '1' }, terminals: { t: { B: '2' } } })
    expect(parseVaultData({ version: 1, global: {}, terminals: {} }))
      .toEqual({ global: {}, terminals: {} })
  })
  it('defaults absent fields to empty maps', () => {
    expect(parseVaultData({})).toEqual({ global: {}, terminals: {} })
  })
  it('rejects (does not coerce) present-but-malformed fields', () => {
    expect(parseVaultData({ global: ['nope'], terminals: {} })).toBeNull()
    expect(parseVaultData({ global: { A: 5 }, terminals: {} })).toBeNull()
    expect(parseVaultData({ global: {}, terminals: { t: { B: 5 } } })).toBeNull()
    expect(parseVaultData(null)).toBeNull()
  })
  it('rejects a payload newer than the supported version', () => {
    expect(parseVaultData({ version: 99, global: {}, terminals: {} })).toBeNull()
  })
})
