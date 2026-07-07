/**
 * Node-pty co-provisioning orchestration (feature 0023, REQ-012..021) — extracted from
 * bootstrap.ts in the 2026-07-06 quality-audit Group C pass (#9): bootstrap.ts keeps the
 * connect/provision-once POLICY; this module owns the co-provision gate that runs BEFORE it.
 *
 * Gated entirely on `opts.nodePty` being present and `ptyBackend` being (the default)
 * `'node-pty'` (REQ-018). At most one probe and at most one install exec channel per
 * `connectWithProvisioning` call (REQ-016), plus at most ONE recovery cycle on a
 * module-resolution launch failure. The connect leg is INJECTED (`ConnectFn`) so this module
 * never depends on bootstrap.ts at runtime.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildSshExecArgv, DEFAULT_REMOTE_AGENT_DIR } from './ssh-command'
import { runSshExecChannel, errText, defaultNonce } from './exec-channel'
import {
  buildNodePtyProbeCommand, buildNodePtyInstallCommand, classifyProbeOutcome, deriveLibc,
  selectPrebuiltTarget, decideNodePtyProvision, encodeNodePtyPayload, glibcFloorHint,
  parseProbeStdout, appendBoundedProbeStdout,
  NODE_PTY_MARKER_FILE, NODE_PTY_BYTES_EXIT, NODE_PTY_SHA_EXIT, NODE_PTY_RACE_EXIT
} from './prebuilt'
import type { NodePtyProbeResult, PrebuiltManifest, PlatformTriple } from './prebuilt'
import type { ConnectResult } from './connect-pump'
import type { BootstrapOptions } from './bootstrap'

/** The connect leg the recovery cycle relaunches through — injected by bootstrap.ts (its
 *  `chooseConnect` routing), never imported, so co-provision stays cycle-free. */
export type ConnectFn = (opts: BootstrapOptions) => Promise<ConnectResult>

/** Every file under a staged target bundle dir, as forward-slash-relative `{ path, bytes }`
 *  pairs — a DYNAMIC recursive walk (REQ-022/TEST-2004: this tree never hard-codes any bundle
 *  file's name, including node-pty's own manifest filename). */
function walkBundleDir(dir: string): Array<{ path: string; bytes: Buffer }> {
  const out: Array<{ path: string; bytes: Buffer }> = []
  const walk = (d: string, prefix: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`)
      else out.push({ path: `${prefix}${name}`, bytes: readFileSync(full) })
    }
  }
  walk(dir, '')
  return out
}

/** Every relative path under a bundle dir, no bytes read (REQ-019/ESC-004's files-map parity
 *  check needs only the path set — the payload build below still reads bytes once). */
function walkBundleDirPaths(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, prefix: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`)
      else out.push(`${prefix}${name}`)
    }
  }
  walk(dir, '')
  return out
}

type FilesMapResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; reason: string }

/** Validate the local manifest's `files` field (ESC-004 — FINDING-022/FINDING-024): it MUST be a
 *  plain (non-array) object whose every value is a non-empty sha-256 string, AND its key set MUST
 *  have BIDIRECTIONAL parity with the files actually present under the bundle dir (mirroring the
 *  release gate's `verifyBundleFiles` check, run here at connect time against the LOCAL bundle).
 *  This is the ONLY sha source for the payload (the marker file's own entry excepted) — there is
 *  no self-compute fallback, so an unmapped or ghost-mapped file can never ship under a
 *  self-computed sha of its own (possibly tampered) bytes. */
function validateManifestFiles(rawFiles: unknown, bundleDir: string, manifestPath: string): FilesMapResult {
  if (rawFiles === null || typeof rawFiles !== 'object' || Array.isArray(rawFiles)) {
    return {
      ok: false,
      reason: `the local node-pty prebuilt manifest at ${manifestPath} has a malformed files field — it must be a plain object mapping every bundle-relative path to a non-empty lowercase-hex sha-256 string (found ${Array.isArray(rawFiles) ? 'an array' : typeof rawFiles}); expected bundle dir: ${bundleDir}`
    }
  }
  const rawEntries = rawFiles as Record<string, unknown>
  const malformed = Object.entries(rawEntries).filter(([, v]) => typeof v !== 'string' || v.length === 0)
  if (malformed.length > 0) {
    return {
      ok: false,
      reason: `the local node-pty prebuilt manifest at ${manifestPath} has a malformed files field — every value must be a non-empty sha-256 string; offending path(s): ${malformed.map(([k]) => k).join(', ')}; expected bundle dir: ${bundleDir}`
    }
  }
  const files = rawEntries as Record<string, string>

  // Bidirectional parity against the ACTUAL on-disk bundle dir (the manifest file itself is
  // excluded from the map by design — REQ-001).
  const onDisk = walkBundleDirPaths(bundleDir).filter((p) => p !== NODE_PTY_MARKER_FILE)
  const onDiskSet = new Set(onDisk)
  const mapKeys = Object.keys(files)
  const mapKeySet = new Set(mapKeys)
  const uncoveredOnDisk = onDisk.filter((p) => !mapKeySet.has(p))
  const ghostInMap = mapKeys.filter((p) => !onDiskSet.has(p))
  if (uncoveredOnDisk.length > 0 || ghostInMap.length > 0) {
    const offending = [...uncoveredOnDisk, ...ghostInMap].join(', ')
    return {
      ok: false,
      reason: `the local node-pty prebuilt manifest at ${manifestPath} is incomplete: its files map does not have 1:1 parity with the bundle dir at ${bundleDir} — offending path(s): ${offending}`
    }
  }
  return { ok: true, files }
}

type LocalManifestResult =
  | { ok: true; manifest: PrebuiltManifest }
  | { ok: false; reason: string }

/** Read + validate the LOCAL target bundle's manifest (REQ-019): missing bundle dir, missing
 *  `build/Release/pty.node`, or an unreadable/malformed/incomplete manifest are each a specific
 *  fatal naming the expected path — checked BEFORE any decision or upload. */
function readLocalManifest(bundleDir: string): LocalManifestResult {
  if (!existsSync(bundleDir) || !statSync(bundleDir).isDirectory()) {
    return {
      ok: false,
      reason: `no local node-pty prebuilt bundle at ${bundleDir} — a released installer ships this; a dev checkout must run the staging script (scripts/stage-node-pty-prebuild.mjs) to produce it`
    }
  }
  const ptyNodePath = join(bundleDir, 'build', 'Release', 'pty.node')
  if (!existsSync(ptyNodePath)) {
    return { ok: false, reason: `the local node-pty prebuilt bundle at ${bundleDir} is missing build/Release/pty.node` }
  }
  const manifestPath = join(bundleDir, NODE_PTY_MARKER_FILE)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    return { ok: false, reason: `the local node-pty prebuilt manifest at ${manifestPath} is unreadable or malformed: ${errText(e)}` }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, reason: `the local node-pty prebuilt manifest at ${manifestPath} is not a JSON object` }
  }
  const m = parsed as Partial<PrebuiltManifest>
  if (typeof m.nodePtyVersion !== 'string' || typeof m.target !== 'string' || typeof m.ptyNodeSha256 !== 'string') {
    return { ok: false, reason: `the local node-pty prebuilt manifest at ${manifestPath} is missing required fields (nodePtyVersion/target/ptyNodeSha256)` }
  }
  // ESC-004 (FINDING-022/FINDING-024): `files` is the payload's ONLY sha source (the marker's own
  // entry excepted) — validate its shape and its bidirectional parity with the actual bundle dir
  // BEFORE any decision or upload, so a tampered/unmapped or ghost-mapped file can never ship.
  const filesResult = validateManifestFiles(m.files, bundleDir, manifestPath)
  if (!filesResult.ok) return { ok: false, reason: filesResult.reason }
  return {
    ok: true,
    manifest: {
      formatVersion: typeof m.formatVersion === 'number' ? m.formatVersion : 1,
      nodePtyVersion: m.nodePtyVersion,
      target: m.target,
      ptyNodeSha256: m.ptyNodeSha256,
      files: filesResult.files
    }
  }
}

const noMatchDiagnostic = (remoteAgentDir: string, triple: PlatformTriple): string =>
  `no node-pty prebuilt is available for the detected remote (platform=${triple.platform}, arch=${triple.arch}, libc=${triple.libc}) — this build ships a prebuilt for linux-x64-glibc only; the escape hatch: manually install the pinned node-pty version at ${remoteAgentDir}/node_modules/node-pty on the host (once it resolves there, connect will detect it and proceed)`

type ProbeGateResult =
  | { kind: 'fatal'; diagnostic: string }
  | { kind: 'aborted'; diagnostic: string }
  | { kind: 'probe'; probe: NodePtyProbeResult }

/** The read-only probe exec channel (REQ-008/009/017): abort is always determinate here.
 *  REQ-026 (ESC-003/FINDING-010): the stdout window is BOUNDED (never unbounded concatenation)
 *  and the channel settles the MOMENT a parseable sentinel line exists — tearing the child down
 *  instead of waiting for stream end, so an endless-stdout remote can neither wedge the connect
 *  nor grow memory in the privileged Electron main process. */
async function runNodePtyProbe(opts: BootstrapOptions, remoteAgentDir: string): Promise<ProbeGateResult> {
  let argv: string[]
  try {
    argv = buildSshExecArgv(opts.agent, buildNodePtyProbeCommand(remoteAgentDir))
  } catch (e) {
    return { kind: 'fatal', diagnostic: errText(e) }
  }
  if (opts.signal?.aborted) {
    return { kind: 'aborted', diagnostic: 'connect aborted by the caller before any node-pty co-provisioning channel was opened — nothing was written remotely' }
  }

  let stdoutWindow = ''
  return await runSshExecChannel<ProbeGateResult>({
    argv, ssh: opts.ssh, signal: opts.signal,
    onStdout: (chunk, settle) => {
      stdoutWindow = appendBoundedProbeStdout(stdoutWindow, chunk.toString('utf8'))
      const probe = parseProbeStdout(stdoutWindow)
      if (probe !== null) settle({ kind: 'probe', probe })
    },
    abortResult: () => ({
      kind: 'aborted',
      diagnostic: 'the node-pty probe was aborted by the caller — the probe is read-only, so nothing was written remotely'
    }),
    spawnErrorResult: (_program, message) =>
      ({ kind: 'fatal', diagnostic: `failed to spawn the ssh program for the node-pty probe: ${message}` }),
    classifyExit: (code, stderrTail) => {
      // Sentinel-less stream that ended: classify per REQ-009 with the excerpt bounded by the cap.
      const c = classifyProbeOutcome({ exitCode: code, stdout: stdoutWindow, stderrExcerpt: stderrTail })
      return c.kind === 'fatal' ? { kind: 'fatal', diagnostic: c.diagnostic } : { kind: 'probe', probe: c.probe }
    }
  })
}

type InstallGateResult =
  | { kind: 'ok' }
  | { kind: 'fatal'; diagnostic: string }
  | { kind: 'aborted'; diagnostic: string }

/** The transactional install exec channel (REQ-014/015/017): mid-install abort is INDETERMINATE
 *  (the remote may hold the previous install, none, or the complete verified new one). */
async function runNodePtyInstall(
  opts: BootstrapOptions, remoteAgentDir: string, payload: Buffer
): Promise<InstallGateResult & { indeterminate?: boolean }> {
  const nonce = (opts.nonce ?? defaultNonce)()
  let argv: string[]
  try {
    argv = buildSshExecArgv(opts.agent, buildNodePtyInstallCommand(remoteAgentDir, nonce))
  } catch (e) {
    return { kind: 'fatal', diagnostic: errText(e) }
  }

  return await runSshExecChannel<InstallGateResult & { indeterminate?: boolean }>({
    argv, ssh: opts.ssh, signal: opts.signal, stdinPayload: payload,
    abortResult: () => ({
      kind: 'aborted', indeterminate: true,
      diagnostic: 'node-pty install aborted before the remote outcome was observed — the install path holds either the PREVIOUS node-pty (or none) or the COMPLETE verified new one, never a tear; reconnecting will resolve it'
    }),
    spawnErrorResult: (_program, message) =>
      ({ kind: 'fatal', diagnostic: `failed to spawn the ssh program for the node-pty install: ${message}` }),
    classifyExit: (code, stderrTail) => {
      const stderrPart = stderrTail.length > 0 ? ` — stderr: ${stderrTail}` : ''
      if (code === 0) return { kind: 'ok' }
      if (code === NODE_PTY_BYTES_EXIT) {
        return {
          kind: 'fatal',
          diagnostic: `node-pty install failed: a byte-count/short-read mismatch was detected while streaming the prebuilt payload — nothing was promoted remotely; retry the connect${stderrPart}`
        }
      }
      if (code === NODE_PTY_SHA_EXIT) {
        return {
          kind: 'fatal',
          diagnostic: `node-pty install failed: a sha-256 checksum mismatch was detected verifying the received pty.node — nothing was promoted remotely; retry the connect${stderrPart}`
        }
      }
      if (code === NODE_PTY_RACE_EXIT) {
        return {
          kind: 'fatal',
          diagnostic: `node-pty install lost a concurrent-install promote collision against a DIFFERENT install already present on the remote (another connect got there first with a divergent payload) — this is not a transfer failure; reconnect and the next connect's probe will detect and repair the install deterministically${stderrPart}`
        }
      }
      if (code === 255) {
        return {
          kind: 'fatal',
          diagnostic: `ssh transport failure during the node-pty install (exit 255) — check host reachability and auth${stderrPart}`
        }
      }
      return { kind: 'fatal', diagnostic: `the node-pty install command exited ${code === null ? 'by signal' : code}${stderrPart}` }
    }
  })
}

/** What one node-pty co-provision pass established (REQ-016 needs this for the recovery cycle and
 *  the honest terminal wording). */
export interface CoProvisionEngagement {
  /** A skip or install decision on a MATCHED target ran this pass — eligible for the recovery
   *  cycle (REQ-016: "if co-provisioning ran this connect, decision skip OR install"). */
  engaged: boolean
  /** An install actually ran this pass (for the honest terminal wording — never claim an install
   *  was applied on a skip path, FINDING-021). */
  installed: boolean
  remoteAgentDir: string
}

export type CoProvisionPass =
  | { kind: 'final'; result: ConnectResult }        // no-match fatal / install fatal / aborted
  | { kind: 'proceed'; engagement: CoProvisionEngagement }

/** One node-pty co-provision pass: probe → classify → derive libc → select target → read+validate
 *  the LOCAL manifest → decide → (skip | install | proceed-unmanaged | fatal no-match). A `final`
 *  result short-circuits the whole connect; a `proceed` result continues to the agent connect and
 *  carries what this pass established (REQ-012..015). Used both for the initial pass and for the
 *  single recovery cycle (REQ-016). */
export async function runCoProvisionPass(opts: BootstrapOptions): Promise<CoProvisionPass> {
  const prebuiltRoot = opts.nodePty?.prebuiltRoot ?? ''
  const remoteAgentDir = opts.agent.remoteAgentDir ?? DEFAULT_REMOTE_AGENT_DIR
  const proceed = (engaged: boolean, installed: boolean): CoProvisionPass =>
    ({ kind: 'proceed', engagement: { engaged, installed, remoteAgentDir } })

  if (opts.signal?.aborted) {
    return {
      kind: 'final',
      result: {
        ok: false, kind: 'aborted',
        diagnostic: 'connect aborted by the caller before any node-pty co-provisioning channel was opened — nothing was written remotely'
      }
    }
  }

  const probeResult = await runNodePtyProbe(opts, remoteAgentDir)
  if (probeResult.kind === 'fatal') return { kind: 'final', result: { ok: false, kind: 'fatal', diagnostic: probeResult.diagnostic } }
  if (probeResult.kind === 'aborted') return { kind: 'final', result: { ok: false, kind: 'aborted', diagnostic: probeResult.diagnostic } }
  const probe = probeResult.probe

  const libc = deriveLibc(probe)
  const selection = selectPrebuiltTarget({ platform: probe.platform, arch: probe.arch, libc })

  if (!selection.ok) {
    if (probe.resolves === true) {
      opts.onDiagnostic?.(
        `connecting with an UNMANAGED node-pty: the remote (platform=${probe.platform}, arch=${probe.arch}, libc=${libc}) does not match this build's shipped linux-x64-glibc prebuilt, but a node-pty already resolves at ${remoteAgentDir}/node_modules/node-pty — proceeding without any upload`
      )
      return proceed(false, false)
    }
    return { kind: 'final', result: { ok: false, kind: 'fatal', diagnostic: noMatchDiagnostic(remoteAgentDir, selection.triple) } }
  }

  const bundleDir = join(prebuiltRoot, 'node-pty', selection.target)
  const local = readLocalManifest(bundleDir)
  if (!local.ok) return { kind: 'final', result: { ok: false, kind: 'fatal', diagnostic: local.reason } }

  const decision = decideNodePtyProvision(probe, selection, local.manifest)
  if (decision.kind === 'skip') return proceed(true, false)
  // selection.ok narrows decideNodePtyProvision to skip|install only — proceed-unmanaged/
  // no-match only arise on an unmatched selection, already handled above.

  // Per-file sha (ESC-003/FINDING-005, amended ESC-004/FINDING-022/024): the payload carries each
  // file's sha-256 sourced EXCLUSIVELY from the local manifest's `files` map — no self-compute
  // fallback (readLocalManifest already proved 1:1 parity with the bundle dir, so every non-marker
  // path is guaranteed present there). The marker file's own entry (excluded from that map by
  // design) is the one exception, computed from its bytes here.
  const files = walkBundleDir(bundleDir).map((f) => ({
    path: f.path,
    bytes: f.bytes,
    sha256: f.path === NODE_PTY_MARKER_FILE
      ? createHash('sha256').update(f.bytes).digest('hex')
      : local.manifest.files[f.path]
  }))
  const payload = encodeNodePtyPayload(files, local.manifest.ptyNodeSha256)
  const installResult = await runNodePtyInstall(opts, remoteAgentDir, payload)
  if (installResult.kind === 'ok') return proceed(true, true)
  if (installResult.kind === 'aborted') {
    return {
      kind: 'final',
      result: {
        ok: false, kind: 'aborted', diagnostic: installResult.diagnostic,
        ...(installResult.indeterminate === true ? { indeterminate: true } : {})
      }
    }
  }
  return { kind: 'final', result: { ok: false, kind: 'fatal', diagnostic: installResult.diagnostic } }
}

const NODE_PTY_NAME_RE = /node-pty/i
const MODULE_RESOLUTION_FAILURE_RE = /cannot find module|module_not_found/i

/** Detects the REQ-016 "co-provision ran but the agent still cannot resolve node-pty" shape from a
 *  connect fatal diagnostic (which embeds the launch's sanitized stderr). */
const looksLikeNodePtyResolutionFailure = (diagnostic: string): boolean =>
  NODE_PTY_NAME_RE.test(diagnostic) && MODULE_RESOLUTION_FAILURE_RE.test(diagnostic)

/** REQ-021 (MUST, decoupled): append the glibc-floor hint to ANY launch fatal whose sanitized
 *  stderr is GLIBC-class — independent of module-resolution detection. A no-op otherwise (the hint
 *  is '' when the stderr does not match a `GLIBC_x.y not found` pattern). */
const withGlibcHint = (diagnostic: string): string => {
  const hint = glibcFloorHint(diagnostic)
  return hint.length > 0 ? `${diagnostic} — ${hint}` : diagnostic
}

/** The terminal fatal after the single recovery cycle failed (REQ-016 honest wording): the
 *  install-ran variant states an install was applied and re-verified; the skip-path variant states
 *  a previously installed node-pty was found and verified on disk yet still would not load — the
 *  two MUST differ, and a skip path MUST NEVER claim an install was applied (FINDING-021). Both
 *  name the remove-and-reconnect escape hatch. */
function terminalNodePtyFatal(installed: boolean, remoteAgentDir: string, launchDiag: string): ConnectResult {
  const escape = `${remoteAgentDir}/node_modules/node-pty`
  const diagnostic = installed
    ? `the node-pty co-provision reported success: a node-pty install was applied (and re-verified on a second probe), yet the agent launch still could not resolve node-pty and no further attempts will be made — remove ${escape} on the host and reconnect (${launchDiag})`
    : `a previously installed node-pty was found and verified on disk (its marker, bare-specifier resolution, and the on-disk pty.node hash all matched), yet the agent still could not load it and no further attempts will be made — remove ${escape} on the host and reconnect so the next connect reinstalls it (${launchDiag})`
  return { ok: false, kind: 'fatal', diagnostic }
}

/** The single recovery cycle (REQ-016): re-probe → re-decide → (≤1 further install) → relaunch
 *  ONCE. This is the SECOND probe/install/launch — the hard cap (two probes, two installs, two
 *  launches per connect) holds because it runs at most once. */
async function runRecoveryCycle(
  opts: BootstrapOptions, installedBefore: boolean, remoteAgentDir: string, connect: ConnectFn
): Promise<ConnectResult> {
  const pass = await runCoProvisionPass(opts)
  if (pass.kind === 'final') return pass.result
  const installedNow = installedBefore || pass.engagement.installed

  const relaunch = await connect(opts)
  if (relaunch.ok) return relaunch
  if (relaunch.kind === 'aborted') return relaunch
  const diag = relaunch.kind === 'fatal' ? relaunch.diagnostic : `the agent launch classified "${relaunch.kind}"`
  // A GLIBC-class relaunch failure gets the hint, still no further recovery.
  if (glibcFloorHint(diag).length > 0) return { ok: false, kind: 'fatal', diagnostic: withGlibcHint(diag) }
  return terminalNodePtyFatal(installedNow, remoteAgentDir, diag)
}

/** Resolve a `fatal` agent-launch outcome under node-pty co-provisioning (REQ-016/REQ-021):
 *  - GLIBC-class stderr ⇒ decorate with the floor hint, NEVER recover (reinstalling the same
 *    binary cannot help an old glibc);
 *  - module-resolution stderr + co-provisioning engaged ⇒ the single recovery cycle when
 *    `canRecover` (the first launch), else the honest terminal wording (the launch cap is spent);
 *  - anything else ⇒ the fatal as-is (with a glibc hint if it happens to match). */
export async function resolveLaunchFatal(
  fatal: { diagnostic: string },
  opts: BootstrapOptions,
  engagement: CoProvisionEngagement | undefined,
  installedEver: boolean,
  canRecover: boolean,
  connect: ConnectFn
): Promise<ConnectResult> {
  const diagnostic = fatal.diagnostic
  if (glibcFloorHint(diagnostic).length > 0) {
    return { ok: false, kind: 'fatal', diagnostic: withGlibcHint(diagnostic) }
  }
  if (engagement?.engaged === true && looksLikeNodePtyResolutionFailure(diagnostic)) {
    if (canRecover) return await runRecoveryCycle(opts, installedEver, engagement.remoteAgentDir, connect)
    return terminalNodePtyFatal(installedEver, engagement.remoteAgentDir, diagnostic)
  }
  return { ok: false, kind: 'fatal', diagnostic: withGlibcHint(diagnostic) }
}
