// FROZEN test suite — feature 0017-agent-runtime-skeleton (phase 4).
// Structural guards over the new src/agent/ tree and the build/typecheck folding.
//
// Scan regexes are keyed to feature-specific surfaces (CONV-037) and anchored (CONV-032).
// TEST-757's gate-profile pin: `.orky/profiles/node-app.json` is a SHARED surface pinned here
// because locked decision 10 (Remote Agent v1 roadmap) requires the profile to stay unchanged
// while the agent folds into its npm scripts. Sanctioned amendment path (CONV-022): a future
// feature that legitimately edits the profile updates the EXPECTED literal below through its
// own tests phase, atomically with the profile edit.
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

/** Every import/require/dynamic-import specifier in a source text. */
const importSpecifiers = (src: string): string[] => {
  const out: string[] = []
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1])
  return out
}

describe('TEST-751 REQ-001 placement and isolation of the agent tree', () => {
  it('src/agent exists with the entry, imports no electron/renderer/preload, and only status from src/main', () => {
    expect(existsSync(resolve(root, 'src/agent')), 'src/agent must exist (REQ-001)').toBe(true)
    expect(existsSync(resolve(root, 'src/agent/main.ts')), 'src/agent/main.ts entry must exist').toBe(true)
    for (const f of agentFiles()) {
      const specs = importSpecifiers(readFileSync(f, 'utf8'))
      for (const s of specs) {
        expect(s.startsWith('electron') || s.includes('/electron'), `${f} imports electron via "${s}" (REQ-001)`).toBe(false)
        expect(s.split('/').includes('renderer') || s.split('/').includes('preload'),
          `${f} imports a renderer/preload module via "${s}" (REQ-001)`).toBe(false)
        // src/main is reachable ONLY through the sanctioned status stack.
        const segs = s.split('/')
        const mainIdx = segs.indexOf('main')
        if (mainIdx !== -1 && (segs[mainIdx - 1] === '..' || segs[mainIdx - 1] === 'src')) {
          expect(segs[mainIdx + 1], `${f} imports src/main outside status/ via "${s}" (REQ-001)`).toBe('status')
        }
      }
    }
  })

  it('no file under src/main, src/preload, or src/renderer imports the agent tree', () => {
    const offenders: string[] = []
    for (const tree of ['src/main', 'src/preload', 'src/renderer']) {
      const dir = resolve(root, tree)
      if (!existsSync(dir)) continue
      for (const f of walk(dir, ['.ts', '.tsx'])) {
        for (const s of importSpecifiers(readFileSync(f, 'utf8'))) {
          // 'agent' as a complete path segment — never a substring like 'useragent' (CONV-037).
          if (s.split('/').includes('agent')) offenders.push(`${f} -> ${s}`)
        }
      }
    }
    expect(offenders, `the running app must not consume the agent (REQ-001): ${offenders.join(', ')}`).toEqual([])
  })
})

describe('TEST-752 REQ-002 protocol consumed only via the barrel; framing never re-derived', () => {
  it('every shared/remote specifier ends with /protocol, at least one exists, and no byte-framing primitives appear', () => {
    let barrelImports = 0
    for (const f of agentFiles()) {
      const src = readFileSync(f, 'utf8')
      for (const s of importSpecifiers(src)) {
        if (s.includes('shared/remote')) {
          expect(s.endsWith('/protocol'), `${f} imports "${s}" — only the @shared/remote/protocol barrel is sanctioned (REQ-002)`).toBe(true)
          barrelImports++
        }
      }
      expect(/setUint32|getUint32|writeUInt32BE|readUInt32BE/.test(src),
        `${f} contains 4-byte framing primitives — framing lives only in F15's codec (REQ-002)`).toBe(false)
    }
    expect(barrelImports, 'the agent must genuinely consume @shared/remote/protocol (REQ-002)').toBeGreaterThanOrEqual(1)
  })
})

describe('TEST-753 REQ-004 the advertisement is the pinned constant, never a hand-typed list', () => {
  it('session.ts references AGENT_V1_CAPABILITIES and no agent file hand-types the pty/status pair', () => {
    const session = readFileSync(resolve(root, 'src/agent/session.ts'), 'utf8')
    expect(session.includes('AGENT_V1_CAPABILITIES'),
      'session.ts must advertise F15\'s AGENT_V1_CAPABILITIES constant (REQ-004)').toBe(true)
    for (const f of agentFiles()) {
      expect(/\[\s*['"]pty['"]\s*,\s*['"]status['"]\s*\]/.test(readFileSync(f, 'utf8')),
        `${f} hand-types ['pty', 'status'] — import AGENT_V1_CAPABILITIES instead (REQ-004)`).toBe(false)
    }
  })
})

describe('TEST-754 REQ-008 status detection is imported from src/main/status, never forked', () => {
  it('the agent imports the existing status stack and defines no parser of its own', () => {
    const all = agentFiles().map((f) => ({ f, src: readFileSync(f, 'utf8') }))
    const importsStatus = all.some(({ src }) =>
      importSpecifiers(src).some((s) => s.includes('main/status/')))
    expect(importsStatus, 'src/agent must import from src/main/status/ (REQ-008)').toBe(true)
    for (const { f, src } of all) {
      // Emission of OSC strings is sanctioned (the fake shell EMITS markers); PARSING must not
      // be re-implemented — no local definitions of the scanner/parser seams.
      expect(/(?:function|const|class)\s+(?:scanOsc|Osc133Parser|CwdParser|StatusTracker|StatusEngine)\b/.test(src),
        `${f} re-implements a status parsing seam — import it from src/main/status (REQ-008)`).toBe(false)
    }
  })
})

describe('TEST-755 REQ-011 node-pty is confined to the backend module and lazily loaded', () => {
  // Loopback note (tests iteration 1, ADR-009): the original trigger was the raw substring
  // `src.includes('node-pty')`, which contradicts REQ-011 itself — args.ts must contain the
  // literal to parse `--pty=node-pty` (TEST-759) and main.ts must import './node-pty-backend'
  // by name. The pin's intent is confinement of the node-pty MODULE reference, so the trigger
  // is the extracted import/require/dynamic-import SPECIFIER being exactly 'node-pty'.
  it('only node-pty-backend.ts imports the node-pty module, dynamically, never statically', () => {
    const backendFile = resolve(root, 'src/agent/node-pty-backend.ts')
    expect(existsSync(backendFile), 'src/agent/node-pty-backend.ts must exist (REQ-011)').toBe(true)
    let moduleImporters = 0
    for (const f of agentFiles()) {
      const src = readFileSync(f, 'utf8')
      const norm = f.replace(/\\/g, '/')
      if (!importSpecifiers(src).includes('node-pty')) continue
      moduleImporters++
      expect(norm.endsWith('src/agent/node-pty-backend.ts'),
        `${f} imports the node-pty module — only node-pty-backend.ts may (REQ-011)`).toBe(true)
      expect(/import\s+[^()]*?from\s+['"]node-pty['"]/.test(src),
        'node-pty-backend.ts must not import node-pty statically (REQ-011)').toBe(false)
      expect(/import\s*\(\s*['"]node-pty['"]\s*\)/.test(src),
        'node-pty-backend.ts must load node-pty via a lazy dynamic import (REQ-011)').toBe(true)
      expect(/\brequire\s*\(\s*['"]node-pty['"]\s*\)/.test(src),
        'node-pty-backend.ts must not require() node-pty (REQ-011)').toBe(false)
    }
    expect(moduleImporters, 'exactly the backend module references node-pty (anti-vacuity)').toBe(1)
  })
})

describe('TEST-756 REQ-012 the fake backend is deterministic (no time, no RNG, no timers)', () => {
  it('fake-backend.ts contains no clock/random/scheduling references', () => {
    const src = readFileSync(resolve(root, 'src/agent/fake-backend.ts'), 'utf8')
    expect(/Date\.now|new Date|Math\.random|setTimeout|setInterval|setImmediate|queueMicrotask|process\.hrtime/.test(src),
      'fake-backend.ts must be deterministic: no time, RNG, or scheduling (REQ-012)').toBe(false)
  })
})

describe('TEST-757 REQ-015 build folding: npm run build emits the agent artifact; profile untouched', () => {
  it('the build script chains the agent bundle and the vite agent config has the pinned shape', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts.build.includes('electron-vite build'),
      'scripts.build must keep the electron-vite build (REQ-015)').toBe(true)
    expect(pkg.scripts.build.includes('vite.agent.config'),
      'scripts.build must chain the agent bundle build (REQ-015)').toBe(true)
    const cfgPath = resolve(root, 'vite.agent.config.ts')
    expect(existsSync(cfgPath), 'vite.agent.config.ts must exist (REQ-015)').toBe(true)
    const cfg = readFileSync(cfgPath, 'utf8')
    for (const literal of ['src/agent/main.ts', 'out/agent', 'termhalla-agent.cjs', "'node-pty'"]) {
      expect(cfg.includes(literal), `vite.agent.config.ts must pin ${literal} (REQ-015)`).toBe(true)
    }
  })

  it('.orky/profiles/node-app.json is unchanged (locked decision 10)', () => {
    const profile = JSON.parse(readFileSync(resolve(root, '.orky/profiles/node-app.json'), 'utf8'))
    expect(profile.commands).toEqual({
      setup: 'npm install --no-audit --no-fund',
      build: 'npm run build --if-present',
      test: 'npm test',
      coverage: 'npx --yes c8 --check-coverage --lines 80 npm test',
      lint: 'npm run lint --if-present',
      typecheck: 'npm run typecheck --if-present'
    })
    expect(profile.testRoots).toEqual(['tests'])
    expect(profile.gates).toEqual({
      spec: ['findings'],
      plan: ['spec-freeze', 'traceability-plan', 'findings'],
      tests: ['spec-freeze', 'tests-red'],
      implement: ['spec-freeze', 'build', 'test', 'test-freeze'],
      review: ['spec-freeze', 'findings'],
      'doc-sync': ['spec-freeze', 'traceability', 'findings']
    })
    expect(profile.setupManifests).toEqual(['package.json', 'package-lock.json'])
  })
})

describe('TEST-758 REQ-017 typecheck covers the agent tree', () => {
  it('tsconfig.node.json includes src/agent', () => {
    const ts = JSON.parse(readFileSync(resolve(root, 'tsconfig.node.json'), 'utf8')) as { include: string[] }
    expect(ts.include, 'tsconfig.node.json include must gain src/agent (REQ-017)').toContain('src/agent')
  })
})
