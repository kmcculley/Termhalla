import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuickStore } from '../../src/main/persistence/quick-store'
import { SCHEMA_VERSION } from '@shared/types'

/**
 * Feature 0001 — REQ-007 (persistence half).
 * `toastsEnabled` is an additive optional QuickStore field: it round-trips through
 * save/load and a legacy quick.json that predates it loads clean as effectively OFF.
 * (The toastsEnabled field itself did not bump SCHEMA_VERSION; later features may. TEST-008
 * pins the current SCHEMA_VERSION constant value.)
 */
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-quick-toast-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const base = {
  connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [],
  templates: [], themePresets: [],
}

describe('QuickStore — toastsEnabled (additive optional)', () => {
  it('TEST-006: round-trips toastsEnabled === true through save/load', async () => {
    const store = new QuickStore(dir)
    await store.save({ ...base, toastsEnabled: true } as any)
    expect((await store.load() as any).toastsEnabled).toBe(true)
  })

  it('TEST-007: a legacy quick.json without the field loads clean and is effectively OFF', async () => {
    // Pre-feature file: no toastsEnabled key at all.
    writeFileSync(join(dir, 'quick.json'), JSON.stringify(base), 'utf8')
    const store = new QuickStore(dir)
    const loaded = await store.load() as any
    // No throw, no migration, and the absent field reads as undefined => suppressed (default OFF).
    expect(loaded.toastsEnabled).toBeUndefined()
    expect(loaded.toastsEnabled === true).toBe(false)
  })

  // SUPERSEDED point-in-time pin (CONV-019): the file header already anticipated this ("later
  // features may [bump]; TEST-008 pins the current SCHEMA_VERSION constant value") — re-pinned
  // 7→8 by feature 0009-native-orky-pane (REQ-003, see 0009's 04-tests.md).
  it('TEST-008: SCHEMA_VERSION is the current persisted schema version (re-pinned at 8 by 0009 REQ-003)', () => {
    expect(SCHEMA_VERSION).toBe(8)
  })
})
