// FROZEN unit suite — feature 0004-orky-status-awareness (phase 4 / REQ-012, TASK-010 discovery rule).
// `.orky/` discovery is a deterministic, BOUNDED upward walk from the pane's tracked cwd — it checks
// cwd then walks UP a fixed number of ancestors, never to the filesystem root unbounded.
//
// Chosen contract (see 04-tests.md):
//   findOrkyRoot(cwd: string, opts?: { maxDepth?: number }): string | null
//   → the first directory (cwd or an ancestor) that contains a `.orky/` dir, or null.
//
// Runs RED today: `src/main/orky/find-orky-root` does not exist — the file errors on import.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findOrkyRoot } from '../../src/main/orky/find-orky-root'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

function projectWithOrky(): string {
  const proj = mkdtempSync(join(tmpdir(), 'orky-root-'))
  mkdirSync(join(proj, '.orky'), { recursive: true })
  cleanups.push(() => rmSync(proj, { recursive: true, force: true }))
  return proj
}

describe('findOrkyRoot — bounded ancestor walk (REQ-012)', () => {
  it('TEST-025 REQ-012 finds .orky in the cwd itself', () => {
    const proj = projectWithOrky()
    expect(findOrkyRoot(proj, { maxDepth: 8 })).toBe(proj)
  })

  it('TEST-025 REQ-012 finds .orky in an ancestor of a nested cwd', () => {
    const proj = projectWithOrky()
    const nested = join(proj, 'a', 'b', 'c')
    mkdirSync(nested, { recursive: true })
    expect(findOrkyRoot(nested, { maxDepth: 8 })).toBe(proj)
  })

  it('TEST-025 REQ-012 returns null when no ancestor has .orky, and respects the bounded depth cap', () => {
    // no .orky anywhere
    const bare = mkdtempSync(join(tmpdir(), 'orky-none-'))
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }))
    expect(findOrkyRoot(bare, { maxDepth: 8 })).toBeNull()

    // .orky exists 3 levels up but the cap stops the walk before reaching it → null (bounded, never to FS root)
    const proj = projectWithOrky()
    const deep = join(proj, 'a', 'b', 'c')
    mkdirSync(deep, { recursive: true })
    expect(findOrkyRoot(deep, { maxDepth: 1 })).toBeNull()
  })
})
