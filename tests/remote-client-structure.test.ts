// FROZEN test suite — feature 0020-ssh-tunnel-provisioned-bootstrap (phase 4).
// Structural guards over the new src/remote-client/ tree, the pure shared model, and the
// no-ssh-library invariant (locked decision 1).
//
// TEST-2001 SCOPE-GUARD RETIREMENT PATH (CONV-019): the "zero app consumers" guard asserts the
// ABSENCE of a production consumer of src/remote-client/ — F19 ships a headless library and the
// running app's behavior is unchanged (REQ-001/REQ-002). It is scoped to src/main/, src/preload/,
// src/renderer/ ONLY and keyed on the feature-specific path segment 'remote-client' (CONV-037,
// anchored per CONV-032). F21 (0022-client-routing-remote-workspace-ux) legitimately imports the
// tunnel into src/main's transport layer and MUST retire/supersede this guard through its own
// tests phase — never silently during implementation.
//
// TEST-2003 deliberately pins F19's OWN invariant (no ssh-implementation dependency), NOT an
// equality snapshot of package.json's dependency sets — parallel sibling features legitimately
// add unrelated deps and an equality pin would false-trip at the batch merge re-gate (CONV-022).
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

/** Every import/require/dynamic-import specifier in a source text. */
const importSpecifiers = (src: string): string[] => {
  const out: string[] = []
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1])
  return out
}

const clientFiles = (): string[] => walk(resolve(root, 'src/remote-client'), ['.ts'])

describe('TEST-2001 REQ-001 placement and isolation of the remote-client tree', () => {
  it('src/remote-client exists and imports no electron/renderer/preload/main module', () => {
    expect(existsSync(resolve(root, 'src/remote-client')), 'src/remote-client must exist (REQ-001)').toBe(true)
    for (const f of clientFiles()) {
      const specs = importSpecifiers(readFileSync(f, 'utf8'))
      for (const s of specs) {
        expect(s.startsWith('electron') || s.includes('/electron'),
          `${f} imports electron via "${s}" (REQ-001)`).toBe(false)
        const segs = s.split('/')
        for (const banned of ['renderer', 'preload', 'main']) {
          expect(segs.includes(banned) && (segs.includes('..') || segs[0] === 'src'),
            `${f} imports a src/${banned} module via "${s}" — the client tree is fully app-independent (REQ-001)`).toBe(false)
        }
      }
    }
  })

  it('no file under src/main, src/preload, or src/renderer imports remote-client (scope guard — retirement: F21, see header)', () => {
    const importRe = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*remote-client[^'"]*['"]/
    const offenders: string[] = []
    for (const tree of ['src/main', 'src/preload', 'src/renderer']) {
      const dir = resolve(root, tree)
      if (!existsSync(dir)) continue
      for (const f of walk(dir, ['.ts', '.tsx'])) {
        if (importRe.test(readFileSync(f, 'utf8'))) offenders.push(f)
      }
    }
    expect(offenders, `the app must not consume remote-client yet (REQ-001): ${offenders.join(', ')}`).toEqual([])
  })

  it('tsconfig.node.json includes BOTH src/agent and src/remote-client (typecheck folding)', () => {
    const ts = JSON.parse(readFileSync(resolve(root, 'tsconfig.node.json'), 'utf8')) as { include: string[] }
    expect(ts.include, 'tsconfig.node.json must keep src/agent (frozen TEST-758)').toContain('src/agent')
    expect(ts.include, 'tsconfig.node.json include must gain src/remote-client (REQ-001)').toContain('src/remote-client')
  })
})

describe('TEST-2002 REQ-002/REQ-003 the shared named-agent model is environment-pure', () => {
  it('src/shared/remote-agents.ts exists and references no environment', () => {
    const p = resolve(root, 'src/shared/remote-agents.ts')
    expect(existsSync(p), 'src/shared/remote-agents.ts must exist (REQ-003)').toBe(true)
    const src = readFileSync(p, 'utf8')
    const forbidden: Array<[RegExp, string]> = [
      [/from\s+['"]node:/, 'a node: builtin import'],
      [/from\s+['"]electron/, 'an electron import'],
      [/\brequire\s*\(/, 'a require() call'],
      [/\bBuffer\b/, 'the Node Buffer global'],
      [/\bprocess\./, 'the Node process global'],
      [/\b__dirname\b/, '__dirname']
    ]
    for (const [re, what] of forbidden) {
      expect(re.test(src), `src/shared/remote-agents.ts references ${what} — must be pure (REQ-002)`).toBe(false)
    }
  })
})

describe('TEST-2003 REQ-007 the system ssh binary, never an ssh library', () => {
  const bannedNames = ['ssh2', 'node-ssh', 'simple-ssh', 'libssh', 'russh', 'electron-ssh2']

  it('package.json has no ssh-implementation dependency (scoped invariant, NOT an equality pin — CONV-022)', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>
    }
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
    for (const name of names) {
      expect(bannedNames.some((b) => name === b || name.startsWith(`${b}-`) || name.startsWith(`${b}/`)),
        `dependency "${name}" looks like an ssh implementation — transport must be the SYSTEM ssh binary (locked decision 1, REQ-007)`).toBe(false)
    }
  })

  it('no remote-client module imports an ssh library and none spawns through a shell', () => {
    for (const f of clientFiles()) {
      const src = readFileSync(f, 'utf8')
      for (const s of importSpecifiers(src)) {
        expect(bannedNames.some((b) => s === b || s.startsWith(`${b}/`)),
          `${f} imports "${s}" — never an SSH library (REQ-007)`).toBe(false)
      }
      expect(/shell:\s*true/.test(src),
        `${f} spawns through a shell — argv must reach ssh unshelled (REQ-007)`).toBe(false)
    }
  })

  it('the default ssh program is literally "ssh" (PATH-resolved system binary)', async () => {
    const mod = await import('../src/remote-client/ssh-spawn')
    expect(mod.DEFAULT_SSH_PROGRAM).toBe('ssh')
  })
})

describe('TEST-2004 REQ-015 remote-client never reads package.json (version is injected)', () => {
  it('no remote-client source references package.json', () => {
    for (const f of clientFiles()) {
      expect(readFileSync(f, 'utf8').includes('package.json'),
        `${f} references package.json — the caller injects the one canonical version (REQ-015)`).toBe(false)
    }
  })
})

describe('TEST-2005 REQ-010 protocol machinery is reused from the barrel, never re-derived', () => {
  it('bootstrap.ts imports decoder/handshake/encode from @shared/remote/protocol', () => {
    const p = resolve(root, 'src/remote-client/bootstrap.ts')
    expect(existsSync(p), 'src/remote-client/bootstrap.ts must exist (REQ-010)').toBe(true)
    const src = readFileSync(p, 'utf8')
    // One import statement from the ONE sanctioned barrel, carrying all three symbols.
    const m = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]@shared\/remote\/protocol['"]/)
    expect(m, 'bootstrap.ts must import from @shared/remote/protocol (REQ-010)').toBeTruthy()
    const names = (m as RegExpMatchArray)[1]
    for (const sym of ['createFrameDecoder', 'createClientHandshake', 'encodeFrame']) {
      expect(names.includes(sym), `bootstrap.ts must import ${sym} from the barrel (REQ-010)`).toBe(true)
    }
  })

  it('no remote-client module hand-constructs a hello frame (the handshake machine owns it)', () => {
    for (const f of clientFiles()) {
      expect(/type:\s*['"]hello['"]/.test(readFileSync(f, 'utf8')),
        `${f} constructs a hello frame literal — the F15 machines own the handshake wire (REQ-010)`).toBe(false)
    }
  })
})

describe('TEST-2006 REQ-018 the fake ssh shim is local and network-free', () => {
  it('tests/fixtures/fake-ssh.mjs exists and imports no network module', () => {
    const p = resolve(root, 'tests/fixtures/fake-ssh.mjs')
    expect(existsSync(p), 'the shim fixture must exist (REQ-018)').toBe(true)
    const specs = importSpecifiers(readFileSync(p, 'utf8'))
    for (const s of specs) {
      expect(['net', 'node:net', 'http', 'node:http', 'https', 'node:https', 'tls', 'node:tls',
        'dgram', 'node:dgram', 'ws'].includes(s),
        `fake-ssh.mjs imports network module "${s}" — the shim must never touch a network (REQ-018)`).toBe(false)
    }
  })
})
