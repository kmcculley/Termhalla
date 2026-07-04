// FROZEN test suite — feature 0016-remote-protocol-core-handshake (phase 4).
// Structural guards: purity of the protocol modules and the zero-consumer guarantee.
//
// TEST-746 SCOPE-GUARD RETIREMENT PATH (CONV-019): this guard asserts the ABSENCE of a
// production consumer of src/shared/remote/ ("zero behavior change to the running app",
// REQ-002). It is scoped to src/main/, src/preload/, src/renderer/ ONLY and keyed on the
// feature-specific path segment 'shared/remote' (CONV-037). Expected lifecycle:
//   - F16 (0017-agent-runtime-skeleton) adds the agent-side consumer OUTSIDE these trees
//     (the guard SURVIVES F16 unchanged);
//   - F21 (0022-client-routing-remote-workspace-ux) legitimately imports the protocol
//     into src/main's transport layer and MUST retire/supersede this guard through its
//     own tests phase — never silently during implementation.
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

describe('TEST-746 REQ-002 zero production consumers (scope guard — see retirement path in the header)', () => {
  it('no file under src/main, src/preload, or src/renderer imports shared/remote', () => {
    const trees = ['src/main', 'src/preload', 'src/renderer']
    const importRe = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*shared\/remote[^'"]*['"]/
    const offenders: string[] = []
    for (const tree of trees) {
      const dir = resolve(root, tree)
      if (!existsSync(dir)) continue
      for (const f of walk(dir, ['.ts', '.tsx'])) {
        if (importRe.test(readFileSync(f, 'utf8'))) offenders.push(f)
      }
    }
    expect(offenders, `production code must not consume the protocol yet (REQ-002): ${offenders.join(', ')}`)
      .toEqual([])
  })
})
