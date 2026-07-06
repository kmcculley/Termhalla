// FROZEN test suite — feature 0023-remote-node-pty-prebuilt (phase 4).
// RE-CUT through the tests phase after the FINDING-013 / ESC-001 / ESC-002 loopback (TEST-2364)
// and RE-CUT AGAIN after the FINDING-020-cluster / ESC-003 loopback, which amended
// REQ-012/REQ-016/REQ-021 and added REQ-026 at the FLOW level:
//   • TEST-2373 — the self-repair vector (FINDING-020): an intact, matching marker over
//     corrupted on-disk pty.node bytes ⇒ the decision is INSTALL (one upload) and the connect
//     reaches hello — never a skip followed by a launch fatal.
//   • TEST-2374/TEST-2349/TEST-2375 — the SINGLE recovery cycle + honest terminal wording
//     (FINDING-021 + the ESC-003 honesty mandate): a module-resolution launch failure after
//     co-provisioning gets exactly ONE re-probe → re-decide → (≤1 install) → relaunch; the
//     terminal diagnostic states what THIS connect actually did (install-ran wording vs
//     found-and-verified skip wording — the two MUST differ); hard cap two probes / two
//     installs / two launches per connect.
//   • TEST-2376 — the glibc-floor hint fires on ANY GLIBC-class launch fatal, decoupled from
//     module-resolution detection, and NEVER triggers the recovery cycle (FINDING-009).
//   • TEST-2377/TEST-2378 — the bounded, early-settling probe channel (FINDING-010): settle on
//     the sentinel without waiting for stream end; a sentinel-less oversized stream is the
//     rc-noise fatal with a cap-bounded excerpt.
//   • TEST-2380..TEST-2382 — RE-CUT a THIRD time (ESC-004 / FINDING-022 + FINDING-024, the
//     loopback-to-tests of 2026-07-06): the LOCAL manifest's `files` map is the ONLY sha source
//     for the payload (marker excepted) — a bundle file with no map entry must NEVER be uploaded
//     under a self-computed sha. The client validates the map's SHAPE (a plain non-array object
//     of non-empty-string shas) and its BIDIRECTIONAL parity with the files actually on disk
//     under the bundle dir (mirroring the release gate's verification), failing with a specific
//     incomplete/malformed-manifest fatal (the REQ-019 class) BEFORE any upload.
// The co-provision flow runs through the amended fake-ssh shim (REQ-025): real child
// processes, the real F15 protocol bytes for the agent leg, a local fake "remote home",
// env-driven rigs — no network, no real ssh, no native code (REQ-024). Every ledger assertion
// is CONV-051-scoped: exact kind sequences / explicit kind filters, never raw-empty asserts.
//
// Chosen contract (frozen here): BootstrapOptions gains `nodePty?: { prebuiltRoot: string }`.
// Absent ⇒ behavior byte-identical to v0.13.0. Present + ptyBackend 'fake' ⇒ no probe, no
// upload. Present + 'node-pty' ⇒ probe → decide → (install | skip | proceed-unmanaged |
// no-match fatal) BEFORE the F19 connect → provision-once → connect sequence. All new failure
// paths surface as the EXISTING kinds 'fatal'/'aborted' (REQ-018). The LOCAL bundle manifest
// (REQ-019) now REQUIRES the `files` map — it is the sha source for every payload header entry.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, cpSync, readdirSync, statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { encodeFrame, WIRE_PROTO } from '@shared/remote/protocol'
import type { WireFrame } from '@shared/remote/protocol'
import { connectWithProvisioning } from '../src/remote-client/bootstrap'
import { remoteAgentInstallPath } from '../src/remote-client/ssh-command'
import { NODE_PTY_MARKER_FILE } from '../src/remote-client/prebuilt'

const root = process.cwd()
const shim = resolve(root, 'tests/fixtures/fake-ssh.mjs')
const stubPkg = resolve(root, 'tests/fixtures/node-pty-stub')
const CLIENT_V = '9.9.9-test'
const TARGET = 'linux-x64-glibc'
const seed = { host: 'fake.example', user: 'ci' }
const ssh = { program: process.execPath, prefixArgs: [shim] }

// Mirrors NODE_PTY_PROBE_STDOUT_CAP (its export + value are pinned by TEST-2368; a literal here
// keeps this file loadable while the constant is unimplemented).
const PROBE_STDOUT_CAP = 65536

const LINUX_TRIPLE = JSON.stringify({ platform: 'linux', arch: 'x64', glibc: '2.31' })
const DARWIN_TRIPLE = JSON.stringify({ platform: 'darwin', arch: 'arm64', glibc: null })

let home = ''
let prebuiltRoot = ''
let logFile = ''
const kills: Array<() => void> = []

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'termhalla-npty-home-'))
  prebuiltRoot = mkdtempSync(join(tmpdir(), 'termhalla-npty-prebuilds-'))
  logFile = join(home, 'fake-ssh-log.jsonl')
  process.env.FAKE_SSH_HOME = home
  process.env.FAKE_SSH_LOG = logFile
  delete process.env.FAKE_SSH_RIG
  delete process.env.FAKE_SSH_PROBE_TRIPLE
})

afterEach(() => {
  for (const k of kills.splice(0)) { try { k() } catch { /* gone */ } }
  delete process.env.FAKE_SSH_RIG
  delete process.env.FAKE_SSH_PROBE_TRIPLE
  delete process.env.FAKE_SSH_LOG
  delete process.env.FAKE_SSH_HOME
  rmSync(home, { recursive: true, force: true })
  rmSync(prebuiltRoot, { recursive: true, force: true })
})

// ── local bundle + canned-agent helpers (the frozen F19 suite's vocabulary) ──────────────────
const PTY_BYTES = Buffer.from('fixture-elf-bytes for 0023 provisioning '.repeat(4))
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

const bundleDir = (): string => join(prebuiltRoot, 'node-pty', TARGET)

/** Relative '/'-normalized paths of every file under dir, sorted. */
const walkFiles = (dir: string): string[] => {
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

/** Stage a local target bundle from the committed pure-JS node-pty stub fixture, with the
 *  ESC-003 manifest shape (the per-file `files` sha map — REQ-001/REQ-014's sha source). */
const makeLocalBundle = (opts?: { omitPtyNode?: boolean; corruptManifest?: boolean }): void => {
  cpSync(stubPkg, bundleDir(), { recursive: true })
  mkdirSync(join(bundleDir(), 'build', 'Release'), { recursive: true })
  if (opts?.omitPtyNode !== true) writeFileSync(join(bundleDir(), 'build', 'Release', 'pty.node'), PTY_BYTES)
  const files: Record<string, string> = {}
  for (const rel of walkFiles(bundleDir())) {
    files[rel] = sha256(readFileSync(join(bundleDir(), ...rel.split('/'))))
  }
  const manifest = { formatVersion: 1, nodePtyVersion: '0.0.0-stub', target: TARGET, ptyNodeSha256: sha256(PTY_BYTES), files }
  writeFileSync(join(bundleDir(), NODE_PTY_MARKER_FILE),
    opts?.corruptManifest === true ? 'not-json{{{' : JSON.stringify(manifest))
}

const hex = (frame: WireFrame): string => Buffer.from(encodeFrame(frame)).toString('hex')
const agentHello = (version: string): WireFrame =>
  ({ type: 'hello', proto: WIRE_PROTO, role: 'agent', version, capabilities: ['pty', 'status'] }) as WireFrame

const cannedAgent = (helloHex: string): string => `
process.stdout.write(Buffer.from('${helloHex}', 'hex'))
process.stdin.on('data', () => {})
process.stdin.on('end', () => process.exit(0))
`

const installedAt = (version: string): string =>
  join(home, remoteAgentInstallPath(undefined, version).slice(2))

const installCannedAgent = (version: string, body?: string): void => {
  const p = installedAt(CLIENT_V)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body ?? cannedAgent(hex(agentHello(version))))
}

/** A runnable canned-agent artifact to upload through the F19 leg. */
const writeArtifact = (): string => {
  const p = join(home, `artifact-${CLIENT_V}.cjs`)
  writeFileSync(p, cannedAgent(hex(agentHello(CLIENT_V))))
  return p
}

const kinds = (): string[] =>
  existsSync(logFile)
    ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => (JSON.parse(l) as { kind: string }).kind)
    : []
const resetLedger = (): void => { rmSync(logFile, { force: true }) }

/** Poll until a ledger/file condition holds — the deterministic alternative to a wall-clock
 *  sleep (this box's probe leg alone costs ~250 ms; fixed timers race it — the recorded
 *  TEST-2352 flake, hardened away in the ESC-003 re-cut). */
const waitUntil = async (pred: () => boolean, what: string, ms = 15_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const remoteNodePtyDir = (): string => join(home, '.termhalla', 'agent', 'node_modules', 'node-pty')

const baseOpts = () => ({
  agent: seed,
  version: CLIENT_V,
  artifactPath: writeArtifact(),
  ptyBackend: 'node-pty' as const,
  ssh,
  nonce: () => 'abc123',
  nodePty: { prebuiltRoot }
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-016/REQ-014/REQ-025 the fresh-host happy path', () => {
  it('TEST-2343 fresh host: EXACTLY [probe, node-pty-install, launch, upload, launch]; the install lands the bundle + marker remotely', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(kinds(), 'one probe, ONE node-pty upload, then the unchanged F19 provision-once sequence (REQ-016)').toEqual(
      ['probe', 'node-pty-install', 'launch', 'upload', 'launch'])
    expect(existsSync(join(remoteNodePtyDir(), NODE_PTY_MARKER_FILE)), 'the marker landed at the final path').toBe(true)
    expect(readFileSync(join(remoteNodePtyDir(), 'build', 'Release', 'pty.node'))).toEqual(PTY_BYTES)
    expect(existsSync(join(remoteNodePtyDir(), 'lib', 'index.js')), 'the whole lib/ tree landed').toBe(true)
    r.session.kill()
  }, 30_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-012 skip — the idempotent steady state', () => {
  it('TEST-2344 a second connect against the installed marker performs ZERO uploads of any kind: exactly [probe, launch]', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    const first = await connectWithProvisioning(baseOpts())
    expect(first.ok, first.ok === false ? first.diagnostic : '').toBe(true)
    if (first.ok) { kills.push(() => first.session.kill()); first.session.kill() }

    resetLedger()
    const second = await connectWithProvisioning(baseOpts())
    expect(second.ok, second.ok === false ? second.diagnostic : '').toBe(true)
    if (!second.ok) return
    kills.push(() => second.session.kill())
    expect(kinds(), 'skip means ZERO upload channels this connect (REQ-012)').toEqual(['probe', 'launch'])
    expect(kinds().filter((k) => k === 'node-pty-install' || k === 'upload')).toEqual([])
    second.session.kill()
  }, 30_000)

  it('TEST-2373 REQ-012/REQ-025 (ESC-003/FINDING-020) SELF-REPAIR: an intact matching marker over CORRUPTED on-disk pty.node bytes ⇒ the decision is install (exactly one node-pty upload), the binary is repaired, and the connect reaches hello — never a skip followed by a launch fatal', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    // First connect: the ordinary install lands (marker + binary + resolvable lib/).
    const first = await connectWithProvisioning(baseOpts())
    expect(first.ok, first.ok === false ? first.diagnostic : '').toBe(true)
    if (first.ok) { kills.push(() => first.session.kill()); first.session.kill() }

    // The npty-preseed-corrupt rig flips one byte of the ON-DISK pty.node right before the
    // probe runs, while the marker stays intact — the FINDING-020 wedge shape.
    process.env.FAKE_SSH_RIG = 'npty-preseed-corrupt'
    resetLedger()
    const second = await connectWithProvisioning(baseOpts())
    expect(second.ok, second.ok === false ? second.diagnostic : '').toBe(true)
    if (!second.ok) return
    kills.push(() => second.session.kill())
    expect(kinds(), 'the ground-truth probe forces a repair install — exactly one node-pty upload, then the launch').toEqual(
      ['probe', 'node-pty-install', 'launch'])
    expect(readFileSync(join(remoteNodePtyDir(), 'build', 'Release', 'pty.node')),
      'the corrupted binary was repaired to the shipped bytes').toEqual(PTY_BYTES)
    second.session.kill()
  }, 30_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-013/REQ-025 no-match is a fatal, actionable diagnostic — never a fallback', () => {
  it('TEST-2345 an unmatched triple with no resolvable node-pty fails fatally: the probe is the ONLY exec channel; the diagnostic names triple, target, and escape hatch', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = DARWIN_TRIPLE
    makeLocalBundle()
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(r.diagnostic).toContain('darwin')
    expect(r.diagnostic).toContain('arm64')
    expect(r.diagnostic).toContain('non-glibc')
    expect(r.diagnostic).toContain('linux-x64-glibc')
    expect(r.diagnostic, 'the manual-install escape hatch is named').toContain('node_modules/node-pty')
    expect(kinds(), 'no launch, no upload — the probe alone (REQ-013)').toEqual(['probe'])
  }, 30_000)

  it('TEST-2346 proceed-unmanaged: an unmatched triple WITH a resolvable node-pty connects with no upload and one unmanaged diagnostic line', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = DARWIN_TRIPLE
    // A manually installed node-pty on the remote (the escape hatch) + an installed agent.
    cpSync(stubPkg, remoteNodePtyDir(), { recursive: true })
    installCannedAgent(CLIENT_V)
    const diags: string[] = []
    // NOTE: prebuiltRoot stays EMPTY — an unmatched-but-resolvable host must not need the
    // local bundle at all (the REQ-019 boundary).
    const r = await connectWithProvisioning({ ...baseOpts(), onDiagnostic: (l) => diags.push(l) })
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(kinds()).toEqual(['probe', 'launch'])
    const unmanaged = diags.filter((l) => /unmanaged/i.test(l))
    expect(unmanaged.length, 'exactly one unmanaged-node-pty diagnostic line').toBe(1)
    expect(unmanaged[0]).toContain('darwin')
    r.session.kill()
  }, 30_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-015/REQ-016/REQ-025 install failures are distinct, fatal, and never loop', () => {
  it('TEST-2347 truncation (sentinel 93): fatal naming the byte-count failure; exactly one install; NO launch follows', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    process.env.FAKE_SSH_RIG = 'npty-truncate:7'
    makeLocalBundle()
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(r.diagnostic).toMatch(/truncat|byte/i)
    expect(r.diagnostic, 'the 93 wording must differ from the 94 wording').not.toMatch(/checksum/i)
    expect(kinds(), 'a failed install never falls through to a launch (REQ-016)').toEqual(['probe', 'node-pty-install'])
    expect(existsSync(remoteNodePtyDir()), 'nothing was promoted').toBe(false)
  }, 30_000)

  it('TEST-2348 corruption (sentinel 94): fatal naming the sha/checksum failure; exactly one install; NO launch; wording differs from 93 — an install failure is TERMINAL, never recovered', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    process.env.FAKE_SSH_RIG = 'npty-corrupt'
    makeLocalBundle()
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(r.diagnostic).toMatch(/sha-?256|checksum/i)
    expect(r.diagnostic).not.toMatch(/truncat/i)
    expect(kinds(), 'exactly one install attempt, then fatal — never a retry loop, never a recovery cycle (REQ-016)').toEqual(['probe', 'node-pty-install'])
    expect(existsSync(remoteNodePtyDir()), 'nothing was promoted').toBe(false)
  }, 30_000)

  it('TEST-2374 REQ-016/REQ-025 (ESC-003/FINDING-021) the SINGLE recovery cycle repairs a transient post-install resolution failure: launch dies once with module-resolution stderr ⇒ re-probe → re-decide → relaunch → hello; the connect SUCCEEDS', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    installCannedAgent(CLIENT_V) // the agent leg is already provisioned — the launches are agent launches
    process.env.FAKE_SSH_RIG = 'npty-launch-die-once:modfail'
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(kinds(), 'exactly [probe, node-pty-install, launch(fail), probe, launch(hello)] — the fresh ground-truth re-probe re-verifies, then ONE relaunch').toEqual(
      ['probe', 'node-pty-install', 'launch', 'probe', 'launch'])
    r.session.kill()
  }, 30_000)

  it('TEST-2349 REQ-016 install ran + the launch dies with module-resolution stderr PERSISTENTLY: exactly ONE recovery cycle (two probes, two launches — never more), then a terminal fatal whose wording states an install WAS applied and re-verified', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    installCannedAgent(CLIENT_V)
    process.env.FAKE_SSH_RIG = 'npty-launch-die:modfail' // EVERY launch dies — the recovery cannot help
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind, 'new failure paths surface through the existing kinds (REQ-018)').toBe('fatal')
    expect(kinds(), 'the hard cap: [probe, node-pty-install, launch, probe, launch] — at most TWO probes, TWO launches, and the one install, ever').toEqual(
      ['probe', 'node-pty-install', 'launch', 'probe', 'launch'])
    expect(kinds().filter((k) => k === 'probe').length).toBe(2)
    expect(kinds().filter((k) => k === 'launch').length).toBe(2)
    expect(kinds().filter((k) => k === 'node-pty-install').length).toBe(1)
    // Honest terminal wording (the ESC-003 mandate): an install DID run this connect.
    expect(r.diagnostic).toMatch(/install was applied/i)
    expect(r.diagnostic, 'the wording states the install was re-verified by the recovery probe').toMatch(/re-?verified|second probe/i)
    expect(r.diagnostic).toContain('node-pty')
  }, 30_000)

  it('TEST-2375 REQ-016 the skip/skip persistent-failure variant: NO install ran this connect, so the terminal wording must NOT claim one — it states a previously installed node-pty was found and verified, plus the remove-and-reconnect escape hatch (wording DIFFERS from the install variant)', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    // First connect: a clean install + agent provision (no rig).
    const first = await connectWithProvisioning(baseOpts())
    expect(first.ok, first.ok === false ? first.diagnostic : '').toBe(true)
    if (first.ok) { kills.push(() => first.session.kill()); first.session.kill() }

    process.env.FAKE_SSH_RIG = 'npty-launch-die:modfail'
    resetLedger()
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(kinds(), 'skip → launch(fail) → recovery probe → skip → launch(fail) — zero installs').toEqual(
      ['probe', 'launch', 'probe', 'launch'])
    expect(kinds().filter((k) => k === 'node-pty-install' || k === 'upload')).toEqual([])
    // Honest terminal wording: NO install ran — never say one was applied (FINDING-021's
    // review found exactly this lie).
    expect(r.diagnostic, 'a skip/skip path must never claim an install was applied').not.toMatch(/install was applied/i)
    expect(r.diagnostic, 'states the on-disk install was found and verified').toMatch(/verif/i)
    expect(r.diagnostic, 'names the escape-hatch path').toContain('node_modules/node-pty')
    expect(r.diagnostic, 'the escape hatch: remove it and reconnect').toMatch(/remove/i)
    expect(r.diagnostic).toMatch(/reconnect/i)
  }, 30_000)

  it('TEST-2376 REQ-021/REQ-025 (ESC-003/FINDING-009) a GLIBC-class launch fatal (NO module-resolution wording) gets the 2.31-floor hint AND never triggers the recovery cycle: [probe, node-pty-install, launch] only', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    installCannedAgent(CLIENT_V)
    process.env.FAKE_SSH_RIG = 'npty-launch-die:glibc'
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(r.diagnostic, 'the glibc-floor hint names the shipped floor — applied on ANY GLIBC-class stderr, independent of module-resolution detection').toContain('2.31')
    expect(r.diagnostic, 'the hint names the manual-install escape hatch').toMatch(/manually install|escape hatch/i)
    expect(kinds(), 'reinstalling the same binary cannot help an old glibc — NO recovery probe/install/relaunch').toEqual(
      ['probe', 'node-pty-install', 'launch'])
  }, 30_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-017/REQ-025 cancellation and indeterminate outcomes', () => {
  it('TEST-2350 an already-aborted signal short-circuits BEFORE any spawn: aborted, nothing written remotely, zero ledger entries', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    const ctl = new AbortController()
    ctl.abort()
    const r = await connectWithProvisioning({ ...baseOpts(), signal: ctl.signal })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('aborted')
    expect(r.indeterminate ?? false).toBe(false)
    expect(r.diagnostic).toMatch(/nothing was written/i)
    expect(kinds()).toEqual([])
  }, 30_000)

  it('TEST-2351 aborting the in-flight probe is DETERMINATE (the probe is read-only): aborted, no indeterminate flag', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    process.env.FAKE_SSH_RIG = 'stall'
    makeLocalBundle()
    const ctl = new AbortController()
    const p = connectWithProvisioning({ ...baseOpts(), signal: ctl.signal })
    setTimeout(() => ctl.abort(), 300)
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('aborted')
    expect(r.indeterminate ?? false).toBe(false)
    expect(kinds()).toEqual(['probe'])
  }, 30_000)

  it('TEST-2352 aborting mid-install is INDETERMINATE with the either-or wording (previous-or-none vs complete verified — never a tear; reconnect resolves it)', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    process.env.FAKE_SSH_RIG = 'npty-stall-install'
    makeLocalBundle()
    const ctl = new AbortController()
    const p = connectWithProvisioning({ ...baseOpts(), signal: ctl.signal })
    // Deterministically mid-install: abort only once the install exec channel is OBSERVED
    // open (its ledger line; the rig stalls that channel forever) — never a wall-clock guess.
    await waitUntil(() => kinds().includes('node-pty-install'), 'the stalled install channel')
    ctl.abort()
    const r = await p
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('aborted')
    expect(r.indeterminate, 'a mid-install abort is honest about the unknown remote state (CONV-015/CONV-034)').toBe(true)
    expect(r.diagnostic).toMatch(/previous/i)
    expect(r.diagnostic).toMatch(/complete/i)
    expect(r.diagnostic).toMatch(/reconnect/i)
    expect(kinds()).toEqual(['probe', 'node-pty-install'])
  }, 30_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-018 strictly additive opt-in; legacy behavior byte-identical', () => {
  it('TEST-2353 option ABSENT: the exec-channel sequence is exactly today\'s [launch, upload, launch] — probe-free, node-pty-free', async () => {
    const opts = baseOpts()
    // Reconstruct v0.13.0 options: NO nodePty field at all.
    const legacy = { agent: opts.agent, version: opts.version, artifactPath: opts.artifactPath, ptyBackend: 'fake' as const, ssh, nonce: opts.nonce }
    const r = await connectWithProvisioning(legacy)
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(kinds()).toEqual(['launch', 'upload', 'launch'])
    r.session.kill()
  }, 30_000)

  it('TEST-2354 option present + ptyBackend fake: no probe, no node-pty upload — the fake backend needs no native module', async () => {
    makeLocalBundle()
    const r = await connectWithProvisioning({ ...baseOpts(), ptyBackend: 'fake' })
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(kinds()).toEqual(['launch', 'upload', 'launch'])
    expect(kinds().filter((k) => k === 'probe' || k === 'node-pty-install')).toEqual([])
    r.session.kill()
  }, 30_000)

  it('TEST-2355 the composition root passes nodePty.prebuiltRoot from the REQ-005 resolver', () => {
    const src = readFileSync(resolve(root, 'src/main/services.ts'), 'utf8')
    expect(src, 'services.ts must import/use resolvePrebuiltRoot').toContain('resolvePrebuiltRoot')
    expect(src, 'services.ts must pass the nodePty option into the bootstrap wiring').toMatch(/nodePty\s*:/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-019 a missing/invalid LOCAL bundle is a specific fatal, before any upload', () => {
  const expectLocalBundleFatal = async (): Promise<void> => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    const norm = (s: string): string => s.replace(/\\/g, '/')
    expect(norm(r.diagnostic), 'the diagnostic names the expected local bundle path').toContain(
      `${norm(prebuiltRoot)}/node-pty/${TARGET}`)
    expect(kinds(), 'the probe is the only exec channel — no partial upload (REQ-019)').toEqual(['probe'])
  }

  it('TEST-2356 an empty prebuiltRoot (no bundle staged at all)', async () => {
    await expectLocalBundleFatal()
  }, 30_000)

  it('TEST-2357 a bundle missing its pty.node', async () => {
    makeLocalBundle({ omitPtyNode: true })
    await expectLocalBundleFatal()
  }, 30_000)

  it('TEST-2358 a corrupt bundle manifest', async () => {
    makeLocalBundle({ corruptManifest: true })
    await expectLocalBundleFatal()
  }, 30_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-014/REQ-019 (ESC-004/FINDING-022+024) the LOCAL manifest files map is the ONLY sha source — unmapped/ghost/malformed maps are a specific fatal BEFORE any upload', () => {
  const manifestPath = (): string => join(bundleDir(), NODE_PTY_MARKER_FILE)
  type ManifestShape = { files: Record<string, string> } & Record<string, unknown>
  const editManifest = (mutate: (m: ManifestShape) => void): void => {
    const m = JSON.parse(readFileSync(manifestPath(), 'utf8')) as ManifestShape
    mutate(m)
    writeFileSync(manifestPath(), JSON.stringify(m))
  }
  const norm = (s: string): string => s.replace(/\\/g, '/')

  it('TEST-2380 the FINDING-022 attack shape: a bundle file TAMPERED on disk and REMOVED from the manifest files map is never uploaded under a self-computed sha — the connect fails in the incomplete-manifest class, naming the unmapped path, with the probe as the ONLY exec channel', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    // The attack: tamper lib/index.js AND delete its files entry. A '?? self-compute' fallback
    // would hash the TAMPERED bytes, the remote unpacker would verify the received file against
    // that self-computed sha, and the tampered code would land and load remotely — defeating
    // manifest-sourced integrity (REQ-014: every payload sha256 is sourced from the local
    // manifest's files map, the marker's own entry excepted).
    writeFileSync(join(bundleDir(), 'lib', 'index.js'), 'module.exports = { tampered: true }\n')
    editManifest((m) => { delete m.files['lib/index.js'] })
    const r = await connectWithProvisioning(baseOpts())
    if (r.ok) kills.push(() => r.session.kill())
    expect(r.ok, 'an on-disk bundle file with no manifest files entry must be a pre-upload fatal, never a self-computed-sha upload').toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(r.diagnostic, 'the incomplete/malformed-manifest class is named (the ESC-004 wording)').toMatch(/incomplete|malformed/i)
    expect(norm(r.diagnostic), 'the diagnostic names the unmapped path').toContain('lib/index.js')
    expect(norm(r.diagnostic), 'the diagnostic names the expected local bundle path (the REQ-019 posture)').toContain(`${norm(prebuiltRoot)}/node-pty/${TARGET}`)
    expect(kinds(), 'the probe is the ONLY exec channel — the fatal fires BEFORE any upload').toEqual(['probe'])
    expect(existsSync(remoteNodePtyDir()), 'nothing landed remotely').toBe(false)
  }, 30_000)

  it('TEST-2381 bidirectional parity: a manifest files entry naming a path ABSENT from the bundle dir (a ghost key) is the same pre-upload fatal, naming that path', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    makeLocalBundle()
    editManifest((m) => { m.files['lib/ghost.js'] = 'a'.repeat(64) })
    const r = await connectWithProvisioning(baseOpts())
    if (r.ok) kills.push(() => r.session.kill())
    expect(r.ok, 'a files entry with no on-disk bundle file must be a pre-upload fatal — parity holds in BOTH directions, mirroring the release gate').toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(r.diagnostic, 'the incomplete/malformed-manifest class is named').toMatch(/incomplete|malformed/i)
    expect(norm(r.diagnostic), 'the diagnostic names the ghost path').toContain('lib/ghost.js')
    expect(norm(r.diagnostic), 'the diagnostic names the expected local bundle path (the REQ-019 posture)').toContain(`${norm(prebuiltRoot)}/node-pty/${TARGET}`)
    expect(kinds(), 'fatal BEFORE any upload').toEqual(['probe'])
    expect(existsSync(remoteNodePtyDir()), 'nothing landed remotely').toBe(false)
  }, 30_000)

  it('TEST-2382 a MALFORMED files field — an array (typeof object!) or an empty-string sha value — is the same pre-upload fatal in the malformed-manifest class, never mirrored as a remote checksum-shaped install failure', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    const variants: Array<{ name: string; mutate: (m: ManifestShape) => void }> = [
      { name: 'files is an array', mutate: (m) => { (m as Record<string, unknown>).files = [] } },
      { name: 'files has an empty-string sha value', mutate: (m) => { m.files['lib/index.js'] = '' } }
    ]
    for (const v of variants) {
      makeLocalBundle()
      editManifest(v.mutate)
      resetLedger()
      const r = await connectWithProvisioning(baseOpts())
      if (r.ok) kills.push(() => r.session.kill())
      expect(r.ok, `${v.name}: must be a pre-upload fatal`).toBe(false)
      if (r.ok) continue
      expect(r.kind, v.name).toBe('fatal')
      expect(r.diagnostic, `${v.name}: the malformed/incomplete-manifest class is named`).toMatch(/malformed|incomplete/i)
      expect(norm(r.diagnostic), `${v.name}: the diagnostic names the expected local bundle path`).toContain(`${norm(prebuiltRoot)}/node-pty/${TARGET}`)
      expect(kinds(), `${v.name}: the probe is the ONLY exec channel — never a 94-shaped install failure`).toEqual(['probe'])
    }
  }, 60_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-009/REQ-025 rc-noise tolerance through the real client path', () => {
  it('TEST-2361 the probe parses through shell-rc noise before and after the sentinel line (the npty-probe-noise rig)', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    process.env.FAKE_SSH_RIG = 'npty-probe-noise'
    makeLocalBundle()
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(kinds()).toEqual(['probe', 'node-pty-install', 'launch', 'upload', 'launch'])
    r.session.kill()
  }, 30_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-026/REQ-025 the bounded, early-settling probe channel (ESC-003/FINDING-010)', () => {
  it('TEST-2377 the probe settles the moment the sentinel is parseable and tears the child down — an endless post-sentinel stdout stream can neither wedge the connect nor grow it unboundedly', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    process.env.FAKE_SSH_RIG = 'npty-probe-endless'
    makeLocalBundle()
    // The 25 s abort is a RED-path guard only: a settle-on-sentinel probe finishes far below
    // it; a client that waits for stream end never would (the rig streams for 120 s).
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 25_000)
    const r = await connectWithProvisioning({ ...baseOpts(), signal: ctl.signal })
    clearTimeout(timer)
    expect(r.ok, r.ok === false ? `the connect must settle on the sentinel, not wait for stream end — got: ${r.diagnostic}` : '').toBe(true)
    if (!r.ok) return
    kills.push(() => r.session.kill())
    expect(kinds()).toEqual(['probe', 'node-pty-install', 'launch', 'upload', 'launch'])
    r.session.kill()
  }, 30_000)

  it('TEST-2378 a sentinel-LESS oversized stream (~200 KiB) is the rc-noise fatal with a stdout excerpt bounded by the stated cap; the probe is the only channel', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    process.env.FAKE_SSH_RIG = 'npty-probe-flood'
    makeLocalBundle()
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(r.diagnostic).toMatch(/rc file|shell rc/i)
    expect(r.diagnostic).toMatch(/stdout/)
    expect(r.diagnostic.length, 'any stdout excerpt in the diagnostic is bounded by the probe-stdout cap (CONV-003)')
      .toBeLessThanOrEqual(PROBE_STDOUT_CAP + 512)
    expect(kinds()).toEqual(['probe'])
  }, 30_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('REQ-015/REQ-016/REQ-025 the divergent promote collision (sentinel 95 — persistent through the replace retry)', () => {
  it('TEST-2364 sentinel 95 mirrors into a DISTINCT concurrent-install-collision fatal that advises reconnect (never truncation/checksum wording); exactly one install; NO launch', async () => {
    process.env.FAKE_SSH_PROBE_TRIPLE = LINUX_TRIPLE
    process.env.FAKE_SSH_RIG = 'npty-race-divergent'
    makeLocalBundle()
    const r = await connectWithProvisioning(baseOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind, 'new failure paths surface through the existing kinds (REQ-018)').toBe('fatal')
    expect(r.diagnostic, 'the collision class is named distinctly').toMatch(/concurrent|collision/i)
    expect(r.diagnostic, '95 advises reconnecting — the next connect probes and repairs deterministically').toMatch(/reconnect/i)
    expect(r.diagnostic, 'a collision never retry-blames the transfer: no truncation wording').not.toMatch(/truncat/i)
    expect(r.diagnostic, 'a collision never retry-blames the transfer: no checksum wording').not.toMatch(/checksum/i)
    expect(kinds(), 'exactly one install attempt, then fatal — never a retry loop (REQ-016)').toEqual(['probe', 'node-pty-install'])
    // The destination keeps the OTHER connect's divergent install — the loser leaves it alone.
    expect(existsSync(join(remoteNodePtyDir(), NODE_PTY_MARKER_FILE)), 'the interposed divergent install is left in place').toBe(true)
    const marker = JSON.parse(readFileSync(join(remoteNodePtyDir(), NODE_PTY_MARKER_FILE), 'utf8')) as { ptyNodeSha256: string }
    expect(marker.ptyNodeSha256).toBe('d'.repeat(64))
  }, 30_000)
})
