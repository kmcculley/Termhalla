import { describe, it, expect } from 'vitest'
import { encryptJSON, decryptJSON } from '../../src/main/env-vault/crypto'

describe('env crypto', () => {
  it('round-trips data with the right passphrase', () => {
    const blob = encryptJSON({ a: 1, s: 'secret' }, 'pw')
    expect(decryptJSON(blob, 'pw')).toEqual({ a: 1, s: 'secret' })
  })
  it('throws on a wrong passphrase', () => {
    const blob = encryptJSON({ x: 1 }, 'right')
    expect(() => decryptJSON(blob, 'wrong')).toThrow()
  })
  it('throws on tampered ciphertext', () => {
    const blob = encryptJSON({ x: 1 }, 'pw')
    const bad = { ...blob, ct: Buffer.from('garbage').toString('base64') }
    expect(() => decryptJSON(bad, 'pw')).toThrow()
  })
  it('throws on a tampered auth tag', () => {
    const blob = encryptJSON({ x: 1 }, 'pw')
    const bad = { ...blob, tag: Buffer.from('0'.repeat(16)).toString('base64') }
    expect(() => decryptJSON(bad, 'pw')).toThrow()
  })
})
