// FROZEN test suite — feature 0023-remote-node-pty-prebuilt (phase 4).
// RE-CUT through the tests phase after the FINDING-013 / ESC-001 / ESC-002 loopback (the
// race-tolerant promote, TEST-2360/2362/2363) and RE-CUT AGAIN after the FINDING-020-cluster /
// ESC-003 loopback, which amended REQ-008/REQ-014/REQ-015:
//   • PROBE_SRC now reports the GROUND-TRUTH `actualPtyNodeSha256` — the sha-256 of the bytes
//     ACTUALLY on disk, never the marker's claim (TEST-2335/2336 amended; TEST-2369/2370 new).
//   • UNPACK_SRC verifies EVERY received file's sha-256 against its own header entry, not only
//     pty.node (TEST-2371 — the FINDING-005 equal-length substitution shape ⇒ exit 94).
//   • The promote is RENAME-FIRST, reader-atomic: rename with NO prior rm; on a collision read
//     the now-present marker — equal sha ⇒ remove own temp, exit 0 (benign lost race; the final
//     dir is NEVER removed); absent/unparseable/different ⇒ remove the final dir and retry the
//     rename EXACTLY once (the ordinary clean-reinstall path — TEST-2372); a SECOND collision on
//     the retry ⇒ remove own temp, leave the destination, exit 95 (TEST-2362/2363, now driven
//     with the interposer's PERSISTENT mode so the divergent install reappears after the retry).
//     A collision is NEVER exit 93.
//
// The two embedded remote scripts executed under the LOCAL node (platform-agnostic by spec;
// this is exactly how the fake-ssh shim runs them, and how a remote Linux host's node runs
// them in production):
//   PROBE_SRC   — REQ-008: one sentinel line, SEVEN fields, exit 0 even when everything is bad.
//   UNPACK_SRC  — REQ-014/REQ-015: NODE_PTY_PAYLOAD_V1 stdin → per-file-verified, transactional,
//                 reader-atomic promote under <agentDir>/node_modules/node-pty; sentinels
//                 93/94/95; defense-in-depth path re-validation before any write.
//
// The concurrency harness (tests/fixtures/npty-race-interpose.cjs, `node --require`-preloaded)
// deterministically interposes "the other connect's" promoted install at the rename destination
// (all three fs rename APIs wrapped), so the REAL rename throws the genuine platform collision
// error (ENOTEMPTY/EEXIST on POSIX; EPERM under this local-node Windows harness). Its ESC-003
// additions: NPTY_INTERPOSE_EVERY (re-inject before EVERY node-pty rename — the persistent
// divergent racer whose only legal outcome is 95) and NPTY_INTERPOSE_LOG (an observe-only
// {op: 'rename'|'rm', path} ledger over node-pty-basename targets — the seam proving the
// promote is rename-FIRST and that an identical-install loser never removes the final dir).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, cpSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  PROBE_SRC, UNPACK_SRC, encodeNodePtyPayload,
  NODE_PTY_MARKER_FILE, NODE_PTY_PROBE_SENTINEL, NODE_PTY_BYTES_EXIT, NODE_PTY_SHA_EXIT
} from '../src/remote-client/prebuilt'

// The ESC-001/ESC-002 wire value, asserted literally here (the constant export itself is
// pinned by TEST-2334): a divergent promote collision persisting through the single replace
// retry exits 95 — never 93.
const RACE_EXIT = 95

const INTERPOSE = resolve(process.cwd(), 'tests/fixtures/npty-race-interpose.cjs')

let agentDir = ''
const NONCE = 'cafe01'

beforeEach(() => { agentDir = mkdtempSync(join(tmpdir(), 'termhalla-npty-agentdir-')) })
afterEach(() => { rmSync(agentDir, { recursive: true, force: true }) })

const runScript = (src: string, args: string[], input?: Buffer): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, ['-e', src, ...args], {
    encoding: 'buffer', windowsHide: true, ...(input !== undefined ? { input } : {})
  })
  return { status: r.status, stdout: Buffer.from(r.stdout ?? '').toString('utf8'), stderr: Buffer.from(r.stderr ?? '').toString('utf8') }
}

/** Run UNPACK_SRC with the race interposer preloaded (env drives its SRC/EVERY/LOG modes). */
const runScriptRaced = (
  src: string, args: string[], input: Buffer, env: Record<string, string>
): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, ['--require', INTERPOSE, '-e', src, ...args], {
    encoding: 'buffer', windowsHide: true, input,
    env: { ...process.env, ...env }
  })
  return { status: r.status, stdout: Buffer.from(r.stdout ?? '').toString('utf8'), stderr: Buffer.from(r.stderr ?? '').toString('utf8') }
}

const sentinelOf = (stdout: string): Record<string, unknown> => {
  const line = stdout.split('\n').find((l) => l.startsWith(NODE_PTY_PROBE_SENTINEL))
  expect(line, `no sentinel line in probe stdout: ${stdout}`).toBeTruthy()
  return JSON.parse((line as string).slice(NODE_PTY_PROBE_SENTINEL.length)) as Record<string, unknown>
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/** Install a resolvable stub node-pty package (and optionally a marker / an on-disk pty.node)
 *  under agentDir. */
const placeRemotePackage = (opts?: { marker?: unknown; corruptMarker?: boolean; ptyNodeBytes?: Buffer }): void => {
  const pkgDir = join(agentDir, 'node_modules', 'node-pty')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'node-pty', version: '0.0.0-stub', main: 'lib/index.js' }))
  writeFileSync(join(pkgDir, 'lib', 'index.js'), 'module.exports = { spawn: () => ({}) }\n')
  if (opts?.corruptMarker === true) writeFileSync(join(pkgDir, NODE_PTY_MARKER_FILE), 'not-json{{{')
  else if (opts?.marker !== undefined) writeFileSync(join(pkgDir, NODE_PTY_MARKER_FILE), JSON.stringify(opts.marker))
  if (opts?.ptyNodeBytes !== undefined) {
    mkdirSync(join(pkgDir, 'build', 'Release'), { recursive: true })
    writeFileSync(join(pkgDir, 'build', 'Release', 'pty.node'), opts.ptyNodeBytes)
  }
}

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

const finalDir = (): string => join(agentDir, 'node_modules', 'node-pty')
const tmpLeftovers = (): string[] => {
  const nm = join(agentDir, 'node_modules')
  return existsSync(nm) ? readdirSync(nm).filter((n) => n.includes('.tmp')) : []
}

type FsOp = { op: 'rename' | 'rm'; path: string }
const readOps = (logFile: string): FsOp[] =>
  existsSync(logFile)
    ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as FsOp)
    : []

// ── the probe (REQ-008) ──────────────────────────────────────────────────────────────────────
describe('PROBE_SRC under the local node (REQ-008)', () => {
  it('TEST-2335 REQ-008 bare dir: exactly the SEVEN fields (incl. actualPtyNodeSha256 — ESC-003); marker null; resolves false; actual hash null; exit 0', () => {
    const r = runScript(PROBE_SRC, [agentDir])
    expect(r.status, r.stderr).toBe(0)
    const p = sentinelOf(r.stdout)
    expect(Object.keys(p).sort()).toEqual(
      ['actualPtyNodeSha256', 'arch', 'glibc', 'marker', 'node', 'platform', 'resolves'])
    expect(p.platform).toBe(process.platform)
    expect(p.arch).toBe(process.arch)
    expect(p.node).toBe(process.version)
    expect(p.glibc === null || typeof p.glibc === 'string', 'glibc is a string or null').toBe(true)
    expect(p.marker).toBeNull()
    expect(p.resolves).toBe(false)
    expect(p.actualPtyNodeSha256, 'no on-disk binary ⇒ the ground-truth hash is null').toBeNull()
  })

  it('TEST-2336 REQ-008 marker + resolvable package + an on-disk pty.node matching the claim: marker verbatim; resolves true; actualPtyNodeSha256 = the hash of the ACTUAL bytes; exit 0', () => {
    const bytes = Buffer.from('on-disk fixture pty.node bytes matching the marker claim')
    const marker = { formatVersion: 1, nodePtyVersion: '0.0.0-stub', target: 'linux-x64-glibc', ptyNodeSha256: sha256(bytes) }
    placeRemotePackage({ marker, ptyNodeBytes: bytes })
    const r = runScript(PROBE_SRC, [agentDir])
    expect(r.status, r.stderr).toBe(0)
    const p = sentinelOf(r.stdout)
    expect(p.marker).toEqual(marker)
    expect(p.resolves).toBe(true)
    expect(p.actualPtyNodeSha256, 'computed from the on-disk bytes via node:crypto').toBe(sha256(bytes))
  })

  it('TEST-2337 REQ-008 a corrupt marker is a FIELD VALUE (null), never an exit code — resolution is reported independently', () => {
    placeRemotePackage({ corruptMarker: true })
    const r = runScript(PROBE_SRC, [agentDir])
    expect(r.status, 'the probe exits 0 whenever it printed the sentinel line').toBe(0)
    const p = sentinelOf(r.stdout)
    expect(p.marker).toBeNull()
    expect(p.resolves).toBe(true)
  })

  it('TEST-2369 REQ-008 (ESC-003/FINDING-020) on-disk bytes that DIFFER from the marker claim: the probe reports the ACTUAL hash, never the claimed one', () => {
    const claimed = Buffer.from('the bytes the marker was written for')
    const actual = Buffer.from('CORRUPTED bytes actually on disk now!')
    const marker = { formatVersion: 1, nodePtyVersion: '0.0.0-stub', target: 'linux-x64-glibc', ptyNodeSha256: sha256(claimed) }
    placeRemotePackage({ marker, ptyNodeBytes: actual })
    const r = runScript(PROBE_SRC, [agentDir])
    expect(r.status, r.stderr).toBe(0)
    const p = sentinelOf(r.stdout)
    expect(p.marker).toEqual(marker)
    expect(p.actualPtyNodeSha256, 'the GROUND-TRUTH hash of what is on disk').toBe(sha256(actual))
    expect(p.actualPtyNodeSha256, 'never the marker self-claim').not.toBe(sha256(claimed))
  })

  it('TEST-2370 REQ-008 (ESC-003/FINDING-020) an ABSENT pty.node under an intact marker: actualPtyNodeSha256 is null (a field value, never an exit code)', () => {
    const marker = { formatVersion: 1, nodePtyVersion: '0.0.0-stub', target: 'linux-x64-glibc', ptyNodeSha256: 'ab'.repeat(32) }
    placeRemotePackage({ marker }) // no ptyNodeBytes: the binary was deleted / never landed
    const r = runScript(PROBE_SRC, [agentDir])
    expect(r.status, r.stderr).toBe(0)
    const p = sentinelOf(r.stdout)
    expect(p.marker).toEqual(marker)
    expect(p.resolves).toBe(true)
    expect(p.actualPtyNodeSha256).toBeNull()
  })
})

// ── the unpacker (REQ-014 / REQ-015) ─────────────────────────────────────────────────────────
const PTY_BYTES = Buffer.from('fixture-elf-bytes 0023 '.repeat(8))

const PKG_JSON_BYTES = Buffer.from(JSON.stringify({ name: 'node-pty', version: '0.0.0-stub', main: 'lib/index.js' }))
const LIB_INDEX_BYTES = Buffer.from('module.exports = { spawn: () => ({}) }\n')
const LIB_DEEP_BYTES = Buffer.from('// nested lib file\n')

// The manifest `files` map (ESC-003/FINDING-005): a sha for EVERY shipped file, itself excluded.
const FILES_MAP: Record<string, string> = {
  'build/Release/pty.node': sha256(PTY_BYTES),
  'lib/index.js': sha256(LIB_INDEX_BYTES),
  'lib/worker/deep.js': sha256(LIB_DEEP_BYTES),
  'package.json': sha256(PKG_JSON_BYTES)
}
const MARKER = {
  formatVersion: 1, nodePtyVersion: '0.0.0-stub', target: 'linux-x64-glibc',
  ptyNodeSha256: sha256(PTY_BYTES), files: FILES_MAP
}
const MARKER_BYTES = Buffer.from(JSON.stringify(MARKER))

type PayloadEntry = { path: string; bytes: Buffer; sha256: string }
const bundleFiles = (): PayloadEntry[] => [
  { path: NODE_PTY_MARKER_FILE, bytes: MARKER_BYTES, sha256: sha256(MARKER_BYTES) },
  { path: 'package.json', bytes: PKG_JSON_BYTES, sha256: FILES_MAP['package.json'] },
  { path: 'lib/index.js', bytes: LIB_INDEX_BYTES, sha256: FILES_MAP['lib/index.js'] },
  { path: 'lib/worker/deep.js', bytes: LIB_DEEP_BYTES, sha256: FILES_MAP['lib/worker/deep.js'] },
  { path: 'build/Release/pty.node', bytes: PTY_BYTES, sha256: FILES_MAP['build/Release/pty.node'] }
]
const goodPayload = (): Buffer => Buffer.from(encodeNodePtyPayload(bundleFiles(), sha256(PTY_BYTES)))

const BUNDLE_TREE = [
  NODE_PTY_MARKER_FILE, 'build/Release/pty.node', 'lib/index.js', 'lib/worker/deep.js', 'package.json'
].sort()

/** Hand-craft a NODE_PTY_PAYLOAD_V1 stream, bypassing the client-side validation. Each header
 *  entry carries its own sha256 (the ESC-003 wire shape) — for corruption vectors the caller
 *  passes the EXPECTED sha with different bytes. */
const rawPayload = (files: PayloadEntry[], sha: string): Buffer => {
  const header = JSON.stringify({
    format: 1,
    files: files.map((f) => ({ path: f.path, size: f.bytes.length, sha256: f.sha256 })),
    ptyNodeSha256: sha
  })
  return Buffer.concat([Buffer.from(header + '\n'), ...files.map((f) => f.bytes)])
}

describe('UNPACK_SRC under the local node (REQ-014, REQ-015)', () => {
  it('TEST-2338 REQ-014 round trip: the exact file tree + bytes land at node_modules/node-pty, marker included, zero temp leftovers', () => {
    const r = runScript(UNPACK_SRC, [agentDir, NONCE], goodPayload())
    expect(r.status, r.stderr).toBe(0)
    expect(tree(finalDir())).toEqual(BUNDLE_TREE)
    expect(readFileSync(join(finalDir(), 'build', 'Release', 'pty.node'))).toEqual(PTY_BYTES)
    expect(JSON.parse(readFileSync(join(finalDir(), NODE_PTY_MARKER_FILE), 'utf8'))).toEqual(MARKER)
    expect(tmpLeftovers(), 'no temp dir may survive a completed install').toEqual([])
  })

  it('TEST-2339 REQ-015 a truncated stream exits 93, removes the temp dir, and leaves a prior install untouched', () => {
    placeRemotePackage({ marker: { old: true } })
    const before = tree(finalDir())
    const payload = goodPayload()
    const r = runScript(UNPACK_SRC, [agentDir, NONCE], payload.subarray(0, payload.length - 7))
    expect(r.status).toBe(NODE_PTY_BYTES_EXIT)
    expect(r.stderr, 'stderr names the byte-count check with observed vs expected values').toMatch(/expected/i)
    expect(r.stderr).toMatch(/\d+/)
    expect(tmpLeftovers(), 'the temp dir is removed on failure').toEqual([])
    expect(tree(finalDir()), 'the prior install is untouched — the promote is the commit point').toEqual(before)
  })

  it('TEST-2340 REQ-015 corrupted pty.node bytes exit 94 with a sha-naming stderr; temp gone; prior final untouched', () => {
    placeRemotePackage({ marker: { old: true } })
    const before = tree(finalDir())
    const files = bundleFiles()
    const pty = files.find((f) => f.path === 'build/Release/pty.node') as PayloadEntry
    pty.bytes = Buffer.from(pty.bytes) // copy, then corrupt (header sha256 stays the EXPECTED one)
    pty.bytes[0] = pty.bytes[0] ^ 0xff
    const r = runScript(UNPACK_SRC, [agentDir, NONCE], rawPayload(files, sha256(PTY_BYTES)))
    expect(r.status).toBe(NODE_PTY_SHA_EXIT)
    expect(r.stderr).toMatch(/sha-?256|checksum/i)
    expect(tmpLeftovers()).toEqual([])
    expect(tree(finalDir())).toEqual(before)
  })

  it('TEST-2371 REQ-014/REQ-015 (ESC-003/FINDING-005) a corrupted NON-native file at EQUAL byte length exits 94 with a stderr naming THAT file; temp gone; prior final untouched', () => {
    placeRemotePackage({ marker: { old: true } })
    const before = tree(finalDir())
    const files = bundleFiles()
    const lib = files.find((f) => f.path === 'lib/index.js') as PayloadEntry
    // The FINDING-005 attack shape: same byte COUNT, different content — only a per-file
    // sha-256 catches it (a size-only check sails through).
    lib.bytes = Buffer.from('X'.repeat(lib.bytes.length))
    const r = runScript(UNPACK_SRC, [agentDir, NONCE], rawPayload(files, sha256(PTY_BYTES)))
    expect(r.status, `an equal-length substitution in lib/index.js must exit 94, got ${r.status}: ${r.stderr}`).toBe(NODE_PTY_SHA_EXIT)
    expect(r.stderr.replace(/\\/g, '/'), 'stderr names the specific failing file').toContain('lib/index.js')
    expect(r.stderr).toMatch(/sha-?256|checksum/i)
    expect(tmpLeftovers()).toEqual([])
    expect(tree(finalDir())).toEqual(before)
  })

  it('TEST-2341 REQ-015 a successful install over a stale one replaces the directory WHOLESALE (clean reinstall, no artifact accumulation)', () => {
    placeRemotePackage({ marker: { old: true } })
    writeFileSync(join(finalDir(), 'lib', 'stale-only-file.js'), '// must vanish\n')
    const r = runScript(UNPACK_SRC, [agentDir, NONCE], goodPayload())
    expect(r.status, r.stderr).toBe(0)
    expect(tree(finalDir()), 'exactly the new file set — stale files are gone (locked D4)').toEqual(BUNDLE_TREE)
    expect(JSON.parse(readFileSync(join(finalDir(), NODE_PTY_MARKER_FILE), 'utf8')), 'the marker equals the shipped manifest').toEqual(MARKER)
    expect(tmpLeftovers()).toEqual([])
  })

  it('TEST-2342 REQ-014 the unpacker RE-validates header paths before any write (defense in depth): traversal, absolute, and backslash paths are rejected', () => {
    const evil: PayloadEntry[][] = [
      [{ path: '../evil.js', bytes: Buffer.from('boom'), sha256: sha256(Buffer.from('boom')) }],
      [{ path: '/evil-abs.js', bytes: Buffer.from('boom'), sha256: sha256(Buffer.from('boom')) }],
      [{ path: 'lib\\evil.js', bytes: Buffer.from('boom'), sha256: sha256(Buffer.from('boom')) }],
      [{ path: 'lib/../../evil2.js', bytes: Buffer.from('boom'), sha256: sha256(Buffer.from('boom')) }]
    ]
    for (const files of evil) {
      const r = runScript(UNPACK_SRC, [agentDir, NONCE], rawPayload(files, sha256(PTY_BYTES)))
      expect(r.status, `payload with path ${files[0].path} must be rejected`).not.toBe(0)
    }
    expect(existsSync(finalDir()), 'nothing was promoted').toBe(false)
    expect(tmpLeftovers()).toEqual([])
    // Nothing escaped: no evil file anywhere under (or one level above) the agent dir.
    const everywhere = tree(agentDir)
    expect(everywhere.filter((p) => p.includes('evil'))).toEqual([])
    expect(existsSync(join(agentDir, '..', 'evil.js'))).toBe(false)
  })
})

// ── the reader-atomic, race-tolerant idempotent promote (REQ-015 as re-amended — ESC-003) ────
describe('UNPACK_SRC promote collisions (REQ-015: rename-first, reader-atomic, replace retry, exit 95 only for a PERSISTENT divergence)', () => {
  it('TEST-2360 REQ-015 two installs of the IDENTICAL payload against the same agentDir with an interposed promote collision: BOTH exit 0; final dir intact; marker valid; zero temp leftovers; the loser NEVER removes the final dir (reader-atomicity)', () => {
    // Connect #1 (the winner) — a plain, complete install.
    const winner = runScript(UNPACK_SRC, [agentDir, 'aaaa01'], goodPayload())
    expect(winner.status, `winner install failed: ${winner.stderr}`).toBe(0)
    expect(tree(finalDir())).toEqual(BUNDLE_TREE)

    // Preserve the winner's promoted install so the harness can re-interpose it right before
    // the loser's promote rename (the deterministic overlap REQ-015's acceptance mandates).
    const winnerCopy = mkdtempSync(join(tmpdir(), 'termhalla-npty-winner-'))
    const opsDir = mkdtempSync(join(tmpdir(), 'termhalla-npty-ops-'))
    const opsLog = join(opsDir, 'ops.jsonl')
    try {
      cpSync(finalDir(), winnerCopy, { recursive: true })

      // Connect #2 (the loser): its rename-first promote collides with the winner's install
      // (the interposer guarantees the destination is populated at the rename moment) and the
      // REAL rename throws ENOTEMPTY/EEXIST/EPERM. Identical marker sha ⇒ a BENIGN LOST RACE ⇒
      // exit 0 — never 93 (the FINDING-013 misreport) — and the final dir is NEVER removed
      // (the ESC-003/FINDING-021 reader-atomicity consequence, observed via the op log).
      const loser = runScriptRaced(UNPACK_SRC, [agentDir, 'bbbb02'], goodPayload(),
        { NPTY_INTERPOSE_SRC: winnerCopy, NPTY_INTERPOSE_LOG: opsLog })
      expect(loser.status, `a promote collision against an identical install must be a benign lost race (exit 0), got ${loser.status}: ${loser.stderr}`).toBe(0)

      expect(tree(finalDir()), 'the final dir holds exactly the bundle file set').toEqual(BUNDLE_TREE)
      expect(JSON.parse(readFileSync(join(finalDir(), NODE_PTY_MARKER_FILE), 'utf8')),
        'the marker is valid and equals the shipped manifest').toEqual(MARKER)
      expect(readFileSync(join(finalDir(), 'build', 'Release', 'pty.node'))).toEqual(PTY_BYTES)
      expect(tmpLeftovers(), 'the loser removes its own temp dir on a lost race').toEqual([])

      const ops = readOps(opsLog)
      expect(ops.filter((o) => o.op === 'rename').length, 'the promote commit point is an fs rename').toBeGreaterThan(0)
      expect(ops.filter((o) => o.op === 'rm'),
        'installing over an IDENTICAL install never removes the final dir at all — a concurrently launching agent can never observe node-pty absent (FINDING-021)').toEqual([])
    } finally {
      rmSync(winnerCopy, { recursive: true, force: true })
      rmSync(opsDir, { recursive: true, force: true })
    }
  })

  it('TEST-2372 REQ-015 (ESC-003/FINDING-021) replacing a NON-matching stale install with NO racer: the promote is rename-FIRST (the first final-dir op is the rename attempt, removal only after the collision), the replace retry succeeds, exit 0', () => {
    placeRemotePackage({ marker: { formatVersion: 1, nodePtyVersion: '0.0.1-stale', target: 'linux-x64-glibc', ptyNodeSha256: 'ee'.repeat(32) } })
    writeFileSync(join(finalDir(), 'lib', 'stale-only.js'), '// must vanish\n')
    const opsDir = mkdtempSync(join(tmpdir(), 'termhalla-npty-ops-'))
    const opsLog = join(opsDir, 'ops.jsonl')
    try {
      // Observe-only interposition: NPTY_INTERPOSE_LOG without SRC/MODE alters nothing.
      const r = runScriptRaced(UNPACK_SRC, [agentDir, NONCE], goodPayload(), { NPTY_INTERPOSE_LOG: opsLog })
      expect(r.status, `the stale-replace path must succeed (exit 0), got ${r.status}: ${r.stderr}`).toBe(0)
      expect(tree(finalDir()), 'exactly the new file set').toEqual(BUNDLE_TREE)
      expect(JSON.parse(readFileSync(join(finalDir(), NODE_PTY_MARKER_FILE), 'utf8'))).toEqual(MARKER)
      expect(tmpLeftovers()).toEqual([])

      const ops = readOps(opsLog)
      expect(ops.length).toBeGreaterThan(0)
      expect(ops[0].op,
        'rename-FIRST: no unconditional pre-rename removal of the final dir — the ONLY sanctioned absence window is the replace of a NON-matching install AFTER the collision was observed').toBe('rename')
      const firstRm = ops.findIndex((o) => o.op === 'rm')
      expect(firstRm, 'the stale final dir IS removed on this path — but only after the rename collided').toBeGreaterThan(0)
      expect(ops.filter((o) => o.op === 'rename').length, 'the rename is retried after the sanctioned removal').toBeGreaterThan(1)
    } finally {
      rmSync(opsDir, { recursive: true, force: true })
    }
  })

  it('TEST-2362 REQ-015 a divergent install that PERSISTS through the single replace retry (a genuinely concurrent divergent promoter) exits 95 — never 93 — with a stderr naming the rename error code and both shas; own temp gone; the present install left to the other connect', () => {
    // The "other connect's" install carries a different ptyNodeSha256 and REAPPEARS before
    // every rename (NPTY_INTERPOSE_EVERY) — the loser's replace retry cannot win.
    const divergentSha = 'd'.repeat(64)
    const divergent = mkdtempSync(join(tmpdir(), 'termhalla-npty-divergent-'))
    try {
      mkdirSync(join(divergent, 'lib'), { recursive: true })
      writeFileSync(join(divergent, 'lib', 'other.js'), '// the other connect installed this\n')
      writeFileSync(join(divergent, NODE_PTY_MARKER_FILE), JSON.stringify({
        formatVersion: 1, nodePtyVersion: '9.9.9-other', target: 'linux-x64-glibc', ptyNodeSha256: divergentSha
      }))
      const divergentTree = tree(divergent)

      const r = runScriptRaced(UNPACK_SRC, [agentDir, NONCE], goodPayload(),
        { NPTY_INTERPOSE_SRC: divergent, NPTY_INTERPOSE_EVERY: '1' })
      expect(r.status, `a persistent divergent collision must exit 95, got ${r.status}: ${r.stderr}`).toBe(RACE_EXIT)
      expect(r.status, 'a promote collision is NEVER reported as the byte-count sentinel').not.toBe(NODE_PTY_BYTES_EXIT)
      expect(r.stderr, 'stderr names the original rename error code').toMatch(/ENOTEMPTY|EEXIST|EPERM/)
      expect(r.stderr, 'stderr names the expected sha').toContain(sha256(PTY_BYTES))
      expect(r.stderr, 'stderr names the observed marker sha').toContain(divergentSha)
      expect(tmpLeftovers(), 'the loser removes its own temp dir').toEqual([])
      expect(tree(finalDir()), 'the destination is left holding the other connect’s install').toEqual(divergentTree)
      expect(JSON.parse(readFileSync(join(finalDir(), NODE_PTY_MARKER_FILE), 'utf8')).ptyNodeSha256).toBe(divergentSha)
    } finally {
      rmSync(divergent, { recursive: true, force: true })
    }
  })

  it('TEST-2363 REQ-015 a PERSISTENT collision against an install with NO readable marker (absent, then unparseable) exits 95 noting the marker problem; own temp gone', () => {
    // Absent marker.
    const noMarker = mkdtempSync(join(tmpdir(), 'termhalla-npty-nomarker-'))
    // Unparseable marker.
    const badMarker = mkdtempSync(join(tmpdir(), 'termhalla-npty-badmarker-'))
    try {
      mkdirSync(join(noMarker, 'lib'), { recursive: true })
      writeFileSync(join(noMarker, 'lib', 'other.js'), '// hand-rolled install, no marker\n')

      mkdirSync(join(badMarker, 'lib'), { recursive: true })
      writeFileSync(join(badMarker, 'lib', 'other.js'), '// torn install\n')
      writeFileSync(join(badMarker, NODE_PTY_MARKER_FILE), 'not-json{{{')

      for (const src of [noMarker, badMarker]) {
        rmSync(finalDir(), { recursive: true, force: true }) // fresh destination per variant
        const r = runScriptRaced(UNPACK_SRC, [agentDir, NONCE], goodPayload(),
          { NPTY_INTERPOSE_SRC: src, NPTY_INTERPOSE_EVERY: '1' })
        expect(r.status, `persistent collision against ${src} must exit 95, got ${r.status}: ${r.stderr}`).toBe(RACE_EXIT)
        expect(r.stderr, 'stderr names the original rename error code').toMatch(/ENOTEMPTY|EEXIST|EPERM/)
        expect(r.stderr, 'stderr names the expected sha').toContain(sha256(PTY_BYTES))
        expect(r.stderr, 'stderr notes the marker absence/unreadability').toMatch(/marker/i)
        expect(tmpLeftovers(), 'the loser removes its own temp dir').toEqual([])
      }
    } finally {
      rmSync(noMarker, { recursive: true, force: true })
      rmSync(badMarker, { recursive: true, force: true })
    }
  })
})
