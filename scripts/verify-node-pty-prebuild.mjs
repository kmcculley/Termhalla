#!/usr/bin/env node
// scripts/verify-node-pty-prebuild.mjs — feature 0023-remote-node-pty-prebuilt (REQ-003).
//
// The release-lane verification gate: fails (non-zero exit, one stderr line naming the failing
// check AND path) if any v1 target bundle is absent or invalid — missing file, a ptyNodeSha256
// that does not match the staged pty.node bytes, or a nodePtyVersion that does not equal the
// pinned version. This gate is a release-WORKFLOW step only — never baked into `npm run
// package` itself, so a prebuilt-less local package still succeeds (REQ-003).
//
//   node scripts/verify-node-pty-prebuild.mjs --root <prebuiltRoot> --version <pinnedVersion>
import { createHash } from 'node:crypto'
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const MARKER_FILE = '.termhalla-prebuilt.json'

/** Every file under `dir` as forward-slash-relative paths, sorted (the marker is included by the
 *  caller's filter, not here). */
function walkRel(dir) {
  const out = []
  const walk = (d, prefix) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`)
      else out.push(`${prefix}${name}`)
    }
  }
  walk(dir, '')
  return out.sort()
}

/**
 * Pure: verify EVERY staged file (the manifest excluded) against the manifest `files` map — both
 * the key-set parity (no uncovered staged file, no ghost map key) and each file's actual sha-256
 * (REQ-003 as amended, ESC-003 / FINDING-005: an equal-byte-length content substitution in any
 * non-native file is caught, not only pty.node). The caller injects the staged relative-path set
 * and a per-path byte reader. Returns `{ ok: true }` or `{ ok: false, message }` naming the
 * failing check AND path (CONV-001).
 */
export function verifyBundleFiles({ bundleDir, filesMap, stagedRelPaths, readBytes }) {
  if (filesMap === null || typeof filesMap !== 'object') {
    return { ok: false, message: `the manifest at ${join(bundleDir, MARKER_FILE)} is missing the per-file "files" sha map (REQ-001 as amended)` }
  }
  const staged = new Set(stagedRelPaths)
  const mapped = new Set(Object.keys(filesMap))
  for (const rel of staged) {
    if (!mapped.has(rel)) {
      return { ok: false, message: `staged file ${rel} in ${bundleDir} is not covered by the manifest "files" sha map` }
    }
  }
  for (const rel of mapped) {
    if (!staged.has(rel)) {
      return { ok: false, message: `the manifest "files" sha map lists ${rel} but no such staged file exists under ${bundleDir}` }
    }
  }
  for (const rel of stagedRelPaths) {
    const actual = createHash('sha256').update(readBytes(rel)).digest('hex')
    if (filesMap[rel] !== actual) {
      return {
        ok: false,
        message: `sha-256 checksum mismatch for ${rel} in ${bundleDir}: manifest "files" map has ${filesMap[rel]}, actual bytes hash to ${actual}`
      }
    }
  }
  return { ok: true }
}

/** The v1 target set (REQ-011) — kept in lockstep with src/remote-client/prebuilt.ts's
 *  PREBUILT_TARGETS_V1 by hand (this script is plain Node/ESM, not TypeScript, and stays
 *  dependency-free from the app's src tree by design). */
export const V1_TARGETS = ['linux-x64-glibc']

/**
 * Pure: verify ONE staged bundle's manifest against the pinned version and the bundle's own
 * actual pty.node bytes. No filesystem access — the caller reads bytes/JSON and injects them.
 * Returns `{ ok: true }` or `{ ok: false, message }` naming the failing check (CONV-001).
 */
export function verifyBundleManifest({ bundleDir, manifest, ptyNodeBytes, pinnedVersion }) {
  const ptyNodePath = join(bundleDir, 'build', 'Release', 'pty.node')
  const actualSha = createHash('sha256').update(ptyNodeBytes).digest('hex')
  if (manifest.ptyNodeSha256 !== actualSha) {
    return {
      ok: false,
      message: `ptyNodeSha256 (sha-256 checksum) mismatch for ${ptyNodePath}: manifest has ${manifest.ptyNodeSha256}, actual bytes hash to ${actualSha}`
    }
  }
  if (manifest.nodePtyVersion !== pinnedVersion) {
    return {
      ok: false,
      message: `nodePtyVersion mismatch for ${bundleDir}: manifest has version ${manifest.nodePtyVersion}, pinned version is ${pinnedVersion}`
    }
  }
  return { ok: true }
}

function fail(message) {
  process.stderr.write(`verify-node-pty-prebuild: ${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (typeof key !== 'string' || !key.startsWith('--')) fail(`unexpected argument "${key ?? ''}"`)
    out[key.slice(2)] = value
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = args.root ? resolve(args.root) : undefined
  const pinnedVersion = args.version

  if (!root) fail('--root <prebuiltRoot> is required')
  if (!pinnedVersion) fail('--version <pinnedVersion> is required')

  for (const target of V1_TARGETS) {
    const bundleDir = join(root, 'node-pty', target)
    if (!existsSync(bundleDir) || !statSync(bundleDir).isDirectory()) {
      fail(`missing node-pty prebuilt bundle for target ${target} at ${bundleDir}`)
    }
    const requiredFiles = [
      join(bundleDir, MARKER_FILE),
      join(bundleDir, 'package.json'),
      join(bundleDir, 'build', 'Release', 'pty.node')
    ]
    for (const f of requiredFiles) {
      if (!existsSync(f)) fail(`missing required node-pty prebuilt bundle file: ${f}`)
    }

    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(bundleDir, MARKER_FILE), 'utf8'))
    } catch (e) {
      fail(`unreadable/malformed manifest at ${join(bundleDir, MARKER_FILE)}: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    // FINDING-005: verify EVERY staged file against the manifest `files` map — key-set parity in
    // both directions plus each file's actual sha-256 — before the pty.node/version checks.
    const stagedRelPaths = walkRel(bundleDir).filter((rel) => rel !== MARKER_FILE)
    const filesResult = verifyBundleFiles({
      bundleDir,
      filesMap: manifest.files,
      stagedRelPaths,
      readBytes: (rel) => readFileSync(join(bundleDir, ...rel.split('/')))
    })
    if (!filesResult.ok) fail(filesResult.message)

    const ptyNodeBytes = readFileSync(join(bundleDir, 'build', 'Release', 'pty.node'))
    const result = verifyBundleManifest({ bundleDir, manifest, ptyNodeBytes, pinnedVersion })
    if (!result.ok) fail(result.message)
  }

  process.stdout.write(`verified ${V1_TARGETS.length} node-pty prebuilt target(s) against version ${pinnedVersion}\n`)
}

main()
