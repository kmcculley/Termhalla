// Test suite — feature 0024-agent-daemonization (phase 4, revision 2 — re-derived after the
// ESC-001 loop-back; REQ-003/007/013/014 as amended per FINDING-016/D6′).
// Structural guards over THIS feature's own files (CONV-022-safe: every pin is keyed to
// feature-specific surfaces per CONV-037, anchored per CONV-032): scope confinement (REQ-014),
// the local-only/no-TCP posture (REQ-003), the bridge's ZERO-file-removal invariant
// (REQ-007/FINDING-016 — all reclaim lives in the daemon's serialized claim), and the
// per-workspace production wiring (REQ-013/REQ-018).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { SCHEMA_VERSION } from '@shared/types'

const root = process.cwd()

const AGENT_FEATURE_FILES = [
  'src/agent/daemon-constants.ts',
  'src/agent/daemon-lifecycle.ts',
  'src/agent/daemon-guard.ts',
  'src/agent/spawn-daemon.ts',
  'src/agent/daemon-server.ts',
  'src/agent/bridge.ts'
]
const CLIENT_FEATURE_FILES = [
  'src/remote-client/ws-token.ts',
  'src/remote-client/bridge-status.ts',
  'src/remote-client/bootstrap-daemon.ts'
]
const SHARED_FEATURE_FILES = [
  'src/shared/remote/daemon-handshake.ts'
]
const FEATURE_FILES = [...AGENT_FEATURE_FILES, ...CLIENT_FEATURE_FILES, ...SHARED_FEATURE_FILES]

const walk = (dir: string, exts: string[]): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, exts))
    else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

/** Every import/require/dynamic-import specifier in a source text (the TEST-751 extractor). */
const importSpecifiers = (src: string): string[] => {
  const out: string[] = []
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1])
  return out
}

describe('TEST-2437 REQ-014 scope confinement: the feature files exist and touch no Electron/persistence surface', () => {
  it('every planned module exists (03-plan.md revision-2 target layout)', () => {
    for (const rel of FEATURE_FILES) {
      expect(existsSync(resolve(root, rel)), `${rel} must exist (03-plan.md target layout)`).toBe(true)
    }
  })

  it('no feature file references SCHEMA_VERSION, Electron userData APIs, ipcMain, or contextBridge', () => {
    for (const rel of FEATURE_FILES) {
      const src = readFileSync(resolve(root, rel), 'utf8')
      for (const banned of ['SCHEMA_VERSION', 'userData', 'ipcMain', 'contextBridge']) {
        expect(src.includes(banned), `${rel} must not reference ${banned} (REQ-014)`).toBe(false)
      }
    }
  })

  it('SCHEMA_VERSION is untouched by this feature (v9, the 0022 value)', () => {
    expect(SCHEMA_VERSION).toBe(9)
  })
})

describe('TEST-2438 REQ-003/REQ-014 local-only endpoint: no TCP/network listener surface in the daemon/bridge modules', () => {
  it('the feature files import no network module beyond node:net, and never listen on a numeric port', () => {
    let netImports = 0
    for (const rel of FEATURE_FILES) {
      const src = readFileSync(resolve(root, rel), 'utf8')
      for (const s of importSpecifiers(src)) {
        const bare = s.replace(/^node:/, '')
        expect(['http', 'https', 'http2', 'tls', 'dgram', 'dns'].includes(bare),
          `${rel} imports the network module "${s}" — the daemon is a filesystem-IPC endpoint only (REQ-003)`).toBe(false)
        if (bare === 'net') netImports++
      }
      expect(/\.listen\(\s*\d/.test(src),
        `${rel} listens on a numeric port — the daemon listens ONLY on a path (REQ-003)`).toBe(false)
      expect(/\bconnect\(\s*\d/.test(src),
        `${rel} dials a numeric port — the bridge connects ONLY to a path (REQ-003)`).toBe(false)
    }
    expect(netImports, 'the daemon/bridge genuinely use node:net path endpoints (anti-vacuity)').toBeGreaterThanOrEqual(1)
  })
})

describe('TEST-2457 REQ-007 the bridge NEVER removes a file — all reclaim lives in the daemon\'s serialized claim (FINDING-016)', () => {
  it('src/agent/bridge.ts contains no unlink/rm surface at all', () => {
    const src = readFileSync(resolve(root, 'src/agent/bridge.ts'), 'utf8')
    for (const banned of ['unlink', 'rmSync', 'rmdir', 'removeIfExists', 'rm(']) {
      expect(src.includes(banned),
        `src/agent/bridge.ts contains "${banned}" — an unguarded bridge-side check-then-unlink can orphan a live daemon (FINDING-016); the daemon's critical section owns ALL reclaim`).toBe(false)
    }
  })
})

describe('TEST-2439 REQ-014 isolation: renderer/preload never touch the feature; the socket contract stays agent-tree-only', () => {
  it('src/renderer and src/preload contain no reference to this feature\'s exported surfaces', () => {
    const offenders: string[] = []
    for (const tree of ['src/renderer', 'src/preload']) {
      const dir = resolve(root, tree)
      if (!existsSync(dir)) continue
      for (const f of walk(dir, ['.ts', '.tsx'])) {
        const src = readFileSync(f, 'utf8')
        for (const name of [
          'BRIDGE_DAEMON_UNREACHABLE_EXIT', 'TERMHALLA_BRIDGE_V1', 'daemon-protocol-drift',
          'DAEMON_PROTO_COMPAT', 'deriveWsToken', 'bootstrap-daemon', 'bridge-status',
          'daemon-constants', 'daemon-handshake'
        ]) {
          if (src.includes(name)) offenders.push(`${f} -> ${name}`)
        }
      }
    }
    expect(offenders, `zero renderer change (REQ-013/REQ-014): ${offenders.join(', ')}`).toEqual([])
  })

  it('no src/remote-client file imports the agent tree — the bridge is the only socket consumer', () => {
    const offenders: string[] = []
    for (const f of walk(resolve(root, 'src/remote-client'), ['.ts'])) {
      for (const s of importSpecifiers(readFileSync(f, 'utf8'))) {
        // 'agent' as a complete path segment (never a substring like 'remote-agents' — CONV-037).
        if (s.split('/').includes('agent')) offenders.push(`${f} -> ${s}`)
      }
    }
    expect(offenders, `socket/metadata/log path constants are agent-tree-only (REQ-014): ${offenders.join(', ')}`).toEqual([])
  })
})

describe('TEST-2440 REQ-013/REQ-018 production wires the daemon flow on PER WORKSPACE (the TEST-2355 pattern)', () => {
  it('the main-side wiring passes daemon: { workspaceId … } — the per-workspace scope, never a bare boolean', () => {
    const candidates = [resolve(root, 'src/main/services.ts')]
    const remoteDir = resolve(root, 'src/main/remote')
    if (existsSync(remoteDir)) candidates.push(...walk(remoteDir, ['.ts']))
    const wired = candidates.some((f) => /daemon\s*:\s*\{\s*workspaceId/.test(readFileSync(f, 'utf8')))
    expect(wired,
      'src/main must opt production connects into the daemon flow with the workspace id as the scope (REQ-013/REQ-018 — the per-workspace daemon is what preserves same-host coexistence)').toBe(true)
  })
})
