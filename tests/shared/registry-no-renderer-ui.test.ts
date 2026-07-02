// FROZEN unit suite — NARROWED renderer scope guard for the cross-project Orky registry surface.
//
// SUPERSESSION (F6 REQ-019): this file previously carried TEST-070 (feature 0005, F5 REQ-021) — the
// D1 scope guard asserting NO file under `src/renderer/` referenced the registry aggregate type or
// ANY `registry:*` API surface. That guard was scoped to F5's development window and its own header
// named F6 as the designed first consumer. Feature 0006-decision-queue-panel (F6 REQ-019) supersedes
// it HERE, at F6's tests phase, in the same change that introduces F6's suite (never silently during
// implementation): TEST-070 is retired and replaced by TEST-362/TEST-363 below, which PERMIT the
// read surface F6's renderer consumes (`OrkyRegistrySnapshot`, `OrkyRegistryEntry`,
// `onRegistryStatus`, `registryCurrent(`) while still FORBIDDING the registry MUTATION surface
// (`RegistryMutationResult`, `registryRoots(`, `registryAddRoot(`, `registryRemoveRoot(`), which
// F6 REQ-017 continues to exclude ("no track-project gesture here").
//
// DESIGNATED RETIRING FEATURE (the convention F6's Baseline-fit records — an absence-of-consumer
// guard is never frozen without a scheduled retirement path): this narrowed guard is itself retired
// by the first feature that ships a SANCTIONED renderer-side registry-mutation consumer (the
// "track this project" gesture — currently unowned; plausibly F13 Settings or a successor). That
// feature's spec must supersede this guard at ITS tests phase, exactly as F6 did for TEST-070.
//
// This guard PASSES today (no renderer mutation-surface reference exists) and MUST keep passing
// after F6 ships — it is a regression guard, not a want-of-correction RED signal.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...listFiles(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** The registry MUTATION surface — still forbidden in the renderer (F6 REQ-017/REQ-019). The read
 *  surface F6 consumes (OrkyRegistrySnapshot / OrkyRegistryEntry / onRegistryStatus /
 *  registryCurrent() is deliberately NOT in this pattern anymore (supersedes TEST-070). */
const RENDERER_MUTATION_PATTERN = /RegistryMutationResult|registryRoots\s*\(|registryAddRoot\s*\(|registryRemoveRoot\s*\(/

describe('F6 REQ-019/REQ-017 — narrowed renderer scope guard (supersedes TEST-070, F5 REQ-021)', () => {
  it('TEST-362 REQ-019 REQ-017 no file under src/renderer/ references the registry MUTATION surface (read surface permitted)', () => {
    const files = listFiles(join(process.cwd(), 'src', 'renderer'))
    const offenders = files
      .map(f => ({ f, src: readFileSync(f, 'utf8') }))
      .filter(({ src }) => RENDERER_MUTATION_PATTERN.test(src))
      .map(({ f }) => f)
    expect(offenders).toEqual([])
  })

  it('TEST-363 REQ-019 the guard still FAILS on an injected mutation-surface reference and PERMITS every read-surface symbol F6 consumes', () => {
    // Would-flag: each mutation symbol, as it would appear in renderer source.
    for (const injected of [
      'const r: RegistryMutationResult = await x',
      'await api.registryRoots()',
      'await api.registryAddRoot(root)',
      'await api.registryRemoveRoot (root)'
    ]) {
      expect(RENDERER_MUTATION_PATTERN.test(injected), `must flag: ${injected}`).toBe(true)
    }
    // Would-permit: the read surface F6's App.tsx / registry-slice legitimately reference.
    for (const permitted of [
      "import type { OrkyRegistrySnapshot, OrkyRegistryEntry } from '@shared/types'",
      'api.onRegistryStatus(snapshot => s().setRegistrySnapshot(snapshot))',
      'void api.registryCurrent().then(...)'
    ]) {
      expect(RENDERER_MUTATION_PATTERN.test(permitted), `must permit: ${permitted}`).toBe(false)
    }
  })
})
