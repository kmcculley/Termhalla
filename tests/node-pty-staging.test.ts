// FROZEN test suite — feature 0023-remote-node-pty-prebuilt (phase 4).
// REQ-001/REQ-003/REQ-006/REQ-023: the prebuilt staging + verification scripts.
// RE-CUT through the tests phase after the FINDING-020-cluster / ESC-003 loopback (FINDING-005):
// the manifest now carries a `files` map — a sha-256 for EVERY shipped file, not only pty.node —
// computed at staging time from the actual bytes (TEST-2365) and re-verified per file by the
// release gate (TEST-2366: the equal-byte-length content-substitution attack shape; TEST-2367:
// a files-map/file-set divergence). TEST-2310's whitelist gains the `files` key.
//
// Chosen contract (frozen here; the implementer builds to it):
//   scripts/stage-node-pty-prebuild.mjs
//     CLI: node scripts/stage-node-pty-prebuild.mjs --source <nodePtyPackageDir>
//          --pty-node <builtPtyNodeFile> --out <prebuiltRoot> --target <target>
//     → exit 0 and the REQ-001 bundle at <prebuiltRoot>/node-pty/<target>/ ; on a missing
//       source dir / pty.node file: exit non-zero with a stderr line naming the missing path
//       (CONV-001/CONV-002). The script's core is a pure, injectable function; this suite
//       exercises it through the CLI (the exact interface release.yml consumes).
//     Manifest shape (REQ-001 as amended): { formatVersion: 1, nodePtyVersion, target,
//       ptyNodeSha256, files } where `files` maps EVERY staged relative path (the manifest
//       itself excluded) to the lowercase-hex sha-256 of that file's actual bytes, enumerated
//       deterministically (two stagings of the same inputs are byte-identical manifests).
//   scripts/verify-node-pty-prebuild.mjs
//     CLI: node scripts/verify-node-pty-prebuild.mjs --root <prebuiltRoot> --version <pinned>
//     → exit 0 when EVERY v1 target bundle is complete, per-file sha-verified (every staged
//       file's actual sha-256 equals its `files` entry AND the `files` key set equals exactly
//       the staged file set), and version-matched; exit non-zero with a stderr line naming the
//       failing check AND path otherwise.
//
// The suite is native-free and build-free (REQ-024): the "pty.node" is arbitrary bytes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const stageScript = resolve(root, 'scripts/stage-node-pty-prebuild.mjs')
const verifyScript = resolve(root, 'scripts/verify-node-pty-prebuild.mjs')
const TARGET = 'linux-x64-glibc'
const FIXTURE_VERSION = '7.7.7-fixture' // chosen by the test — proves read-at-generation (REQ-001c)

let work = ''
let sourceDir = ''
let ptyNodePath = ''
let outRoot = ''
const PTY_BYTES = Buffer.from('ELF-not-really: fixture pty.node bytes for feature 0023 '.repeat(4))
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

const run = (script: string, args: string[]): { status: number | null; stderr: string; stdout: string } => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true })
  return { status: r.status, stderr: String(r.stderr ?? ''), stdout: String(r.stdout ?? '') }
}

const stage = (over: string[] = []): { status: number | null; stderr: string; stdout: string } =>
  run(stageScript, [
    '--source', sourceDir, '--pty-node', ptyNodePath, '--out', outRoot, '--target', TARGET, ...over
  ])

const verify = (version: string, rootDir = outRoot): { status: number | null; stderr: string; stdout: string } =>
  run(verifyScript, ['--root', rootDir, '--version', version])

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

const bundleDir = (): string => join(outRoot, 'node-pty', TARGET)
const slashed = (s: string): string => s.replace(/\\/g, '/')

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'termhalla-npty-stage-'))
  sourceDir = join(work, 'node-pty-src')
  outRoot = join(work, 'prebuilds')
  ptyNodePath = join(work, 'pty.node')
  // A fixture node-pty package dir: manifest + a lib/ tree (with a subdir, proving the
  // whole-lib recursive copy) + files that must NOT be staged (README, src/).
  mkdirSync(join(sourceDir, 'lib', 'worker'), { recursive: true })
  mkdirSync(join(sourceDir, 'src'), { recursive: true })
  writeFileSync(join(sourceDir, 'package.json'),
    JSON.stringify({ name: 'node-pty', version: FIXTURE_VERSION, main: 'lib/index.js' }))
  writeFileSync(join(sourceDir, 'lib', 'index.js'), 'module.exports = { spawn: () => ({}) }\n')
  writeFileSync(join(sourceDir, 'lib', 'worker', 'conoutSocketWorker.js'), '// worker fixture\n')
  writeFileSync(join(sourceDir, 'README.md'), 'not part of the bundle\n')
  writeFileSync(join(sourceDir, 'src', 'unixTerminal.ts'), '// never staged\n')
  writeFileSync(ptyNodePath, PTY_BYTES)
})

afterEach(() => { rmSync(work, { recursive: true, force: true }) })

describe('staging (REQ-001, REQ-006)', () => {
  it('TEST-2301 REQ-001 stages EXACTLY the bundle file set: marker + package.json + whole lib/** + build/Release/pty.node', () => {
    const r = stage()
    expect(r.status, `stage failed: ${r.stderr}`).toBe(0)
    expect(tree(bundleDir())).toEqual([
      '.termhalla-prebuilt.json',
      'build/Release/pty.node',
      'lib/index.js',
      'lib/worker/conoutSocketWorker.js',
      'package.json'
    ])
    expect(readFileSync(join(bundleDir(), 'build', 'Release', 'pty.node'))).toEqual(PTY_BYTES)
    expect(readFileSync(join(bundleDir(), 'lib', 'index.js'), 'utf8')).toContain('spawn')
  })

  it('TEST-2302 REQ-001/REQ-006 the manifest carries formatVersion 1, the target, the ACTUAL pty.node sha-256, and the version READ from the source manifest at generation time', () => {
    const r = stage()
    expect(r.status, `stage failed: ${r.stderr}`).toBe(0)
    const manifest = JSON.parse(readFileSync(join(bundleDir(), '.termhalla-prebuilt.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.formatVersion).toBe(1)
    expect(manifest.target).toBe(TARGET)
    expect(manifest.ptyNodeSha256, 'sha-256 computed from the actual staged bytes (lowercase hex)').toBe(sha256(PTY_BYTES))
    expect(manifest.nodePtyVersion, 'read from the source package manifest at generation time — never a source literal').toBe(FIXTURE_VERSION)
  })

  it('TEST-2365 REQ-001/REQ-003 (ESC-003/FINDING-005) the manifest `files` map covers EXACTLY the staged file set (manifest excluded) with each value the sha-256 of that file\'s actual bytes — deterministically ordered', () => {
    const r = stage()
    expect(r.status, `stage failed: ${r.stderr}`).toBe(0)
    const manifest = JSON.parse(readFileSync(join(bundleDir(), '.termhalla-prebuilt.json'), 'utf8')) as { files?: Record<string, string> }
    expect(manifest.files, 'the manifest must carry the per-file `files` sha map (REQ-001 as amended)').toBeTruthy()
    const files = manifest.files as Record<string, string>
    const staged = tree(bundleDir()).filter((p) => p !== '.termhalla-prebuilt.json')
    expect(Object.keys(files).sort(), 'the key set equals exactly the staged relative file set, the manifest itself excluded').toEqual(staged)
    for (const rel of staged) {
      expect(files[rel], `files["${rel}"] must be the independently computed sha-256 of the staged bytes`)
        .toBe(sha256(readFileSync(join(bundleDir(), ...rel.split('/')))))
    }
    // Deterministic enumeration: a second staging of the SAME inputs is a byte-identical manifest.
    const outRoot2 = join(work, 'prebuilds-2')
    const r2 = run(stageScript, ['--source', sourceDir, '--pty-node', ptyNodePath, '--out', outRoot2, '--target', TARGET])
    expect(r2.status, `second stage failed: ${r2.stderr}`).toBe(0)
    expect(readFileSync(join(outRoot2, 'node-pty', TARGET, '.termhalla-prebuilt.json'), 'utf8'))
      .toBe(readFileSync(join(bundleDir(), '.termhalla-prebuilt.json'), 'utf8'))
  })

  it('TEST-2303 REQ-001 a missing/empty source dir fails with a specific, actionable error naming the path (CONV-001)', () => {
    rmSync(sourceDir, { recursive: true, force: true })
    const r = stage()
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('node-pty-src')
  })

  it('TEST-2304 REQ-001 a missing pty.node fails with a specific, actionable error naming the path (CONV-002)', () => {
    rmSync(ptyNodePath, { force: true })
    const r = stage()
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('pty.node')
    expect(existsSync(bundleDir()), 'no partial bundle is left behind').toBe(false)
  })

  it('TEST-2310 REQ-023 the manifest contains EXACTLY the whitelisted fields (now incl. `files` — ESC-003) — version/target/path/hash strings, no credentials, no host identity', () => {
    const r = stage()
    expect(r.status, `stage failed: ${r.stderr}`).toBe(0)
    const manifest = JSON.parse(readFileSync(join(bundleDir(), '.termhalla-prebuilt.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(manifest).sort()).toEqual(['files', 'formatVersion', 'nodePtyVersion', 'ptyNodeSha256', 'target'])
    expect(typeof manifest.nodePtyVersion).toBe('string')
    expect(typeof manifest.target).toBe('string')
    expect(String(manifest.ptyNodeSha256)).toMatch(/^[0-9a-f]{64}$/)
    for (const [rel, sha] of Object.entries(manifest.files as Record<string, string>)) {
      expect(rel, 'files keys are relative paths — no host identity, no credentials').toMatch(/^[A-Za-z0-9._/-]+$/)
      expect(sha).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('verification (REQ-003)', () => {
  it('TEST-2305 REQ-003 a complete, sha-verified, version-matched bundle passes (exit 0)', () => {
    expect(stage().status).toBe(0)
    const r = verify(FIXTURE_VERSION)
    expect(r.status, `verify failed: ${r.stderr}`).toBe(0)
  })

  it('TEST-2306 REQ-003 an absent bundle dir fails, naming the expected path', () => {
    const r = verify(FIXTURE_VERSION) // outRoot was never staged
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain(TARGET)
  })

  it('TEST-2307 REQ-003 a missing bundle file (pty.node removed) fails, naming the file', () => {
    expect(stage().status).toBe(0)
    rmSync(join(bundleDir(), 'build', 'Release', 'pty.node'), { force: true })
    const r = verify(FIXTURE_VERSION)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('pty.node')
  })

  it('TEST-2308 REQ-003 a ptyNodeSha256 that does not match the staged bytes fails, naming the sha check', () => {
    expect(stage().status).toBe(0)
    writeFileSync(join(bundleDir(), 'build', 'Release', 'pty.node'), Buffer.from('tampered bytes'))
    const r = verify(FIXTURE_VERSION)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/sha-?256|checksum/i)
  })

  it('TEST-2366 REQ-003 (ESC-003/FINDING-005) an EQUAL-byte-length content substitution in a non-native file fails, naming that file — the attack shape only a per-file sha catches', () => {
    expect(stage().status).toBe(0)
    const target = join(bundleDir(), 'lib', 'index.js')
    const original = readFileSync(target)
    writeFileSync(target, Buffer.from('x'.repeat(original.length))) // SAME byte length, different content
    const r = verify(FIXTURE_VERSION)
    expect(r.status, 'a size-preserving substitution must fail the per-file sha check').not.toBe(0)
    expect(slashed(r.stderr), 'stderr names the failing file').toContain('lib/index.js')
    expect(r.stderr).toMatch(/sha-?256|checksum/i)
  })

  it('TEST-2367 REQ-003 (ESC-003/FINDING-005) a files-map/file-set divergence fails in BOTH directions, naming the diverging path', () => {
    // (a) a staged file the map does not cover.
    expect(stage().status).toBe(0)
    writeFileSync(join(bundleDir(), 'lib', 'injected-extra.js'), '// not in the files map\n')
    const extra = verify(FIXTURE_VERSION)
    expect(extra.status, 'an on-disk file absent from the files map must fail').not.toBe(0)
    expect(slashed(extra.stderr)).toContain('injected-extra.js')

    // (b) a files-map key with no staged file behind it (restage clean, then edit the manifest).
    expect(stage().status).toBe(0)
    const manifestPath = join(bundleDir(), '.termhalla-prebuilt.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: Record<string, string> }
    manifest.files['lib/ghost-entry.js'] = 'ab'.repeat(32)
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const ghost = verify(FIXTURE_VERSION)
    expect(ghost.status, 'a files-map key with no staged file must fail').not.toBe(0)
    expect(slashed(ghost.stderr)).toContain('ghost-entry.js')
  })

  it('TEST-2309 REQ-003/REQ-006 a nodePtyVersion different from the pinned version fails, naming the version check', () => {
    expect(stage().status).toBe(0)
    const r = verify('9.9.9-other-pin')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/version/i)
    expect(r.stderr).toContain(FIXTURE_VERSION)
  })
})
