// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// Desktop-side surfaces, structural (the repo's *-structure.test.ts discipline): REQ-002 (the
// LAN plaintext-transport warning renders only in LAN mode), REQ-007 (QR pairing + the
// regenerate-with-disclosure path), REQ-020 (errors ride the toast chokepoint with the
// error severity that bypasses the quick.toastsEnabled opt-in), and the ipc-contract channels
// the spec's public interface names.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8')

describe('TEST-2685 REQ-002/REQ-007 PhoneRemoteSettings: LAN warning, QR pairing, regenerate', () => {
  it('renders a plaintext-transport warning gated on LAN mode', () => {
    const src = read('src/renderer/components/PhoneRemoteSettings.tsx')
    expect(src).toMatch(/plaintext|unencrypted|not encrypted/i)
    expect(src, "the warning must be conditional on the 'lan' bind mode").toMatch(/['"]lan['"]/)
  })

  it('renders a QR code of the pairing URL and a Regenerate action with the re-pair disclosure', () => {
    const src = read('src/renderer/components/PhoneRemoteSettings.tsx')
    expect(src).toMatch(/qr/i)
    expect(src).toMatch(/[Rr]egenerate/)
    expect(src, 'regenerating must disclose that paired devices need to re-scan/re-pair').toMatch(/re-?scan|re-?pair/i)
  })

  it('after a restart the UI offers regenerate instead of a stale QR (tokenAvailableThisSession)', () => {
    const src = read('src/renderer/components/PhoneRemoteSettings.tsx')
    expect(src).toMatch(/tokenAvailableThisSession/)
  })
})

describe('TEST-2686 REQ-020/REQ-007 store slice + IPC contract plumbing', () => {
  it('the slice surfaces failures through the toast chokepoint with the error severity', () => {
    const src = read('src/renderer/store/phone-remote-slice.ts')
    expect(src).toMatch(/pushToast/)
    expect(src, 'errors must use the severity that bypasses quick.toastsEnabled (CONV-004)').toMatch(/['"]error['"]/)
  })

  it('ipc-contract.ts carries the phoneRemote domain channels (baseline REQ-002 discipline)', () => {
    const src = read('src/shared/ipc-contract.ts')
    for (const ch of [
      'phoneRemote:status',
      'phoneRemote:setEnabled',
      'phoneRemote:setBind',
      'phoneRemote:setPort',
      'phoneRemote:regenerateToken',
      'phoneRemote:changed'
    ]) {
      expect(src, `ipc-contract must declare '${ch}'`).toContain(ch)
    }
  })

  it('the per-domain registrar exists and is composed through the thin register.ts root', () => {
    expect(read('src/main/ipc/register-phone-remote.ts').length).toBeGreaterThan(0)
    expect(read('src/main/ipc/register.ts')).toMatch(/register-phone-remote|registerPhoneRemote/)
  })
})
