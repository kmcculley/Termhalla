// FROZEN test suite — feature 0020-ssh-tunnel-provisioned-bootstrap (phase 4).
// The gold round-trip (REQ-017): the REAL agent bundle — built on demand through the SAME
// vite.agent.config.ts that `npm run build` uses (outDir overridden to a scratch dir, exactly the
// frozen TEST-774 pattern; `npm test` never depends on a prior build) — is provisioned through the
// fake ssh shim into an EMPTY fake remote home and then serves the F15 handshake: absent →
// upload → relaunch → connected, with the version-lock holding end-to-end (the client's injected
// version IS package.json's, and AGENT_VERSION was inlined from the same file at bundle time).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { AGENT_V1_CAPABILITIES } from '@shared/remote/protocol'
import { connectWithProvisioning } from '../src/remote-client/bootstrap'
import { remoteAgentInstallPath } from '../src/remote-client/ssh-command'

const root = process.cwd()
const shim = resolve(root, 'tests/fixtures/fake-ssh.mjs')
const pkgVersion = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version

let outDir = ''
let bundlePath = ''
let home = ''

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'termhalla-agent-gold-'))
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'), // the SAME config npm run build uses (REQ-017)
    logLevel: 'error',
    build: { outDir, emptyOutDir: true }
  })
  bundlePath = join(outDir, 'termhalla-agent.cjs')
  home = mkdtempSync(join(tmpdir(), 'termhalla-gold-home-'))
  process.env.FAKE_SSH_HOME = home
  delete process.env.FAKE_SSH_RIG
  delete process.env.FAKE_SSH_LOG
}, 240_000)

afterAll(() => {
  delete process.env.FAKE_SSH_HOME
  if (outDir) rmSync(outDir, { recursive: true, force: true })
  if (home) rmSync(home, { recursive: true, force: true })
})

describe('TEST-2033 REQ-017 real bundle, empty home: absent → provision → handshake', () => {
  it('connects with the package.json version and the pinned v1 capabilities', async () => {
    const r = await connectWithProvisioning({
      agent: { host: 'gold.example', user: 'ci' },
      artifactPath: bundlePath,
      version: pkgVersion,
      ptyBackend: 'fake',
      ssh: { program: process.execPath, prefixArgs: [shim] }
    })
    expect(r.ok, r.ok === false ? r.diagnostic : '').toBe(true)
    if (!r.ok) return
    try {
      expect(r.session.version).toBe(pkgVersion)
      expect([...r.session.capabilities].sort()).toEqual([...AGENT_V1_CAPABILITIES].sort())
      const installed = join(home, remoteAgentInstallPath(undefined, pkgVersion).slice(2))
      expect(existsSync(installed), 'the uploaded bundle sits at the versioned install path').toBe(true)
      expect(readFileSync(installed)).toEqual(readFileSync(bundlePath))
    } finally {
      r.session.kill()
    }
  }, 120_000)
})
