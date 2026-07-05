// FROZEN unit suite — feature 0005-cross-project-orky-registry (phase 4 / TASK-004, REQ-013).
// Targets `src/main/persistence/orky-registry-store.ts` — the new, SELF-versioned persisted root list
// (`orky-registry.json` under Electron userData), mirroring `quick-store.ts`'s normalize-on-load /
// normalize-on-write / atomic-write pattern (see tests/main/quick-store.test.ts for the sibling style).
// A missing/corrupt/partial file MUST load as an empty list, never throw (CONV-002). The file carries
// its OWN `version` integer; the global `SCHEMA_VERSION` (src/shared/types.ts) MUST NOT be bumped by
// this feature — this file is not part of the app-state migration chain (REQ-013).
//
// Runs RED today: `src/main/persistence/orky-registry-store.ts` does not exist yet (module-not-found).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrkyRegistryStore } from '../../src/main/persistence/orky-registry-store'
import { SCHEMA_VERSION } from '@shared/types'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'orky-regstore-'))
  cleanups.push(() => rmSync(d, { recursive: true, force: true }))
  return d
}

describe('OrkyRegistryStore — load (REQ-013)', () => {
  it('TEST-078 REQ-013 returns an empty list when orky-registry.json is missing, never throws', async () => {
    const store = new OrkyRegistryStore(tmpDir())
    await expect(store.load()).resolves.toEqual([])
  })

  it('TEST-079 REQ-013 falls back to an empty list on a corrupt (malformed JSON) file, no throw (CONV-002)', async () => {
    const dir = tmpDir()
    writeFileSync(join(dir, 'orky-registry.json'), '{ "version": 1, "roots": [INVALID', 'utf8')
    const store = new OrkyRegistryStore(dir)
    await expect(store.load()).resolves.toEqual([])
  })

  it('TEST-080 REQ-013 falls back to an empty list on a partial/garbage/non-JSON file, no throw', async () => {
    const dir = tmpDir()
    writeFileSync(join(dir, 'orky-registry.json'), 'not even json at all', 'utf8')
    const store = new OrkyRegistryStore(dir)
    await expect(store.load()).resolves.toEqual([])
  })

  it('TEST-081 REQ-013 normalizes on load: drops non-string roots entries, de-duplicates, sorts (codepoint)', async () => {
    const dir = tmpDir()
    writeFileSync(join(dir, 'orky-registry.json'), JSON.stringify({
      version: 1,
      roots: ['/proj/zeta', 42, '/proj/alpha', '/proj/zeta', null, '/proj/Beta']
    }), 'utf8')
    const store = new OrkyRegistryStore(dir)
    expect(await store.load()).toEqual(['/proj/Beta', '/proj/alpha', '/proj/zeta']) // codepoint sort, deduped, non-strings dropped
  })

  it('TEST-082 REQ-013 a missing "roots" array (or a non-array value for it) loads as empty, never throws', async () => {
    const dir = tmpDir()
    writeFileSync(join(dir, 'orky-registry.json'), JSON.stringify({ version: 1 }), 'utf8')
    const store = new OrkyRegistryStore(dir)
    expect(await store.load()).toEqual([])

    const dir2 = tmpDir()
    writeFileSync(join(dir2, 'orky-registry.json'), JSON.stringify({ version: 1, roots: 'not-an-array' }), 'utf8')
    const store2 = new OrkyRegistryStore(dir2)
    expect(await store2.load()).toEqual([])
  })
})

describe('OrkyRegistryStore — save (REQ-013)', () => {
  it('TEST-083 REQ-013 round-trips a saved list (normalized, sorted) and writes the self-versioned shape {version:1, roots:[...]}', async () => {
    const dir = tmpDir()
    const store = new OrkyRegistryStore(dir)
    await store.save(['/proj/zeta', '/proj/alpha'])
    expect(await store.load()).toEqual(['/proj/alpha', '/proj/zeta'])

    const file = join(dir, 'orky-registry.json')
    expect(existsSync(file)).toBe(true)
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk).toEqual({ version: 1, roots: ['/proj/alpha', '/proj/zeta'] })
  })

  it('TEST-084 REQ-013 save() normalizes the same way as load(): dedupes + drops non-strings before writing', async () => {
    const dir = tmpDir()
    const store = new OrkyRegistryStore(dir)
    await store.save(['/proj/x', '/proj/x', 99 as unknown as string])
    expect(await store.load()).toEqual(['/proj/x'])
  })

  it('TEST-085 REQ-013 saving an empty list round-trips to an empty list (does not crash / does not omit the file)', async () => {
    const dir = tmpDir()
    const store = new OrkyRegistryStore(dir)
    await store.save([])
    expect(await store.load()).toEqual([])
    expect(existsSync(join(dir, 'orky-registry.json'))).toBe(true)
  })

  it('TEST-086 REQ-013 save() goes through the shared atomicWrite helper (temp-then-rename), not a plain writeFile, per source inspection', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'main', 'persistence', 'orky-registry-store.ts'), 'utf8')
    expect(src).toMatch(/atomicWrite/)
    expect(src).not.toMatch(/\bwriteFileSync\(/)
    expect(src).not.toMatch(/fsp\.writeFile\(|writeFile\(\s*this\.file\(\)/) // no DIRECT writeFile of the target file outside atomicWrite
  })
})

describe('OrkyRegistryStore — no SCHEMA_VERSION coupling (REQ-013)', () => {
  it('TEST-087 REQ-013 the global SCHEMA_VERSION is unchanged by this feature; orky-registry.json carries its own embedded version:1', async () => {
    // SUPERSEDED point-in-time pin (CONV-019): re-pinned 7→8 by 0009 REQ-003, then 8→9 by feature
    // 0022-client-routing-remote-workspace-ux (REQ-002, the persisted workspace home — see 0022's
    // 04-tests.md). F5's invariant — orky-registry.json carries its OWN embedded version:1 outside
    // the app-state migration chain — is untouched below.
    expect(SCHEMA_VERSION).toBe(9) // this feature's persisted file is NOT part of the app-state migration chain
    const dir = tmpDir()
    const store = new OrkyRegistryStore(dir)
    await store.save(['/proj/a'])
    const onDisk = JSON.parse(readFileSync(join(dir, 'orky-registry.json'), 'utf8'))
    expect(onDisk.version).toBe(1)
  })
})
