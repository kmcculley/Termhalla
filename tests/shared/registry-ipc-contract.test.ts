// FROZEN unit suite — feature 0005-cross-project-orky-registry (phase 4 / REQ-022 IPC contract, TASK-010).
// The feature MUST add a `registry:status` main->renderer push channel plus `registry:current` /
// `registry:roots` / `registry:addRoot` / `registry:removeRoot` renderer->main channels to the typed
// contract, exactly named per the FROZEN spec (`domain:verb`). Mirrors the style of
// tests/shared/orky-ipc-contract.test.ts.
//
// Runs RED today: `CH.registryStatus`/`registryCurrent`/`registryRoots`/`registryAddRoot`/
// `registryRemoveRoot` are not on the contract yet (read as undefined -> the assertions fail). The file
// itself imports fine (ipc-contract.ts exists).
import { describe, it, expect } from 'vitest'
import { CH } from '@shared/ipc-contract'

describe('Registry IPC channels (REQ-022)', () => {
  it('TEST-068 REQ-022 declares the exact registry:* channel names (status push + current/roots/addRoot/removeRoot pulls)', () => {
    const ch = CH as Record<string, string>
    expect(ch.registryStatus).toBe('registry:status')
    expect(ch.registryCurrent).toBe('registry:current')
    expect(ch.registryRoots).toBe('registry:roots')
    expect(ch.registryAddRoot).toBe('registry:addRoot')
    expect(ch.registryRemoveRoot).toBe('registry:removeRoot')
  })

  it('TEST-069 REQ-022 every registry channel name is unique and does not collide with any existing CH value', () => {
    const values = Object.values(CH as Record<string, string>)
    const registryValues = values.filter(v => v.startsWith('registry:'))
    expect(registryValues.length).toBe(5)
    expect(new Set(values).size).toBe(values.length) // no duplicate channel string anywhere in CH
  })
})
