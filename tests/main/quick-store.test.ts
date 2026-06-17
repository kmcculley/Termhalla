import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuickStore, normalizeTheme } from '../../src/main/persistence/quick-store'
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
      themePresets: [],
      recordByDefault: false
    }
    await store.save(data)
    expect(await store.load()).toEqual(data)
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips and normalizes the keybindings map', async () => {
    const store = new QuickStore(dir)
    const data = {
      connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [],
      templates: [], themePresets: [], recordByDefault: false,
      keybindings: { 'new-terminal': 'mod+shift+n', 'close-workspace': 'none', 'bad': 42 as unknown as string }
    }
    await store.save(data)
    const loaded = await store.load()
    // Non-string values are dropped; string values survive.
    expect(loaded.keybindings).toEqual({ 'new-terminal': 'mod+shift+n', 'close-workspace': 'none' })
    rmSync(dir, { recursive: true, force: true })
  })

  it('falls back to empty on a corrupt (malformed JSON) file', async () => {
    writeFileSync(join(dir, 'quick.json'), '{ "connections": [INVALID', 'utf8')
    const store = new QuickStore(dir)
    expect(await store.load()).toEqual(EMPTY_QUICK)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('normalizeTheme', () => {
  it('keeps a theme object', () => {
    expect(normalizeTheme({ text: '#111' })).toEqual({ text: '#111' })
  })
  it('drops an absent / non-object / array theme', () => {
    expect(normalizeTheme(undefined)).toBeUndefined()
    expect(normalizeTheme('nope')).toBeUndefined()
    expect(normalizeTheme(['x'])).toBeUndefined()
    expect(normalizeTheme(null)).toBeUndefined()
  })
})
