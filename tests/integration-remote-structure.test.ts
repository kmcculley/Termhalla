// INTEGRATION-phase suite — Remote Agent v1 roadmap (.orky/roadmap.json → integration.summary).
// Structural mandate points, written against the assembled system:
//
//   point 6 — the renderer still has ZERO Node/Electron imports. Existing frozen guards pin
//             narrower slices of this (agent tree: tests/agent-structure.test.ts; remote-client:
//             tests/remote-client-structure.test.ts TEST-2001; shared/remote:
//             tests/remote-protocol-guards.test.ts) — this suite adds the FULL sweep: every
//             import specifier in src/renderer/** checked against 'electron' and the complete
//             node builtin list (bare and node:-prefixed).
//   point 8 — local-only behavior is byte-identical when no remote workspace exists. The
//             behavioral half is TEST-IT-101 (integration-remote-full-stack) plus the full CHAR
//             suite staying green in the same `npm test` run (mandate point 7 — deliberately not
//             duplicated here). This file adds the anchored ORDER pins on the one routing seam:
//             register-pty.ts consults the remote gate strictly BEFORE any local machinery, and
//             only via `args.remote` / `remote.owns(id)` probes — a Map miss for local panes.
//
// Additive only: no existing test or source file is touched.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { builtinModules } from 'node:module'

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

/** Every import/require/dynamic-import specifier in a source text (the frozen suites' scanner). */
const importSpecifiers = (src: string): string[] => {
  const out: string[] = []
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1])
  return out
}

describe('TEST-IT-301 mandate point 6 — the renderer has ZERO Node/Electron imports [F21 invariant over the whole epic]', () => {
  it('no file under src/renderer imports electron or ANY node builtin (bare or node:-prefixed)', () => {
    const rendererDir = resolve(root, 'src/renderer')
    expect(existsSync(rendererDir)).toBe(true)
    const builtins = new Set(builtinModules)
    const offenders: string[] = []
    for (const f of walk(rendererDir, ['.ts', '.tsx'])) {
      for (const s of importSpecifiers(readFileSync(f, 'utf8'))) {
        const bare = s.split('/')[0]
        const isElectron = s === 'electron' || s.startsWith('electron/')
        const isNodePrefixed = s.startsWith('node:')
        const isBuiltin = builtins.has(bare)
        if (isElectron || isNodePrefixed || isBuiltin) offenders.push(`${f} -> "${s}"`)
      }
    }
    expect(offenders, `renderer zero-Node invariant violated:\n${offenders.join('\n')}`).toEqual([])
  })

  it('no file under src/renderer imports the main-process remote router (src/main/remote)', () => {
    const importRe = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*main\/remote[^'"]*['"]/
    const offenders: string[] = []
    for (const f of walk(resolve(root, 'src/renderer'), ['.ts', '.tsx'])) {
      if (importRe.test(readFileSync(f, 'utf8'))) offenders.push(f)
    }
    expect(offenders, 'the remote router is main-process only; the renderer reaches it via window.api').toEqual([])
  })
})

describe('TEST-IT-302 mandate point 8 — the routing seam consults the remote gate BEFORE any local machinery (anchored order pins on register-pty.ts)', () => {
  const src = readFileSync(resolve(root, 'src/main/ipc/register-pty.ts'), 'utf8')

  it('ptySpawn: the args.remote delegation precedes the local adopt/spawn branches', () => {
    const iSpawn = src.indexOf('CH.ptySpawn')
    expect(iSpawn).toBeGreaterThanOrEqual(0)
    const iRemoteGate = src.indexOf('a.remote', iSpawn)
    const iLocalAdopt = src.indexOf('pty.has(a.id)', iSpawn)
    expect(iRemoteGate, 'the remote gate exists inside the spawn handler').toBeGreaterThan(iSpawn)
    expect(iLocalAdopt, 'the local adopt branch exists').toBeGreaterThan(iSpawn)
    expect(iRemoteGate, 'remote delegation runs BEFORE any local machinery — a local spawn (no remote field) falls through untouched').toBeLessThan(iLocalAdopt)
  })

  it.each([
    ['CH.ptyWrite', 'pty.write('],
    ['CH.ptyResize', 'pty.resize('],
    ['CH.ptyKill', 'pty.kill(']
  ])('%s: the remote.owns() probe precedes the local %s call (a Map miss when no remote workspace exists)', (anchor, localCall) => {
    const iAnchor = src.indexOf(anchor)
    expect(iAnchor).toBeGreaterThanOrEqual(0)
    const iProbe = src.indexOf('remote?.owns(', iAnchor)
    const iLocal = src.indexOf(localCall, iAnchor)
    expect(iProbe, `${anchor} probes the remote router first`).toBeGreaterThan(iAnchor)
    expect(iLocal, `${anchor} still has its local path`).toBeGreaterThan(iAnchor)
    expect(iProbe, `${anchor}: the probe comes BEFORE the local call`).toBeLessThan(iLocal)
  })
})
