// FROZEN test suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-005).
// REQ-006: the ONE canonical client version + the dev/packaged agent-artifact path resolver, and
// the packaging wiring that ships the artifact.
//
// Chosen contract (freezing the plan's TASK-005 prose): `src/main/remote/agent-artifact.ts`
// exports
//   - MANIFEST_VERSION: string — read from the repo package.json (the SAME manifest that inlines
//     AGENT_VERSION into the bundle), never hand-typed;
//   - resolveAgentArtifactPath(opts: { packaged: boolean; appRoot: string; resourcesPath?: string }): string
//     dev (packaged: false)  -> <appRoot>/out/agent/termhalla-agent.cjs
//     packaged               -> <resourcesPath>/agent/termhalla-agent.cjs
// The module is electron-free (deps injected) so it tests under plain vitest.
//
// Runs RED today: src/main/remote/agent-artifact.ts does not exist.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MANIFEST_VERSION, resolveAgentArtifactPath } from '../../src/main/remote/agent-artifact'

const norm = (p: string) => p.replace(/\\/g, '/')

describe('agent artifact + version resolution (REQ-006)', () => {
  it('TEST-2218 REQ-006 MANIFEST_VERSION is string-identical to the repo package.json version (the AGENT_VERSION manifest)', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }
    expect(MANIFEST_VERSION).toBe(pkg.version)
    expect(MANIFEST_VERSION.length).toBeGreaterThan(0)
  })

  it('TEST-2219 REQ-006 dev resolution points at out/agent/termhalla-agent.cjs under the app root', () => {
    const p = resolveAgentArtifactPath({ packaged: false, appRoot: 'C:/repo' })
    expect(norm(p)).toBe('C:/repo/out/agent/termhalla-agent.cjs')
  })

  it('TEST-2220 REQ-006 packaged resolution points under resourcesPath (the extraResources landing spot)', () => {
    const p = resolveAgentArtifactPath({ packaged: true, appRoot: 'C:/ignored', resourcesPath: 'C:/app/resources' })
    expect(norm(p)).toBe('C:/app/resources/agent/termhalla-agent.cjs')
  })

  it('TEST-2221 REQ-006 electron-builder.yml ships the agent bundle via extraResources', () => {
    const yml = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/extraResources/)
    expect(yml).toMatch(/out[\\/]agent[\\/]termhalla-agent\.cjs|out\/agent/)
  })
})
