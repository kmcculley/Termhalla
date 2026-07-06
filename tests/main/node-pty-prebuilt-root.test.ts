// FROZEN test suite — feature 0023-remote-node-pty-prebuilt (phase 4).
// REQ-005: the prebuilt-root path resolver beside resolveAgentArtifactPath — the same injected
// ArtifactPathOpts, no electron import (the 0022 TEST-2219/TEST-2220 pattern, in a new file so
// the frozen 0022 suite stays untouched).
//
// Chosen contract: `src/main/remote/agent-artifact.ts` exports
//   resolvePrebuiltRoot(opts: ArtifactPathOpts): string
//     dev (packaged: false) -> <appRoot>/out/agent/prebuilds
//     packaged              -> <resourcesPath>/agent/prebuilds
//
// Runs RED today: resolvePrebuiltRoot does not exist.
import { describe, it, expect } from 'vitest'
import { resolvePrebuiltRoot } from '../../src/main/remote/agent-artifact'

const norm = (p: string): string => p.replace(/\\/g, '/')

describe('prebuilt root resolution (REQ-005)', () => {
  it('TEST-2320 REQ-005 dev resolution points at out/agent/prebuilds under the app root', () => {
    const p = resolvePrebuiltRoot({ packaged: false, appRoot: 'C:/repo' })
    expect(norm(p)).toBe('C:/repo/out/agent/prebuilds')
  })

  it('TEST-2321 REQ-005 packaged resolution points under resourcesPath (the extraResources landing spot)', () => {
    const p = resolvePrebuiltRoot({ packaged: true, appRoot: 'C:/ignored', resourcesPath: 'C:/app/resources' })
    expect(norm(p)).toBe('C:/app/resources/agent/prebuilds')
  })
})
