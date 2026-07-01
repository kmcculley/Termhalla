// FROZEN integration suite — feature 0005-cross-project-orky-registry (phase 4 / TASK-003, REQ-009 +
// REQ-016, security).
// Targets `src/main/orky/validate-root.ts` — the `registry:addRoot` IPC-boundary validator. MUST never
// throw (a malformed IPC arg cannot become an unhandled rejection that kills the main process, Node 22
// default `--unhandled-rejections=throw`); MUST normalize/resolve to an absolute path; MUST accept ONLY a
// resolved directory that currently contains a `.orky/` directory; MUST give a distinct, specific,
// actionable error per failure kind (CONV-001 — never one generic message for every rejection).
//
// Chosen contract (the plan's TASK-003 prose is authoritative on behavior; this suite freezes the exact
// shape):
//   validateRegistryRoot(input: unknown): Promise<{ ok: true; root: string } | { ok: false; error: string }>
//
// Runs RED today: `src/main/orky/validate-root.ts` does not exist yet (module-not-found).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { validateRegistryRoot } from '../../src/main/orky/validate-root'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

function makeOrkyProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-vroot-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.orky'), { recursive: true })
  return root
}

describe('validateRegistryRoot — IPC boundary validation (REQ-009 / REQ-016)', () => {
  it('TEST-071 REQ-016 a non-string input is rejected without throwing, with a string-specific error', async () => {
    expect(() => validateRegistryRoot(42 as unknown)).not.toThrow()
    const r1 = await validateRegistryRoot(42 as unknown)
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error.toLowerCase()).toContain('string')
    const r2 = await validateRegistryRoot(undefined as unknown)
    expect(r2.ok).toBe(false)
    const r3 = await validateRegistryRoot({ not: 'a path' } as unknown)
    expect(r3.ok).toBe(false)
  })

  it('TEST-072 REQ-009 a directory containing .orky/ resolves ok:true with the normalized absolute path', async () => {
    const proj = makeOrkyProject()
    const r = await validateRegistryRoot(proj)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.root).toBe(resolve(proj))
  })

  it('TEST-073 REQ-009/REQ-016 a directory with NO .orky/ is rejected with an error distinct from the non-string case', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'orky-vroot-bare-'))
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }))
    const noOrky = await validateRegistryRoot(bare)
    expect(noOrky.ok).toBe(false)
    const nonString = await validateRegistryRoot(42 as unknown)
    expect(nonString.ok).toBe(false)
    if (!noOrky.ok && !nonString.ok) {
      expect(noOrky.error).not.toBe(nonString.error) // CONV-001: each rejection kind has its OWN message
      expect(noOrky.error.toLowerCase()).toContain('.orky')
    }
  })

  it('TEST-074 REQ-009/REQ-016 a path that does not exist on disk at all is rejected, distinctly from the no-.orky case', async () => {
    const ghost = join(tmpdir(), 'orky-vroot-does-not-exist-' + Date.now())
    const missing = await validateRegistryRoot(ghost)
    expect(missing.ok).toBe(false)

    const bare = mkdtempSync(join(tmpdir(), 'orky-vroot-bare2-'))
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }))
    const noOrky = await validateRegistryRoot(bare)
    if (!missing.ok && !noOrky.ok) expect(missing.error).not.toBe(noOrky.error)
  })

  it('TEST-075 REQ-016 a relative-looking / traversal-laden path (e.g. "../../etc") that does not resolve to a .orky/ dir is rejected, never throws, never crashes the process', async () => {
    expect(() => validateRegistryRoot('../../etc')).not.toThrow()
    const r = await validateRegistryRoot('../../etc')
    expect(r.ok).toBe(false)
  })

  it('TEST-076 REQ-016 a path with embedded ".." segments that collapses (via normalization) back onto a VALID .orky/ project is accepted, resolving to the canonical root (no literal ".." survives)', async () => {
    const proj = makeOrkyProject()
    const viaTraversal = join(dirname(proj), '..', basename(dirname(proj)), basename(proj))
    const r = await validateRegistryRoot(viaTraversal)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.root).toBe(resolve(proj))
      expect(r.root).not.toContain('..')
    }
  })

  it('TEST-077 REQ-009 adding the SAME root twice resolves identically (idempotency is the registry layer\'s job, but the normalized root must be stable/repeatable here)', async () => {
    const proj = makeOrkyProject()
    const r1 = await validateRegistryRoot(proj)
    const r2 = await validateRegistryRoot(proj)
    expect(r1).toEqual(r2)
  })
})
