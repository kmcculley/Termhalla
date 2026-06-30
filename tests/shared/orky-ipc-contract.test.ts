// FROZEN unit suite — feature 0004-orky-status-awareness (phase 4 / REQ-013 IPC contract).
// The feature MUST add an `orky:status` main→renderer push channel plus `orky:watch`/`orky:unwatch`
// renderer→main channels to the typed contract, following the existing CH naming convention
// (`domain:verb`). Mirrors the style of tests/shared/open-settings-channel.test.ts.
//
// Runs RED today: `CH.orkyStatus`/`CH.orkyWatch`/`CH.orkyUnwatch` are not on the contract yet
// (they read as undefined → the assertions fail). The file itself imports fine (ipc-contract exists).
import { describe, it, expect } from 'vitest'
import { CH } from '@shared/ipc-contract'

describe('Orky IPC channels (REQ-013)', () => {
  it('TEST-024 REQ-013 declares orky:status (push) + orky:watch / orky:unwatch (commands), domain:verb named', () => {
    expect((CH as Record<string, string>).orkyStatus).toBe('orky:status')
    expect((CH as Record<string, string>).orkyWatch).toBe('orky:watch')
    expect((CH as Record<string, string>).orkyUnwatch).toBe('orky:unwatch')
  })
})
