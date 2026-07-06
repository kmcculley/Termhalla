#!/usr/bin/env node
// scripts/stage-node-pty-prebuild.mjs — feature 0023-remote-node-pty-prebuilt (REQ-001, REQ-006).
//
// Stages the REQ-001 bundle shape at <out>/node-pty/<target>/:
//   .termhalla-prebuilt.json   (the manifest — computed here from the ACTUAL staged bytes)
//   package.json               (the source node-pty package's own manifest, copied verbatim)
//   lib/**                     (the ENTIRE lib/ dir of the source package, recursively)
//   build/Release/pty.node     (the one built native file for this target)
//
// The core (`planStaging`) is a PURE function over injected text/bytes — no filesystem access —
// so its computation is unit-testable in isolation. Everything below it is the thin, impure CLI
// wrapper `release.yml` invokes:
//
//   node scripts/stage-node-pty-prebuild.mjs --source <nodePtyPackageDir> --pty-node <file>
//        --out <prebuiltRoot> --target <target>
//
// Inputs are fully validated BEFORE anything is written (REQ-001: a failed stage never leaves a
// partial bundle behind).
import { createHash } from 'node:crypto'
import {
  existsSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync
} from 'node:fs'
import { join, resolve } from 'node:path'

const MARKER_FILE = '.termhalla-prebuilt.json'

/**
 * Pure: given the source node-pty package.json TEXT and the actual built pty.node BYTES,
 * compute the exact manifest object the bundle must carry (REQ-001b/c, REQ-006 — the version is
 * READ from the source manifest at generation time, never a source literal here).
 */
export function planStaging({ sourcePackageJsonText, ptyNodeBytes, target }) {
  const manifestSource = JSON.parse(sourcePackageJsonText)
  if (typeof manifestSource.version !== 'string' || manifestSource.version.length === 0) {
    throw new Error('the source node-pty package.json has no string "version" field')
  }
  return {
    formatVersion: 1,
    nodePtyVersion: manifestSource.version,
    target,
    ptyNodeSha256: createHash('sha256').update(ptyNodeBytes).digest('hex')
  }
}

function fail(message) {
  process.stderr.write(`stage-node-pty-prebuild: ${message}\n`)
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

/** Recursively copy every file under `src` into `dest`, preserving the relative tree — used ONLY
 *  for the source package's lib/ directory (REQ-001's whole-lib rule; README/src/ etc. are never
 *  staged). */
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    const s = join(src, name)
    const d = join(dest, name)
    if (statSync(s).isDirectory()) copyTree(s, d)
    else writeFileSync(d, readFileSync(s))
  }
}

/** Every file under `dir` as forward-slash-relative paths, sorted deterministically — the
 *  enumeration behind the manifest `files` map (REQ-001 as amended, ESC-003 / FINDING-005: two
 *  stagings of identical inputs must produce byte-identical manifests). */
function walkRelSorted(dir) {
  const out = []
  const walk = (d, prefix) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`)
      else out.push(`${prefix}${name}`)
    }
  }
  walk(dir, '')
  return out.sort()
}

/** A sha-256 for EVERY staged file (the manifest itself excluded), keyed by its forward-slash
 *  relative path, inserted in sorted order so the serialized manifest is deterministic. */
function computeFilesMap(bundleDir) {
  const files = {}
  for (const rel of walkRelSorted(bundleDir)) {
    if (rel === MARKER_FILE) continue
    files[rel] = createHash('sha256').update(readFileSync(join(bundleDir, ...rel.split('/')))).digest('hex')
  }
  return files
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const sourceDir = args.source ? resolve(args.source) : undefined
  const ptyNodePath = args['pty-node'] ? resolve(args['pty-node']) : undefined
  const outRoot = args.out ? resolve(args.out) : undefined
  const target = args.target

  if (!sourceDir) fail('--source <nodePtyPackageDir> is required')
  if (!ptyNodePath) fail('--pty-node <builtPtyNodeFile> is required')
  if (!outRoot) fail('--out <prebuiltRoot> is required')
  if (!target) fail('--target <target> is required')

  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    fail(`source node-pty package directory not found: ${sourceDir}`)
  }
  const sourcePackageJsonPath = join(sourceDir, 'package.json')
  if (!existsSync(sourcePackageJsonPath)) {
    fail(`source node-pty package.json not found: ${sourcePackageJsonPath}`)
  }
  const sourceLibDir = join(sourceDir, 'lib')
  if (!existsSync(sourceLibDir) || !statSync(sourceLibDir).isDirectory()) {
    fail(`source node-pty lib/ directory not found: ${sourceLibDir}`)
  }
  if (!existsSync(ptyNodePath) || !statSync(ptyNodePath).isFile()) {
    fail(`built pty.node not found: ${ptyNodePath}`)
  }

  const sourcePackageJsonText = readFileSync(sourcePackageJsonPath, 'utf8')
  const ptyNodeBytes = readFileSync(ptyNodePath)
  let manifest
  try {
    manifest = planStaging({ sourcePackageJsonText, ptyNodeBytes, target })
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
    return
  }

  // All inputs validated above — only now do we touch the output tree, so a failure here never
  // leaves a partial bundle (and a re-run cleanly replaces a stale one).
  const bundleDir = join(outRoot, 'node-pty', target)
  rmSync(bundleDir, { recursive: true, force: true })
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'package.json'), sourcePackageJsonText)
  copyTree(sourceLibDir, join(bundleDir, 'lib'))
  mkdirSync(join(bundleDir, 'build', 'Release'), { recursive: true })
  writeFileSync(join(bundleDir, 'build', 'Release', 'pty.node'), ptyNodeBytes)

  // FINDING-005: the manifest carries a sha-256 for EVERY shipped file, computed from the actual
  // staged bytes AFTER the files land (the marker itself is excluded from its own map). Written
  // last so it never hashes itself.
  const fullManifest = { ...manifest, files: computeFilesMap(bundleDir) }
  writeFileSync(join(bundleDir, MARKER_FILE), JSON.stringify(fullManifest))

  process.stdout.write(`staged node-pty ${manifest.nodePtyVersion} (${target}) at ${bundleDir}\n`)
}

main()
