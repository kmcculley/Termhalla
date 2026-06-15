import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuickStore } from '../../src/main/persistence/quick-store'
import { EMPTY_QUICK } from '@shared/types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-quick-')) })

describe('QuickStore', () => {
  it('returns an empty store when quick.json is missing', async () => {
    const store = new QuickStore(dir)
    expect(await store.load()).toEqual(EMPTY_QUICK)
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a saved store', async () => {
    const store = new QuickStore(dir)
    const data = {
      connections: [{ id: 'c1', name: 'box', host: 'h', user: 'u', port: 2222 }],
      recentConnections: ['c1'],
      favoriteDirs: ['C:\\proj'],
      recentDirs: ['C:\\proj', 'C:\\work'],
      templates: [],
      themePresets: []
    }
    await store.save(data)
    expect(await store.load()).toEqual(data)
    rmSync(dir, { recursive: true, force: true })
  })

  it('falls back to empty on a corrupt (malformed JSON) file', async () => {
    writeFileSync(join(dir, 'quick.json'), '{ "connections": [INVALID', 'utf8')
    const store = new QuickStore(dir)
    expect(await store.load()).toEqual(EMPTY_QUICK)
    rmSync(dir, { recursive: true, force: true })
  })
})
