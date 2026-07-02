// FROZEN contract suite — feature 0013-os-needs-you-notifications (phase 4 / TASK-006).
// REQ-009: the feature adds EXACTLY ONE new IPC channel — the main->renderer `orkyNotify:focus`
// (payload `string | null`) — and NO other IPC (the opt-in and its live-refresh reuse the existing
// quickLoad/quickSave handlers). The channel name MUST NOT start with `registry:` (that family is a
// frozen closed set — TEST-409 stays green precisely because this channel avoids the prefix) and its
// value MUST be unique across CH. The preload exposes exactly one new `on…` subscriber for it.
// Mirrors tests/shared/registry-ipc-contract.test.ts.
//
// Runs RED today: CH.orkyNotifyFocus is undefined and preload/index.ts bridges no onOrkyNotifyFocus.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CH } from '@shared/ipc-contract'

describe('feature 0013 — orkyNotify:focus channel (REQ-009)', () => {
  it('TEST-562 REQ-009 CH.orkyNotifyFocus === "orkyNotify:focus", is NOT in the registry:* family, and is unique across CH', () => {
    const ch = CH as Record<string, string>
    expect(ch.orkyNotifyFocus).toBe('orkyNotify:focus')
    expect(ch.orkyNotifyFocus.startsWith('registry:')).toBe(false)
    const values = Object.values(CH)
    expect(new Set(values).size).toBe(values.length)   // no duplicate channel string anywhere in CH
  })

  it('TEST-563 REQ-009 exactly ONE new orkyNotify:* channel is added; the preload exposes one new onOrkyNotifyFocus subscriber and the typed contract names it', () => {
    const ch = CH as Record<string, string>
    const family = Object.values(ch).filter(v => typeof v === 'string' && v.startsWith('orkyNotify:'))
    expect(family).toEqual(['orkyNotify:focus'])   // one and only one channel in the new family

    const preload = readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')
    expect(preload).toMatch(/onOrkyNotifyFocus:\s*pushChannel/)   // the onRegistryStatus template
    // it reuses the existing quick handlers — no new quick channel is introduced by the opt-in
    expect(preload).toContain('CH.quickSave')

    const contract = readFileSync(resolve(process.cwd(), 'src/shared/ipc-contract.ts'), 'utf8')
    expect(contract).toContain('orkyNotifyFocus')
    expect(contract).toContain('onOrkyNotifyFocus')
  })
})
