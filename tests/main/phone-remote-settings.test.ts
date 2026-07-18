// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// REQ-003: settings persist in quick.json as ONE additive optional object field, coerced by the
// quick-store's normalize discipline on read AND write; no SCHEMA_VERSION bump (quick.json is
// outside the migration chain). Contract set here for the implementer:
//   src/shared/phone-remote/settings.ts exports
//     PHONE_REMOTE_PORT_DEFAULT = 8199
//     normalizePhoneRemote(value: unknown): PhoneRemoteSettings | undefined
//   where PhoneRemoteSettings = { enabled: boolean; bind: 'localhost' | 'lan'; port: number;
//   tokenHash?: string }. A non-object value coerces to ABSENT (= feature off); a field-wise
//   invalid value coerces per-field (enabled -> false, bind -> 'localhost', port -> default,
//   tokenHash -> absent unless a string).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { QuickStore } from '../../src/main/persistence/quick-store'
import { EMPTY_QUICK, type QuickStore as QuickData } from '@shared/types'
import { normalizePhoneRemote, PHONE_REMOTE_PORT_DEFAULT } from '../../src/shared/phone-remote/settings'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-phone-quick-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('TEST-2601 REQ-003 normalizePhoneRemote coercion', () => {
  it('exports the default port as a named constant', () => {
    expect(PHONE_REMOTE_PORT_DEFAULT).toBe(8199)
  })

  it('coerces a non-object to absent (= feature off)', () => {
    expect(normalizePhoneRemote(undefined)).toBeUndefined()
    expect(normalizePhoneRemote(null)).toBeUndefined()
    expect(normalizePhoneRemote('junk')).toBeUndefined()
    expect(normalizePhoneRemote(42)).toBeUndefined()
    expect(normalizePhoneRemote([1, 2])).toBeUndefined()
  })

  it('coerces field-wise invalid values to the safe value', () => {
    // enabled must be strictly boolean true to be on
    expect(normalizePhoneRemote({ enabled: 'yes' })).toEqual({ enabled: false, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT })
    // port must be a valid TCP port; -1 / out-of-range / non-number coerce to the default
    expect(normalizePhoneRemote({ enabled: true, port: -1 })).toEqual({ enabled: true, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT })
    expect(normalizePhoneRemote({ enabled: true, port: 70000 })).toEqual({ enabled: true, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT })
    expect(normalizePhoneRemote({ enabled: true, port: '8199' })).toEqual({ enabled: true, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT })
    // bind must be exactly 'localhost' | 'lan'
    expect(normalizePhoneRemote({ enabled: true, bind: 'wan' })).toEqual({ enabled: true, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT })
    // tokenHash kept only when a string
    expect(normalizePhoneRemote({ enabled: true, tokenHash: 42 })).toEqual({ enabled: true, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT })
  })

  it('round-trips a valid object unchanged (tokenHash included)', () => {
    const valid = { enabled: true, bind: 'lan' as const, port: 9000, tokenHash: 'abc123' }
    expect(normalizePhoneRemote(valid)).toEqual(valid)
    const noToken = { enabled: false, bind: 'localhost' as const, port: 8199 }
    expect(normalizePhoneRemote(noToken)).toEqual(noToken)
  })
})

describe('TEST-2602 REQ-003 quick.json persistence discipline', () => {
  it('a legacy quick.json without the field loads with the feature off', async () => {
    writeFileSync(join(dir, 'quick.json'), JSON.stringify({ ...EMPTY_QUICK }))
    const store = new QuickStore(dir)
    expect((await store.load()).phoneRemote).toBeUndefined()
  })

  it('junk phoneRemote in the file coerces to absent on read', async () => {
    writeFileSync(join(dir, 'quick.json'), JSON.stringify({ ...EMPTY_QUICK, phoneRemote: 'junk' }))
    const store = new QuickStore(dir)
    expect((await store.load()).phoneRemote).toBeUndefined()
  })

  it('a valid phoneRemote object round-trips through save/load', async () => {
    const store = new QuickStore(dir)
    const phoneRemote = { enabled: true, bind: 'localhost' as const, port: 8199, tokenHash: 'deadbeef' }
    await store.save({ ...EMPTY_QUICK, phoneRemote } as QuickData)
    expect((await store.load()).phoneRemote).toEqual(phoneRemote)
  })

  it('a field-wise invalid phoneRemote is coerced on WRITE too (untrusted renderer payload)', async () => {
    const store = new QuickStore(dir)
    await store.save({ ...EMPTY_QUICK, phoneRemote: { enabled: true, bind: 'wan', port: -1 } } as unknown as QuickData)
    expect((await store.load()).phoneRemote).toEqual({ enabled: true, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT })
  })
})

describe('TEST-2603 REQ-003 no SCHEMA_VERSION coupling (CONV-022: pin the feature invariant)', () => {
  it('the phone-remote settings module and quick-store never touch SCHEMA_VERSION', () => {
    // quick.json is outside the migration chain: this feature must not couple its settings
    // to the versioned-persistence machinery.
    const root = process.cwd()
    for (const rel of ['src/shared/phone-remote/settings.ts', 'src/main/persistence/quick-store.ts']) {
      const src = readFileSync(resolve(root, rel), 'utf8')
      expect(src, `${rel} must not reference SCHEMA_VERSION`).not.toMatch(/SCHEMA_VERSION/)
    }
  })
})
