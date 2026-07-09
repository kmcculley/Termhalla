/**
 * The ONE canonical client version + the agent-artifact path resolver (feature 0022, REQ-006).
 *
 * Version-lock (locked decision 2, F19's REQ-015): the version injected into the F19 bootstrap
 * drives BOTH the handshake identity check and the remote install path, and MUST be read from the
 * same manifest that inlines AGENT_VERSION into the agent bundle (`src/agent/version.ts` imports
 * this same package.json at build time) — never hand-typed, never a second source.
 *
 * Electron-free (deps injected) so it unit-tests under plain vitest; the composition root
 * (services.ts) supplies the real `app.isPackaged` / `process.resourcesPath` and a bundle-derived
 * dev app root (NOT `app.getAppPath()`, which is `out/main` under an entry-file launch — see the
 * devAppRoot note in services.ts).
 */
import { join } from 'node:path'
import { version } from '../../../package.json'

/** The repo manifest version — string-identical to the bundle's inlined AGENT_VERSION. */
export const MANIFEST_VERSION: string = version

export interface ArtifactPathOpts {
  packaged: boolean
  /** The app root in dev (the repo root — bundle-derived; see services.ts devAppRoot). */
  appRoot: string
  /** Electron's `process.resourcesPath`; required when packaged. */
  resourcesPath?: string
}

/**
 * Where the bundled agent artifact lives:
 * - dev: `<appRoot>/out/agent/termhalla-agent.cjs` (the `npm run build` output);
 * - packaged: `<resourcesPath>/agent/termhalla-agent.cjs` (the electron-builder `extraResources`
 *   landing spot — see electron-builder.yml).
 */
export function resolveAgentArtifactPath(opts: ArtifactPathOpts): string {
  if (opts.packaged) return join(opts.resourcesPath ?? '', 'agent', 'termhalla-agent.cjs')
  return join(opts.appRoot, 'out', 'agent', 'termhalla-agent.cjs')
}

/**
 * Where the staged node-pty prebuilts live (feature 0023, REQ-005) — the same dev/packaged
 * split as `resolveAgentArtifactPath`, on the same injected opts:
 * - dev: `<appRoot>/out/agent/prebuilds` (the `stage-node-pty-prebuild.mjs` output, release-only
 *   locally — see REQ-002/019);
 * - packaged: `<resourcesPath>/agent/prebuilds` (the electron-builder `extraResources` landing
 *   spot — see electron-builder.yml).
 */
export function resolvePrebuiltRoot(opts: ArtifactPathOpts): string {
  if (opts.packaged) return join(opts.resourcesPath ?? '', 'agent', 'prebuilds')
  return join(opts.appRoot, 'out', 'agent', 'prebuilds')
}
