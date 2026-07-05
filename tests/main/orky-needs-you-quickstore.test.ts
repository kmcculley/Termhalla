// FROZEN persistence suite — feature 0013-os-needs-you-notifications (phase 4 / TASK-005).
// REQ-005 (persistence half) + REQ-008/REQ-013: the app-wide opt-in lives as one additive-optional
// boolean `orkyNeedsYouNotifications` on the QuickStore, in quick.json, following the `toastsEnabled`
// normalize pattern EXACTLY — absent stays absent (undefined), never coerced-to-true — so a legacy
// file loads clean and reads ENABLED only via the consumer's `!== false` idiom, and no SCHEMA_VERSION
// bump occurs (quick.json is outside the migration chain). Mirrors tests/main/quick-store-toasts.test.ts
// (TEST-006/007/008). The existing tests/main/quick-store.test.ts "round-trips a saved store" pin
// (toEqual over a fixture that omits the field) stays GREEN because toEqual ignores an undefined
// property — verified, not edited.
//
// Runs RED today: normalizeQuick drops the unknown field, so a saved `orkyNeedsYouNotifications`
// round-trips back as undefined (the true/false round-trip assertions fail). The legacy-load and
// SCHEMA_VERSION assertions are GREEN retained-behavior fences.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuickStore } from '../../src/main/persistence/quick-store'
import { SCHEMA_VERSION } from '@shared/types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-quick-needsyou-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const base = {
  connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [],
  templates: [], themePresets: []
}

describe('QuickStore — orkyNeedsYouNotifications (additive optional, default ENABLED)', () => {
  it('TEST-556 REQ-005 round-trips orkyNeedsYouNotifications === false AND === true through save/load', async () => {
    const store = new QuickStore(dir)
    await store.save({ ...base, orkyNeedsYouNotifications: false } as never)
    expect((await store.load() as unknown as Record<string, unknown>).orkyNeedsYouNotifications).toBe(false)
    await store.save({ ...base, orkyNeedsYouNotifications: true } as never)
    expect((await store.load() as unknown as Record<string, unknown>).orkyNeedsYouNotifications).toBe(true)
  })

  it('TEST-557 REQ-005 a legacy quick.json lacking the field loads clean and the ENABLED default reads via `!== false`', () => {
    writeFileSync(join(dir, 'quick.json'), JSON.stringify(base), 'utf8')
    return (async () => {
      const loaded = await new QuickStore(dir).load() as unknown as Record<string, unknown>
      expect(loaded.orkyNeedsYouNotifications).toBeUndefined()   // no throw, no migration, absent stays absent
      expect(loaded.orkyNeedsYouNotifications !== false).toBe(true)  // the shipped default-on idiom
    })()
  })

  it('TEST-558 REQ-005 a non-boolean value normalizes to undefined (the toastsEnabled pattern — never coerced-to-true)', async () => {
    const store = new QuickStore(dir)
    await store.save({ ...base, orkyNeedsYouNotifications: 'yes' } as never)
    expect((await store.load() as unknown as Record<string, unknown>).orkyNeedsYouNotifications).toBeUndefined()
  })

  // SUPERSEDED point-in-time pin (CONV-019): re-pinned 8→9 by feature 0022-client-routing-
  // remote-workspace-ux (REQ-002, the persisted workspace home — see 0022's 04-tests.md).
  it('TEST-559 REQ-008 REQ-013 SCHEMA_VERSION is unchanged by THIS feature — the opt-in adds no persisted file (re-pinned at 9 by 0022 REQ-002)', () => {
    expect(SCHEMA_VERSION).toBe(9)
  })
})
