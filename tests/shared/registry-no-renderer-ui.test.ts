// FROZEN unit suite — feature 0005-cross-project-orky-registry (phase 4 / REQ-021 scope guard, D1).
// D1 (binding concept decision): F5 ships NO renderer component that renders the cross-project
// aggregate (no queue panel, settings list, badge) — IPC/data only; F6 is the first UI consumer. This is
// a source-grep scope guard (mirrors the read-only `child_process` grep in
// tests/main/orky-tracker.test.ts TEST-030): no file under `src/renderer/` may reference the registry
// snapshot type or any of the `registry:*` API surface.
//
// This test PASSES today (no such renderer code exists yet, trivially) and MUST keep passing after this
// feature ships — it is a regression guard, not a want-of-correction RED signal. The feature's overall
// suite is still RED via the other new test files, which target modules that do not exist yet.
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

const RENDERER_SYMBOL_PATTERN = /OrkyRegistrySnapshot|OrkyRegistryEntry|RegistryMutationResult|onRegistryStatus|registryCurrent\s*\(|registryRoots\s*\(|registryAddRoot\s*\(|registryRemoveRoot\s*\(/

describe('REQ-021 — no renderer UI ships in this feature (D1 scope guard)', () => {
  it('TEST-070 REQ-021 no file under src/renderer/ imports or references the registry aggregate type or registry:* API surface', () => {
    const files = listFiles(join(process.cwd(), 'src', 'renderer'))
    const offenders = files
      .map(f => ({ f, src: readFileSync(f, 'utf8') }))
      .filter(({ src }) => RENDERER_SYMBOL_PATTERN.test(src))
      .map(({ f }) => f)
    expect(offenders).toEqual([])
  })
})
