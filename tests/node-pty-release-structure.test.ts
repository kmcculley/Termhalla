// FROZEN test suite — feature 0023-remote-node-pty-prebuilt (phase 4).
// Structural guards over the release lane, packaging, and preserved invariants:
// REQ-002 (Linux prebuilt build job, old-glibc base, nothing native in git),
// REQ-003 (verify → package → publish ordering), REQ-004 (extraResources ships prebuilds),
// REQ-006 (no node-pty version literal under src/ or scripts/), REQ-007 (smoke-load step),
// REQ-023 (no SCHEMA_VERSION / userData touch in this feature's files), REQ-024 (ci.yml
// gains nothing — the test lane stays native-free and build-free).
//
// Runs RED today: release.yml has no Linux job, electron-builder.yml ships no prebuilds,
// and the staging/verification scripts do not exist.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = process.cwd()
const releaseYml = (): string => readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
const ciYml = (): string => readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')

const walk = (dir: string, skip: Set<string>): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, skip))
    else out.push(p)
  }
  return out
}

describe('release workflow (REQ-002, REQ-003, REQ-007)', () => {
  it('TEST-2311 REQ-002 a Linux job builds node-pty inside a container/base image documented as the glibc-2.31 floor', () => {
    const yml = releaseYml()
    expect(yml, 'a job on a Linux runner must exist').toMatch(/runs-on:\s*ubuntu/)
    expect(yml, 'the build base must be a container/image pinned below the v1 glibc floor').toMatch(/container:|image:/)
    expect(yml, 'the glibc floor (2.31) must be documented in the workflow').toContain('2.31')
  })

  it('TEST-2312 REQ-002/REQ-006 the pinned node-pty version is DERIVED from the repo manifest/lockfile — never hand-typed', () => {
    const yml = releaseYml()
    expect(yml, 'the version must be read via node -p from package.json / package-lock.json').toMatch(/node\s+-p/)
    expect(yml).toContain('node-pty')
    expect(yml).toMatch(/package(-lock)?\.json/)
    expect(yml, 'no node-pty version literal may appear in the workflow').not.toMatch(/1\.1\.0-/)
  })

  it('TEST-2313 REQ-002/REQ-003 step ordering: stage → verify → npm run package → publish (the gate runs BEFORE packaging/publishing)', () => {
    const yml = releaseYml()
    const idxStage = yml.indexOf('stage-node-pty-prebuild')
    const idxVerify = yml.indexOf('verify-node-pty-prebuild')
    const idxPackage = yml.indexOf('npm run package')
    const idxPublish = yml.indexOf('gh release')
    expect(idxStage, 'the packaging job must invoke the staging script').toBeGreaterThanOrEqual(0)
    expect(idxVerify, 'the packaging job must invoke the verification gate').toBeGreaterThan(idxStage)
    expect(idxPackage, 'verification must run before npm run package').toBeGreaterThan(idxVerify)
    expect(idxPublish, 'publishing must come after packaging').toBeGreaterThan(idxPackage)
  })

  it('TEST-2314 REQ-007 the Linux job smoke-loads the freshly built pty.node under plain node BEFORE handing the artifact on', () => {
    const yml = releaseYml()
    const lines = yml.split('\n')
    const smokeLine = lines.findIndex((l) => /node -e/.test(l) && /require/.test(l) && /pty\.node/.test(l))
    expect(smokeLine, 'a `node -e "require(<...pty.node>)"` smoke step must exist').toBeGreaterThanOrEqual(0)
    const uploadLine = lines.findIndex((l) => l.includes('upload-artifact'))
    expect(uploadLine, 'the built binary must be handed on via a workflow artifact').toBeGreaterThanOrEqual(0)
    expect(smokeLine, 'the smoke-load must precede the artifact upload').toBeLessThan(uploadLine)
  })

  it('TEST-2315 REQ-002 repo hygiene: no compiled .node binary anywhere in the repo outside node_modules', () => {
    const skip = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', 'test-results'])
    const offenders = walk(root, skip).filter((p) => p.endsWith('.node'))
    expect(offenders, 'no .node binary may be committed — prebuilts are release-time artifacts (REQ-002)').toEqual([])
  })
})

describe('packaging (REQ-004)', () => {
  it('TEST-2316 REQ-004 electron-builder.yml ships out/agent/prebuilds → agent/prebuilds via extraResources (outside the asar)', () => {
    const yml = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/extraResources/)
    expect(yml, 'the from side of the prebuilds mapping').toMatch(/out[\\/]agent[\\/]prebuilds/)
    expect(yml, 'the to side of the prebuilds mapping').toMatch(/to:\s*agent[\\/]prebuilds/)
    // The 0022 agent-artifact entry stays intact (additive change).
    expect(yml).toMatch(/out[\\/]agent[\\/]termhalla-agent\.cjs/)
  })
})

describe('version lockstep and preserved invariants (REQ-006, REQ-023, REQ-024)', () => {
  const sourceWalk = (dir: string): string[] => {
    if (!existsSync(dir)) return []
    return walk(dir, new Set(['node_modules']))
  }

  it('TEST-2317 REQ-006 the staging/verification scripts exist and NO file under src/ or scripts/ contains a node-pty version literal', () => {
    expect(existsSync(resolve(root, 'scripts/stage-node-pty-prebuild.mjs')), 'scripts/stage-node-pty-prebuild.mjs must exist (REQ-001)').toBe(true)
    expect(existsSync(resolve(root, 'scripts/verify-node-pty-prebuild.mjs')), 'scripts/verify-node-pty-prebuild.mjs must exist (REQ-003)').toBe(true)
    const offenders: string[] = []
    for (const f of [...sourceWalk(resolve(root, 'src')), ...sourceWalk(resolve(root, 'scripts'))]) {
      if (/\.(ts|tsx|js|mjs|cjs)$/.test(f) && /1\.1\.0-beta\d+/.test(readFileSync(f, 'utf8'))) offenders.push(f)
    }
    expect(offenders, 'the pinned node-pty version is READ from the manifest, never inlined (REQ-006)').toEqual([])
  })

  it('TEST-2319 REQ-023 no file this feature owns references SCHEMA_VERSION or Electron userData persistence', () => {
    const owned = [
      'src/remote-client/prebuilt.ts',
      'src/remote-client/bootstrap.ts',
      'src/main/remote/agent-artifact.ts',
      'scripts/stage-node-pty-prebuild.mjs',
      'scripts/verify-node-pty-prebuild.mjs'
    ]
    for (const rel of owned) {
      const p = resolve(root, rel)
      expect(existsSync(p), `${rel} must exist`).toBe(true)
      const src = readFileSync(p, 'utf8')
      expect(src.includes('SCHEMA_VERSION'), `${rel} references SCHEMA_VERSION — this feature persists nothing (REQ-023)`).toBe(false)
      expect(/userData|getPath\(/.test(src), `${rel} references Electron userData persistence — this feature persists nothing (REQ-023)`).toBe(false)
    }
  })

  it('TEST-2318 REQ-024 ci.yml gains nothing: no staging-script reference, no container/docker step — the test lane stays native-free and build-free', () => {
    const yml = ciYml()
    expect(yml).not.toContain('stage-node-pty-prebuild')
    expect(yml).not.toContain('verify-node-pty-prebuild')
    expect(yml).not.toMatch(/container:|docker/i)
  })
})
