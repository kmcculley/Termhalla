// FROZEN test suite — feature 0023-remote-node-pty-prebuilt (phase 4).
// REQ-020 end to end (windows-latest-safe, native-free): after co-provisioning, the REAL agent
// bundle — built on demand through the SAME vite.agent.config.ts `npm run build` uses — is
// launched with --pty=node-pty and its lazy `import('node-pty')` (frozen TEST-755, untouched)
// resolves PURELY BY MODULE PLACEMENT from <agentDir>/node_modules/node-pty: the co-provisioned
// bundle whose lib/ is the pure-JS node-pty-surface stub (tests/fixtures/node-pty-stub). Hello
// establishes and one pty:spawn → pty:data round trip works over the identical protocol path
// production runs over ssh.
// RE-CUT through the tests phase after the FINDING-020-cluster / ESC-003 loopback: the staged
// fixture bundle now carries the amended manifest shape (the per-file `files` sha map), and
// TEST-2379 adds the MANDATED flow-level concurrency vector — two overlapping
// connectWithProvisioning calls against the SAME fresh fake home must BOTH reach hello, with
// exactly one final install equal to the shipped bundle and no *.tmp dir remaining (the
// REQ-015 reader-atomic promote + the REQ-016 recovery cycle make this hold at the FLOW level,
// not merely at the unpacker level).
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, cpSync, readdirSync, statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { CH } from '@shared/ipc-contract'
import type { WireFrame, EvtFrame, ResFrame } from '@shared/remote/protocol'
import { connectWithProvisioning, type AgentSessionHandle } from '../src/remote-client/bootstrap'
import { remoteAgentInstallPath } from '../src/remote-client/ssh-command'
import { NODE_PTY_MARKER_FILE } from '../src/remote-client/prebuilt'

const root = process.cwd()
const shim = resolve(root, 'tests/fixtures/fake-ssh.mjs')
const stubPkg = resolve(root, 'tests/fixtures/node-pty-stub')
const pkgVersion = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version
const TARGET = 'linux-x64-glibc'
const seed = { host: 'fake.example', user: 'ci' }
const ssh = { program: process.execPath, prefixArgs: [shim] }

let outDir = ''
let bundlePath = ''
let home = ''
let prebuiltRoot = ''
let logFile = ''
const liveSessions: AgentSessionHandle[] = []

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'termhalla-npty-it-'))
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'), // the SAME config npm run build uses
    logLevel: 'error',
    build: { outDir, emptyOutDir: true }
  })
  bundlePath = join(outDir, 'termhalla-agent.cjs')
}, 240_000)

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'termhalla-npty-it-home-'))
  prebuiltRoot = mkdtempSync(join(tmpdir(), 'termhalla-npty-it-prebuilds-'))
  logFile = join(home, 'fake-ssh-log.jsonl')
  process.env.FAKE_SSH_HOME = home
  process.env.FAKE_SSH_LOG = logFile
  process.env.FAKE_SSH_PROBE_TRIPLE = JSON.stringify({ platform: 'linux', arch: 'x64', glibc: '2.31' })
  delete process.env.FAKE_SSH_RIG
})

afterEach(() => {
  for (const s of liveSessions.splice(0)) { try { s.kill() } catch { /* gone */ } }
  delete process.env.FAKE_SSH_RIG
  delete process.env.FAKE_SSH_PROBE_TRIPLE
  delete process.env.FAKE_SSH_LOG
  delete process.env.FAKE_SSH_HOME
  rmSync(home, { recursive: true, force: true })
  rmSync(prebuiltRoot, { recursive: true, force: true })
})

afterAll(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }) })

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

const kinds = (): string[] =>
  existsSync(logFile)
    ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => (JSON.parse(l) as { kind: string }).kind)
    : []

/** Relative '/'-normalized paths of every file under dir, sorted. */
const tree = (dir: string): string[] => {
  const out: string[] = []
  const walk = (d: string, prefix: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p, `${prefix}${name}/`)
      else out.push(`${prefix}${name}`)
    }
  }
  walk(dir, '')
  return out.sort()
}

/** Stage the fixture target bundle (the pure-JS stub as lib/, arbitrary bytes as pty.node) with
 *  the ESC-003 manifest shape: the per-file `files` sha map, the payload's sha source. */
const stageStubBundle = (): { ptyBytes: Buffer } => {
  const bundleDir = join(prebuiltRoot, 'node-pty', TARGET)
  cpSync(stubPkg, bundleDir, { recursive: true })
  mkdirSync(join(bundleDir, 'build', 'Release'), { recursive: true })
  const ptyBytes = Buffer.from('arbitrary fixture bytes standing in for pty.node (never dlopened by the stub)')
  writeFileSync(join(bundleDir, 'build', 'Release', 'pty.node'), ptyBytes)
  const files: Record<string, string> = {}
  for (const rel of tree(bundleDir)) {
    files[rel] = sha256(readFileSync(join(bundleDir, ...rel.split('/'))))
  }
  writeFileSync(join(bundleDir, NODE_PTY_MARKER_FILE), JSON.stringify({
    formatVersion: 1, nodePtyVersion: '0.0.0-stub', target: TARGET,
    ptyNodeSha256: sha256(ptyBytes), files
  }))
  return { ptyBytes }
}

const waitFor = async <T>(pick: () => T | undefined, what: string, ms = 60_000): Promise<T> => {
  const deadline = Date.now() + ms
  for (;;) {
    const got = pick()
    if (got !== undefined) return got
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('TEST-2359 REQ-020 the agent bare import resolves after co-provision — hello + a pty round trip through the real bundle', () => {
  it('co-provisions the stub bundle, launches --pty=node-pty, and serves pty:spawn → pty:data', async () => {
    stageStubBundle()

    const r = await connectWithProvisioning({
      agent: seed,
      version: pkgVersion, // the ONE manifest version the real bundle inlined
      artifactPath: bundlePath,
      ptyBackend: 'node-pty',
      ssh,
      nonce: () => 'cafe01',
      nodePty: { prebuiltRoot }
    })
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    liveSessions.push(r.session)
    expect(r.session.version).toBe(pkgVersion)
    expect([...r.session.capabilities].sort(), 'the REAL artifact hello').toEqual(['pty', 'status'])
    expect(kinds()).toEqual(['probe', 'node-pty-install', 'launch', 'upload', 'launch'])

    // Resolution happened purely by module placement: the stub sits at the remote install dir
    // and the uploaded agent artifact is byte-identical to the built bundle (no native payload
    // was folded into the .cjs).
    const agentDirLocal = join(home, '.termhalla', 'agent')
    expect(existsSync(join(agentDirLocal, 'node_modules', 'node-pty', 'lib', 'index.js'))).toBe(true)
    const installed = join(home, remoteAgentInstallPath(undefined, pkgVersion).slice(2))
    expect(readFileSync(installed)).toEqual(readFileSync(bundlePath))

    // One pty:spawn → pty:data round trip through the stub-backed real backend.
    const frames: WireFrame[] = []
    r.session.onFrame((f) => frames.push(f))
    const res = (id: number): ResFrame | undefined =>
      frames.find((f): f is ResFrame => f.type === 'res' && f.id === id)
    const dataText = (paneId: string): string =>
      frames
        .filter((f): f is EvtFrame => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === paneId)
        .map((f) => String(f.args[1]))
        .join('')

    r.session.send({
      type: 'req', id: 1, method: CH.ptySpawn,
      params: { id: 'np-1', shellId: 'default', cwd: '/home/remote', cols: 80, rows: 24 }
    } as WireFrame)
    const spawned = await waitFor(() => res(1), 'the pty:spawn res')
    expect(spawned.ok, JSON.stringify(spawned)).toBe(true)

    await waitFor(() => (dataText('np-1').includes('stub-ready') ? true : undefined), 'the stub-ready pty:data')

    r.session.send({ type: 'req', id: 2, method: CH.ptyWrite, params: { id: 'np-1', data: 'ping-0023\n' } } as WireFrame)
    await waitFor(() => (dataText('np-1').includes('ping-0023') ? true : undefined), 'the echoed pty:data')

    r.session.kill()
  }, 120_000)
})

describe('TEST-2379 REQ-020 the flow-level concurrency vector (mandated by ESC-003/FINDING-021)', () => {
  it('two overlapping connectWithProvisioning calls against the SAME fresh fake home BOTH reach hello; the remote holds exactly ONE final install equal to the shipped bundle; no *.tmp dir remains', async () => {
    const { ptyBytes } = stageStubBundle()
    const shippedTree = tree(join(prebuiltRoot, 'node-pty', TARGET))

    // Distinct nonces (crypto-random in production; injected here) keep the two connects'
    // temp paths distinct — exactly the production shape of a double-connect race. Both are
    // fired before either resolves, so their probe/install/launch windows overlap; the
    // race-tolerant promote + the recovery cycle make BOTH outcomes hello REGARDLESS of the
    // exact interleaving the scheduler produces.
    const mkOpts = (nonce: string) => ({
      agent: seed,
      version: pkgVersion,
      artifactPath: bundlePath,
      ptyBackend: 'node-pty' as const,
      ssh,
      nonce: () => nonce,
      nodePty: { prebuiltRoot }
    })
    const [a, b] = await Promise.all([
      connectWithProvisioning(mkOpts('aaaa01')),
      connectWithProvisioning(mkOpts('bbbb02'))
    ])
    expect(a.ok, a.ok === false ? `connect A failed: ${a.diagnostic}` : '').toBe(true)
    expect(b.ok, b.ok === false ? `connect B failed: ${b.diagnostic}` : '').toBe(true)
    if (a.ok) liveSessions.push(a.session)
    if (b.ok) liveSessions.push(b.session)
    if (!a.ok || !b.ok) return
    expect(a.session.version).toBe(pkgVersion)
    expect(b.session.version).toBe(pkgVersion)

    // Exactly one final install, byte-equal to the shipped bundle; no temp leftovers.
    const nm = join(home, '.termhalla', 'agent', 'node_modules')
    expect(readdirSync(nm).filter((n) => n.includes('.tmp')), 'no *.tmp dir may survive the race').toEqual([])
    expect(readdirSync(nm).filter((n) => n === 'node-pty').length).toBe(1)
    const finalDir = join(nm, 'node-pty')
    expect(tree(finalDir), 'the final install holds exactly the shipped bundle file set').toEqual(shippedTree)
    expect(readFileSync(join(finalDir, 'build', 'Release', 'pty.node'))).toEqual(ptyBytes)
    const marker = JSON.parse(readFileSync(join(finalDir, NODE_PTY_MARKER_FILE), 'utf8')) as { ptyNodeSha256: string }
    expect(marker.ptyNodeSha256).toBe(sha256(ptyBytes))

    // The mandated per-connect caps still hold under concurrency: each connect performs at
    // most two probes and two node-pty installs (CONV-051-scoped kind filters).
    expect(kinds().filter((k) => k === 'probe').length).toBeLessThanOrEqual(4)
    expect(kinds().filter((k) => k === 'node-pty-install').length).toBeLessThanOrEqual(4)

    a.session.kill()
    b.session.kill()
  }, 120_000)
})
