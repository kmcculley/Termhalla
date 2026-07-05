// FROZEN test suite — feature 0016-remote-protocol-core-handshake (phase 4).
// Structural guards: purity of the protocol modules and the zero-consumer guarantee.
//
// TEST-746 SCOPE GUARD — SUPERSEDED as scheduled (CONV-019): the original guard asserted the
// ABSENCE of ANY production consumer of src/shared/remote/ across src/main/, src/preload/,
// src/renderer/ and named F21 as its retiring feature. F21 (0022-client-routing-remote-
// workspace-ux, TASK-017) executed that retirement through ITS tests phase — never silently:
// src/main/ now legitimately hosts the transport layer (the RemoteWorkspaceManager), so the
// guard narrows to its natural successor: src/preload/ and src/renderer/ still NEVER import
// shared/remote (the renderer zero-Node invariant + protocol confinement to main), keyed on
// the same feature-specific path segment 'shared/remote' (CONV-037).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = process.cwd()

const walk = (dir: string, exts: string[]): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, exts))
    else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

describe('TEST-745 REQ-001 the protocol modules are environment-pure', () => {
  it('src/shared/remote exists, contains the protocol barrel, and no module imports an environment', () => {
    const dir = resolve(root, 'src/shared/remote')
    expect(existsSync(dir), 'src/shared/remote must exist (REQ-001)').toBe(true)
    const files = walk(dir, ['.ts'])
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files.some((f) => f.replace(/\\/g, '/').endsWith('/protocol.ts')),
      'the @shared/remote/protocol barrel must exist').toBe(true)

    const forbidden: Array<[RegExp, string]> = [
      [/from\s+['"]node:/, 'a node: builtin import'],
      [/from\s+['"]electron/, 'an electron import'],
      [/\brequire\s*\(/, 'a require() call'],
      [/\bBuffer\b/, 'the Node Buffer global'],
      [/\bprocess\./, 'the Node process global'],
      [/\b__dirname\b/, '__dirname']
    ]
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const [re, what] of forbidden) {
        expect(re.test(src), `${f} references ${what} — protocol modules must be pure (REQ-001)`).toBe(false)
      }
    }
  })
})

describe('TEST-746 REQ-002 protocol confinement (superseded by 0022 TASK-017 — see header)', () => {
  it('no file under src/preload or src/renderer imports shared/remote (src/main hosts the one sanctioned consumer since F21)', () => {
    const trees = ['src/preload', 'src/renderer']
    // Keyed on the protocol DIRECTORY 'shared/remote/' — the pure sibling models
    // (shared/remote-agents, shared/remote-home, shared/remote-workspace) are renderer-legal and
    // must not false-trip the guard (CONV-037; tightened by 0022 TASK-017 when its own modules
    // exposed the latent prefix collision).
    const importRe = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*shared\/remote\/[^'"]*['"]/
    const offenders: string[] = []
    for (const tree of trees) {
      const dir = resolve(root, tree)
      if (!existsSync(dir)) continue
      for (const f of walk(dir, ['.ts', '.tsx'])) {
        if (importRe.test(readFileSync(f, 'utf8'))) offenders.push(f)
      }
    }
    expect(offenders, `the protocol is confined to src/main (renderer zero-Node invariant, 0022 REQ-005): ${offenders.join(', ')}`)
      .toEqual([])
  })
})
