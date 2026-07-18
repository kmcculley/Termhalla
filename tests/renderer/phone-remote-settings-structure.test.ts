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

// ---------------------------------------------------------------------------------------------
// v2 loopback amendments (ESC-001; FINDING-010/024/034/043/046/039/044/045) — REQ-029 the
// settings surface is ACTUALLY mounted (an unmounted component satisfies every isolated source
// scan — so these pins target the REAL mount wiring: SettingsPanel's section list + render
// switch; the interactive navigation half is the mandated e2e, TEST-2730), REQ-020 the error
// push is consumed at the APP ROOT (component-independent), REQ-031 pairing reachability UI.

describe('TEST-2716 REQ-029 the phone-remote section is wired into the REAL Settings mount path', () => {
  it('SettingsSection carries the phoneRemote variant', () => {
    const src = read('src/renderer/store/types.ts')
    expect(src).toMatch(/phoneRemote/)
  })

  it('SettingsPanel lists the section AND renders PhoneRemoteSettings for it (the mount, not the component)', () => {
    const src = read('src/renderer/components/SettingsPanel.tsx')
    expect(src, 'the SECTIONS nav must contain the phone-remote section').toMatch(/['"]phoneRemote['"]/)
    expect(src, 'selecting the section must render the surface').toMatch(/<PhoneRemoteSettings/)
    expect(src).toMatch(/import .*PhoneRemoteSettings/)
  })
})

describe('TEST-2717 REQ-029/REQ-020 the surface is stateful: not-running cue, last error, port validation', () => {
  it('shows a not-running cue plus the specific status() error text when enabled but not running', () => {
    const src = read('src/renderer/components/PhoneRemoteSettings.tsx')
    expect(src, 'the enabled-but-stopped state needs a visible cue').toMatch(/not running|stopped|failed to start/i)
    expect(src, 'the specific last error from status() must render').toMatch(/status\(\)|\.error/)
  })

  it('invalid port entry surfaces a specific validation message naming the allowed range (CONV-001)', () => {
    const src = read('src/renderer/components/PhoneRemoteSettings.tsx')
    expect(src, 'the 1-65535 range must be disclosed, never a silent discard').toMatch(/65535/)
    expect(src).toMatch(/invalid|valid port|between/i)
  })
})

describe('TEST-2718 REQ-020 enable failures ride an app-wide, always-subscribed path (FINDING-034)', () => {
  it('the ROOT (App.tsx) consumes the phone-remote error push into the toast chokepoint — not a Settings mount effect', () => {
    const src = read('src/renderer/App.tsx')
    expect(src, 'App.tsx must subscribe the phoneRemote error push at the root').toMatch(/[Pp]honeRemoteError/)
    expect(src, 'the root consumer must feed the store toast chokepoint (error severity bypasses the opt-in)').toMatch(/[Tt]oast/)
  })

  it('ipc-contract declares the v2 channels: the app-wide error push, pairingUrl, setExternalHost', () => {
    const src = read('src/shared/ipc-contract.ts')
    for (const ch of ['phoneRemote:error', 'phoneRemote:pairingUrl', 'phoneRemote:setExternalHost']) {
      expect(src, `ipc-contract must declare '${ch}'`).toContain(ch)
    }
  })

  it('the renderer api surface exposes the error-push subscription', () => {
    const src = read('src/renderer/api.ts')
    expect(src).toMatch(/[Pp]honeRemote/)
  })
})

describe('TEST-2719 REQ-031 pairing is reachable and copyable', () => {
  it('renders the pairing URL as selectable/copyable text alongside the QR', () => {
    const src = read('src/renderer/components/PhoneRemoteSettings.tsx')
    expect(src, 'a copyable pairing-URL text node must exist whenever the QR renders').toMatch(/copy|select/i)
    expect(src).toMatch(/pairingUrl/)
  })

  it('accepts the externalHost override and discloses localhost-bind reachability', () => {
    const src = read('src/renderer/components/PhoneRemoteSettings.tsx')
    expect(src, 'the externalHost field (tailscale serve hostname) must be editable').toMatch(/externalHost/)
    expect(src, 'with no override in localhost bind, disclose the QR is only phone-reachable via LAN/external host').toMatch(/reachab|LAN mode|external host/i)
  })
})
