// FROZEN test suite — feature 0019-agent-replay-session-survival (phase 4).
// Structural guards: REQ-002(a) (the anti-transit-buffer exclusion — locked decision 3 names
// the window-manager transit primitive as the WRONG tool; nothing under src/agent may import
// it), REQ-003 (xterm dependency confinement to replay.ts + determinism scan), REQ-012 (the
// @xterm/headless dependency rides the 5.x line beside @xterm/xterm ^5.5 and the already-present
// serialize addon). Scan regexes are feature-keyed and anchored (CONV-032/CONV-037).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

const agentFiles = (): string[] => walk(resolve(root, 'src/agent'), ['.ts'])

/** Every import/require/dynamic-import specifier in a source text (the F16 scan). */
const importSpecifiers = (src: string): string[] => {
  const out: string[] = []
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1])
  return out
}

describe('TEST-1910 REQ-002/REQ-003/REQ-012 structural guards', () => {
  it('no src/agent file imports the window-manager transit machinery (locked decision 3)', () => {
    const offenders: string[] = []
    for (const f of agentFiles()) {
      for (const s of importSpecifiers(readFileSync(f, 'utf8'))) {
        if (s.includes('window-manager')) offenders.push(`${f} -> ${s}`)
      }
    }
    expect(offenders, 'the transit buffer is the WRONG tool here (REQ-002)').toEqual([])
  })

  it('confines @xterm/headless and @xterm/addon-serialize to exactly src/agent/replay.ts', () => {
    expect(existsSync(resolve(root, 'src/agent/replay.ts')), 'src/agent/replay.ts must exist (REQ-003)').toBe(true)
    const importers: Record<string, string[]> = { '@xterm/headless': [], '@xterm/addon-serialize': [] }
    for (const f of agentFiles()) {
      const norm = f.replace(/\\/g, '/')
      for (const s of importSpecifiers(readFileSync(f, 'utf8'))) {
        if (s in importers) importers[s].push(norm)
      }
    }
    for (const [spec, files] of Object.entries(importers)) {
      expect(files.length, `exactly one importer of ${spec} (anti-vacuity + confinement, REQ-003)`).toBe(1)
      expect(files[0].endsWith('src/agent/replay.ts'), `${spec} may be imported only by replay.ts, got ${files[0]}`).toBe(true)
    }
  })

  it('replay.ts is deterministic-scannable: no clock, RNG, or scheduling of its own', () => {
    const src = readFileSync(resolve(root, 'src/agent/replay.ts'), 'utf8')
    expect(/Date\.now|new Date|Math\.random|setTimeout|setInterval|setImmediate|queueMicrotask|process\.hrtime/.test(src),
      'the write-flush barrier must ride xterm\'s own callbacks, never our timers (REQ-003)').toBe(false)
  })

  it('package.json pins @xterm/headless to the 5.x line beside the existing serialize addon', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    const headless = pkg.dependencies['@xterm/headless']
    expect(headless, '@xterm/headless must be a runtime dependency (REQ-012)').toBeDefined()
    expect(headless.startsWith('^5.'),
      `@xterm/headless must ride the 5.x line paired with @xterm/xterm ^5.5 (got ${headless}) — the 6.x line breaks the addon pairing`).toBe(true)
    expect(pkg.dependencies['@xterm/addon-serialize'], 'the serialize addon stays a dependency').toBeDefined()
    expect(pkg.dependencies['@xterm/xterm'], 'the renderer xterm dependency is untouched').toBeDefined()
  })
})
