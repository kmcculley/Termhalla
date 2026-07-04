// FROZEN test suite — feature 0020-ssh-tunnel-provisioned-bootstrap (phase 4).
// Bootstrap integration through the fake ssh shim (REQ-010..REQ-016): real child processes, the
// real F15 protocol bytes, a local fake "remote home" — no network, no real ssh, no real agent
// build (the gold real-bundle proof is tests/remote-client-gold.test.ts / TEST-2033).
//
// The "agents" here are canned-bytes scripts GENERATED per test with the real encodeFrame — an
// intentionally independent peer implementation driving the client over the identical stdio
// protocol path (locked decision 1).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { encodeFrame, WIRE_PROTO } from '@shared/remote/protocol'
import type { WireFrame } from '@shared/remote/protocol'
import {
  connectAgent, provisionAgent, connectWithProvisioning
} from '../src/remote-client/bootstrap'
import { remoteAgentInstallPath } from '../src/remote-client/ssh-command'

const root = process.cwd()
const shim = resolve(root, 'tests/fixtures/fake-ssh.mjs')
const CLIENT_V = '9.9.9-test'
const seed = { host: 'fake.example', user: 'ci' }
const ssh = { program: process.execPath, prefixArgs: [shim] }

let home = ''
let logFile = ''
const kills: Array<() => void> = []

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'termhalla-fake-home-'))
  logFile = join(home, 'fake-ssh-log.jsonl')
  process.env.FAKE_SSH_HOME = home
  process.env.FAKE_SSH_LOG = logFile
  delete process.env.FAKE_SSH_RIG
})

afterEach(() => {
  for (const k of kills.splice(0)) { try { k() } catch { /* gone */ } }
  delete process.env.FAKE_SSH_RIG
  delete process.env.FAKE_SSH_LOG
  delete process.env.FAKE_SSH_HOME
  rmSync(home, { recursive: true, force: true })
})

const hex = (frame: WireFrame): string => Buffer.from(encodeFrame(frame)).toString('hex')

/** Byte length of the client's reply hello — the canned agent answers only after receiving
 *  MORE than this, proving the follow-up req actually crossed the pipe. */
const replyLen = (): number =>
  encodeFrame({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: CLIENT_V } as WireFrame).length

/** A canned-bytes fake agent: emits `helloHex` immediately; optionally emits `resHex` once the
 *  total bytes received on stdin exceed `afterBytes`; exits 0 on stdin end. */
const cannedAgent = (helloHex: string, resHex?: string, afterBytes?: number): string => `
let seen = 0, sent = false
process.stdout.write(Buffer.from('${helloHex}', 'hex'))
process.stdin.on('data', (c) => {
  seen += c.length
  ${resHex ? `if (!sent && seen > ${afterBytes ?? 0}) { sent = true; process.stdout.write(Buffer.from('${resHex}', 'hex')) }` : ''}
})
process.stdin.on('end', () => process.exit(0))
`

const agentHello = (version: string): WireFrame =>
  ({ type: 'hello', proto: WIRE_PROTO, role: 'agent', version, capabilities: ['pty', 'status'] }) as WireFrame

/** Resolve the builder's `~/`-rooted install path inside the fake home. */
const installedAt = (version: string, dir?: string): string => {
  const remote = remoteAgentInstallPath(dir, version)
  return join(home, remote.slice(2))
}

const installCannedAgent = (version: string, opts?: { atVersion?: string; dir?: string; ping?: boolean }): string => {
  const p = installedAt(opts?.atVersion ?? CLIENT_V, opts?.dir)
  mkdirSync(join(p, '..'), { recursive: true })
  const res = opts?.ping ? hex({ type: 'res', id: 1, ok: true, result: { pong: true } } as WireFrame) : undefined
  writeFileSync(p, cannedAgent(hex(agentHello(version)), res, replyLen()))
  return p
}

/** Write a standalone artifact file (a runnable canned agent) to upload. */
const writeArtifact = (version: string): string => {
  const p = join(home, `artifact-${version}.cjs`)
  writeFileSync(p, cannedAgent(hex(agentHello(version)), hex({ type: 'res', id: 1, ok: true, result: { pong: true } } as WireFrame), replyLen()))
  return p
}

const logEntries = (): Array<{ kind: string }> =>
  existsSync(logFile)
    ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []
const countKind = (kind: string): number => logEntries().filter((e) => e.kind === kind).length

const waitFor = async <T>(pick: () => T | undefined, what: string, ms = 10_000): Promise<T> => {
  const deadline = Date.now() + ms
  for (;;) {
    const got = pick()
    if (got !== undefined) return got
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const baseOpts = () => ({
  agent: seed, version: CLIENT_V, ptyBackend: 'fake' as const, ssh, nonce: () => 'abc123'
})

describe('TEST-2020 REQ-010 connect: handshake + duplex req/res over the child stdio', () => {
  it('handshakes with an installed agent and round-trips one req/res', async () => {
    installCannedAgent(CLIENT_V, { ping: true })
    const r = await connectAgent(baseOpts())
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(r.session.version).toBe(CLIENT_V)
    expect([...r.session.capabilities].sort()).toEqual(['pty', 'status'])
    expect(typeof r.session.onExit).toBe('function')
    const frames: WireFrame[] = []
    r.session.onFrame((f) => frames.push(f))
    r.session.send({ type: 'req', id: 1, method: 'ping', params: null } as WireFrame)
    const res = await waitFor(
      () => frames.find((f) => (f as { type?: string; id?: number }).type === 'res' && (f as { id?: number }).id === 1),
      'the canned res frame'
    )
    expect((res as { ok?: boolean }).ok).toBe(true)
    r.session.kill()
  }, 30_000)
})

describe('TEST-2021/TEST-2022/TEST-2023 REQ-011 connect failure classification', () => {
  it('empty remote home → absent (exit 127, zero frames)', async () => {
    const r = await connectAgent(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('absent')
  }, 30_000)

  it('installed agent with a different version → version-mismatch', async () => {
    installCannedAgent('0.0.1-wrong')
    const r = await connectAgent(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('version-mismatch')
  }, 30_000)

  it('transport failure (exit 255) → fatal with the stderr excerpt; never provisionable', async () => {
    process.env.FAKE_SSH_RIG = 'exit255'
    const r = await connectAgent(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(r.diagnostic).toMatch(/permission denied/i)
    expect(countKind('upload'), 'a fatal classification must never trigger an upload (REQ-011)').toBe(0)
  }, 30_000)
})

describe('TEST-2024/TEST-2025 REQ-012 provisioning upload', () => {
  it('uploads byte-identical, atomically, leaving no temp file', async () => {
    const artifact = writeArtifact(CLIENT_V)
    const r = await provisionAgent({ ...baseOpts(), artifactPath: artifact })
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    const final = installedAt(CLIENT_V)
    expect(readFileSync(final)).toEqual(readFileSync(artifact))
    const leftovers = readdirSync(join(final, '..')).filter((n) => n.endsWith('.tmp'))
    expect(leftovers, 'no temp file may survive a completed upload (REQ-012)').toEqual([])
  }, 30_000)

  it('a truncated stream is never promoted: size-mismatch sentinel 93, final path absent', async () => {
    process.env.FAKE_SSH_RIG = 'truncate:100'
    const artifact = writeArtifact(CLIENT_V)
    expect(statSync(artifact).size).toBeGreaterThan(100)
    const r = await provisionAgent({ ...baseOpts(), artifactPath: artifact })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('size-mismatch')
    expect(r.exitCode).toBe(93)
    expect(existsSync(installedAt(CLIENT_V)), 'a partial artifact must never occupy the final path').toBe(false)
    const agentDir = join(installedAt(CLIENT_V), '..')
    const leftovers = existsSync(agentDir) ? readdirSync(agentDir).filter((n) => n.endsWith('.tmp')) : []
    expect(leftovers, 'the remote command removes its temp file on mismatch').toEqual([])
  }, 30_000)
})

describe('REQ-014 orchestration: classify → provision → retry ONCE (TEST-2026, TEST-2027, TEST-2028, TEST-2029)', () => {
  it('TEST-2026 absent → provision → connected (the uploaded artifact IS the agent that then serves)', async () => {
    const artifact = writeArtifact(CLIENT_V)
    const r = await connectWithProvisioning({ ...baseOpts(), artifactPath: artifact })
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(r.session.version).toBe(CLIENT_V)
    expect(existsSync(installedAt(CLIENT_V))).toBe(true)
    expect(countKind('upload')).toBe(1)
    expect(countKind('launch')).toBe(2)
    r.session.kill()
  }, 30_000)

  it('TEST-2027 version-mismatch → provision overwrites → connected', async () => {
    installCannedAgent('0.0.1-wrong')
    const artifact = writeArtifact(CLIENT_V)
    const r = await connectWithProvisioning({ ...baseOpts(), artifactPath: artifact })
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(r.session.version).toBe(CLIENT_V)
    expect(countKind('upload')).toBe(1)
    r.session.kill()
  }, 30_000)

  it('TEST-2028 provision that does not take effect → provision-ineffective after exactly 2 connects + 1 upload', async () => {
    process.env.FAKE_SSH_RIG = 'ignore-upload'
    installCannedAgent('0.0.1-wrong')
    const artifact = writeArtifact(CLIENT_V)
    const r = await connectWithProvisioning({ ...baseOpts(), artifactPath: artifact })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('provision-ineffective')
    expect(r.diagnostic).toMatch(/version-mismatch/)
    expect(countKind('launch'), 'exactly two connect attempts — never a loop (REQ-014)').toBe(2)
    expect(countKind('upload'), 'exactly one provision attempt (REQ-014)').toBe(1)
  }, 30_000)

  it('TEST-2029 fatal transport failure short-circuits: no provisioning, no retry', async () => {
    process.env.FAKE_SSH_RIG = 'exit255'
    const artifact = writeArtifact(CLIENT_V)
    const r = await connectWithProvisioning({ ...baseOpts(), artifactPath: artifact })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(countKind('upload')).toBe(0)
    expect(countKind('launch')).toBe(1)
  }, 30_000)
})

describe('TEST-2030/TEST-2031 REQ-016 abort semantics', () => {
  it('aborting mid-upload settles as aborted + INDETERMINATE (CONV-015) and kills the child', async () => {
    process.env.FAKE_SSH_RIG = 'stall'
    const artifact = writeArtifact(CLIENT_V)
    const ctl = new AbortController()
    const p = provisionAgent({ ...baseOpts(), artifactPath: artifact, signal: ctl.signal })
    setTimeout(() => ctl.abort(), 300)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('aborted')
    expect(r.indeterminate, 'an aborted upload may or may not have landed — the outcome is indeterminate (CONV-015)').toBe(true)
  }, 30_000)

  it('aborting before the agent hello settles the connect as aborted (no write happened — determinate)', async () => {
    process.env.FAKE_SSH_RIG = 'stall'
    const ctl = new AbortController()
    const p = connectAgent({ ...baseOpts(), signal: ctl.signal })
    setTimeout(() => ctl.abort(), 300)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('aborted')
    expect(r.indeterminate ?? false).toBe(false)
  }, 30_000)
})

describe('TEST-2032 REQ-015 one canonical version drives both the handshake and the install path', () => {
  it('a custom remoteAgentDir + the injected version places and serves the same artifact', async () => {
    const artifact = writeArtifact(CLIENT_V)
    const agent = { ...seed, remoteAgentDir: '~/custom-agents' }
    const r = await connectWithProvisioning({ ...baseOpts(), agent, artifactPath: artifact })
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(r.session.version).toBe(CLIENT_V)
    expect(existsSync(join(home, 'custom-agents', `termhalla-agent-${CLIENT_V}.cjs`)),
      'the artifact lands at remoteAgentInstallPath(agent.remoteAgentDir, version) — the SAME version the handshake used (REQ-015)').toBe(true)
    r.session.kill()
  }, 30_000)
})
