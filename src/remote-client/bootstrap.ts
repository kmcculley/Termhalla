/**
 * Client-provisioned agent bootstrap over the system-ssh exec channel (REQ-010..REQ-016).
 *
 * connect → F15 client handshake over the child's stdio → classify any failure →
 * (provision: stream the bundled artifact, size-verified, atomically promoted → retry
 * exactly ONCE) → a live session handle or a specific, actionable failure.
 *
 * Version-lock (REQ-015, locked decision 2): ONE canonical `version` input drives BOTH
 * the handshake identity check and the remote install path. The caller injects it
 * together with the artifact path (in production: the repo manifest version paired with
 * the `out/agent/termhalla-agent.cjs` bundle, whose AGENT_VERSION was inlined from the
 * same manifest at build time — the artifact is the unit of version-locking). This module
 * never reads the manifest itself.
 *
 * The F15 machinery is REUSED from the one sanctioned barrel — never re-derived: the
 * client emits NOTHING until the agent hello arrives, and the reply frame comes from the
 * handshake machine (no hand-built hellos anywhere in this tree; frozen TEST-2005).
 *
 * Node-pty co-provisioning (feature 0023, REQ-016..021): when `options.nodePty` is present and
 * `ptyBackend` is (the default) `'node-pty'`, a probe → decide → (skip | install |
 * proceed-unmanaged | fatal no-match) gate runs BEFORE the sequence above — see
 * `coProvisionNodePty`. Absent `nodePty`, or `ptyBackend: 'fake'`, this module behaves exactly as
 * it did before this feature (REQ-018 — strictly additive, byte-identical legacy flow).
 */
import { randomBytes, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createFrameDecoder, createClientHandshake, encodeFrame } from '@shared/remote/protocol'
import type { WireFrame, DecodedItem } from '@shared/remote/protocol'
import {
  buildAgentLaunchCommand, buildAgentUploadCommand, buildSshExecArgv,
  remoteAgentInstallPath, DEFAULT_REMOTE_AGENT_DIR, LAUNCH_ABSENT_EXIT, UPLOAD_SIZE_MISMATCH_EXIT
} from './ssh-command'
import type { SshExecSeed } from './ssh-command'
import { spawnSsh, DEFAULT_SSH_PROGRAM } from './ssh-spawn'
import type { SshProgramOverride } from './ssh-spawn'
import { classifyConnectOutcome } from './classify'
import {
  buildNodePtyProbeCommand, buildNodePtyInstallCommand, classifyProbeOutcome, deriveLibc,
  selectPrebuiltTarget, decideNodePtyProvision, encodeNodePtyPayload, glibcFloorHint,
  parseProbeStdout, appendBoundedProbeStdout,
  NODE_PTY_MARKER_FILE, NODE_PTY_BYTES_EXIT, NODE_PTY_SHA_EXIT, NODE_PTY_RACE_EXIT
} from './prebuilt'
import type { NodePtyProbeResult, PrebuiltManifest, PlatformTriple } from './prebuilt'

const STDERR_TAIL_CHARS = 400

/** Strip C0/C1 control bytes (including ESC) so remote stderr can never smuggle terminal
 *  escape sequences into diagnostic strings a UI will later render (FINDING-001). The
 *  printable remainder of a stripped sequence is harmless residue. */
const sanitizeStderr = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')

/** Decode-level failure reasons whose classic real-world cause is a shell rc file printing
 *  to stdout on non-interactive exec, corrupting the frame stream (FINDING-006). */
const FRAMING_REASONS = new Set(['bad-json', 'bad-message', 'frame-too-large', 'decoder-dead'])

const RC_NOISE_HINT =
  ' (a classic cause: the remote login shell prints to stdout on non-interactive exec — e.g. an echo in a shell rc file — corrupting the frame stream before the agent hello; silence the rc output for non-interactive shells)'

/** Crypto-random temp-file nonce (REQ-013); injectable via `options.nonce` for
 *  deterministic tests. 16 lowercase hex chars. */
export const defaultNonce = (): string => randomBytes(8).toString('hex')

export interface AgentSessionHandle {
  /** The agent's version — string-identical to the injected client version. */
  version: string
  capabilities: string[]
  send(frame: WireFrame): void
  onFrame(cb: (frame: WireFrame) => void): () => void
  onExit(cb: (code: number | null) => void): () => void
  kill(): void
}

export type ConnectFailureKind =
  | 'absent' | 'version-mismatch' | 'fatal' | 'aborted' | 'provision-ineffective'

export type ConnectResult =
  | { ok: true; session: AgentSessionHandle }
  | { ok: false; kind: ConnectFailureKind; diagnostic: string; indeterminate?: boolean }

export type ProvisionResult =
  | { ok: true }
  | {
      ok: false
      kind: 'size-mismatch' | 'transport' | 'aborted' | 'other'
      exitCode: number | null
      diagnostic: string
      indeterminate?: boolean
    }

export interface BootstrapOptions {
  agent: SshExecSeed
  /** The ONE canonical version: handshake identity AND install path (REQ-015). */
  version: string
  /** Local path of the bundled agent artifact (required for provisioning). */
  artifactPath?: string
  /** Backend flag passed to the agent CLI (F16 contract). Default: the real backend. */
  ptyBackend?: 'node-pty' | 'fake'
  /** Test seam: substitute the ssh program (default: the system `ssh` on PATH). */
  ssh?: SshProgramOverride
  nonce?: () => string
  signal?: AbortSignal
  /** Node-pty co-provisioning (feature 0023, REQ-018). Additive: absent ⇒ the exec-channel
   *  sequence and every result stay BYTE-IDENTICAL to the pre-0023 flow. Present +
   *  `ptyBackend: 'node-pty'` (the default) ⇒ the co-provision gate (REQ-012..017) runs before
   *  the connect sequence above. Present + `ptyBackend: 'fake'` ⇒ ignored (no probe, no upload —
   *  the fake backend needs no native module). */
  nodePty?: { prebuiltRoot: string }
  onDiagnostic?: (line: string) => void
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Launch the (expected) installed agent and run the F15 client handshake (REQ-010/011). */
export async function connectAgent(opts: BootstrapOptions): Promise<ConnectResult> {
  let installPath: string
  let argv: string[]
  try {
    installPath = remoteAgentInstallPath(opts.agent.remoteAgentDir, opts.version)
    argv = buildSshExecArgv(opts.agent, buildAgentLaunchCommand(installPath, opts.ptyBackend ?? 'node-pty'))
  } catch (e) {
    return { ok: false, kind: 'fatal', diagnostic: errText(e) }
  }
  if (opts.signal?.aborted) {
    return { ok: false, kind: 'aborted', diagnostic: 'connect aborted by the caller before the ssh child was spawned' }
  }

  return await new Promise<ConnectResult>((resolvePromise) => {
    const child = spawnSsh(opts.ssh, argv)
    const decoder = createFrameDecoder()
    const handshake = createClientHandshake({ version: opts.version })
    const frameSubs = new Set<(frame: WireFrame) => void>()
    const exitSubs = new Set<(code: number | null) => void>()
    let stderrTail = ''
    let sawAnyFrame = false
    let established = false
    let settled = false

    const diag = (line: string): void => {
      try { opts.onDiagnostic?.(line) } catch { /* a consumer error never breaks the tunnel */ }
    }

    const teardownChild = (): void => {
      try { child.kill() } catch { /* already gone */ }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }

    const removeAbort = (): void => { opts.signal?.removeEventListener('abort', onAbort) }
    const settle = (r: ConnectResult): void => {
      if (settled) return
      settled = true
      removeAbort()
      if (!r.ok) teardownChild()
      resolvePromise(r)
    }
    function onAbort(): void {
      settle({ ok: false, kind: 'aborted', diagnostic: 'connect aborted by the caller before establishment — the ssh child was killed; nothing was written remotely' })
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const failFrom = (extra: { handshakeFailureKind?: string; exitCode?: number | null }): void => {
      const c = classifyConnectOutcome({
        sawAnyFrame,
        exitCode: extra.exitCode ?? null,
        stderrExcerpt: stderrTail,
        ...(extra.handshakeFailureKind !== undefined ? { handshakeFailureKind: extra.handshakeFailureKind } : {})
      })
      if (c.kind === 'absent') {
        settle({
          ok: false, kind: 'absent',
          diagnostic: `no agent artifact at ${installPath} (launch probe exited ${LAUNCH_ABSENT_EXIT} with no output) — provisioning will upload the bundled build`
        })
      } else if (c.kind === 'version-mismatch') {
        settle({
          ok: false, kind: 'version-mismatch',
          diagnostic: `the installed agent does not string-match client version "${opts.version}" (version-locked handshake) — provisioning will upload the matching build`
        })
      } else {
        const hint = extra.handshakeFailureKind !== undefined && FRAMING_REASONS.has(extra.handshakeFailureKind)
          ? RC_NOISE_HINT
          : ''
        settle({ ok: false, kind: 'fatal', diagnostic: `${c.diagnostic}${hint}` })
      }
    }

    child.on('error', (e) => {
      settle({
        ok: false, kind: 'fatal',
        diagnostic: `failed to spawn the ssh program "${opts.ssh?.program ?? DEFAULT_SSH_PROGRAM}": ${errText(e)} — is it on PATH?`
      })
    })
    child.stdin.on('error', () => { /* EPIPE on a dying child; the exit path reports */ })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderrTail = (stderrTail + sanitizeStderr(text)).slice(-STDERR_TAIL_CHARS)
      for (const line of text.split('\n')) {
        const clean = sanitizeStderr(line).trim()
        if (clean.length > 0) diag(clean)
      }
    })

    child.stdout.on('data', (chunk: Buffer) => {
      let items: DecodedItem[]
      try {
        items = decoder.push(chunk)
      } catch {
        return // decoder is dead after a fatal item — that item already routed to failFrom
      }
      for (const item of items) {
        sawAnyFrame = true
        if (settled && !established) continue
        if (!established) {
          if (item.kind === 'message') {
            const r = handshake.onMessage(item.frame)
            if (r.ok) {
              try {
                child.stdin.write(encodeFrame(r.reply))
              } catch (e) {
                settle({ ok: false, kind: 'fatal', diagnostic: `failed to send the handshake reply: ${errText(e)}` })
                return
              }
              established = true
              const session: AgentSessionHandle = {
                version: opts.version,
                capabilities: [...r.capabilities],
                send: (frame: WireFrame): void => {
                  try {
                    child.stdin.write(encodeFrame(frame))
                  } catch (e) {
                    diag(`send failed (session likely closed): ${errText(e)}`)
                  }
                },
                onFrame: (cb) => { frameSubs.add(cb); return () => { frameSubs.delete(cb) } },
                onExit: (cb) => { exitSubs.add(cb); return () => { exitSubs.delete(cb) } },
                kill: teardownChild
              }
              settle({ ok: true, session })
            } else {
              failFrom({ handshakeFailureKind: r.failure.reason })
            }
          } else {
            failFrom({ handshakeFailureKind: item.error.reason })
          }
        } else if (item.kind === 'message') {
          for (const cb of [...frameSubs]) cb(item.frame)
        } else {
          diag(`dropped a malformed post-establishment item (${item.error.reason}): ${item.error.message}`)
        }
      }
    })

    child.on('exit', (code) => {
      if (!settled) failFrom({ exitCode: code })
      for (const cb of [...exitSubs]) cb(code)
    })
  })
}

/** Stream the artifact over a second exec channel; size-verified atomic promote (REQ-012). */
export async function provisionAgent(opts: BootstrapOptions): Promise<ProvisionResult> {
  if (opts.artifactPath === undefined || opts.artifactPath.length === 0) {
    return { ok: false, kind: 'other', exitCode: null, diagnostic: 'no artifactPath was provided — provisioning needs the local path of the bundled agent build' }
  }
  let bytes: Buffer
  try {
    bytes = await readFile(opts.artifactPath)
  } catch (e) {
    return { ok: false, kind: 'other', exitCode: null, diagnostic: `could not read the agent artifact at ${opts.artifactPath}: ${errText(e)}` }
  }
  let argv: string[]
  try {
    const installPath = remoteAgentInstallPath(opts.agent.remoteAgentDir, opts.version)
    const nonce = (opts.nonce ?? defaultNonce)()
    argv = buildSshExecArgv(opts.agent, buildAgentUploadCommand(installPath, bytes.length, nonce))
  } catch (e) {
    return { ok: false, kind: 'other', exitCode: null, diagnostic: errText(e) }
  }
  if (opts.signal?.aborted) {
    return { ok: false, kind: 'aborted', exitCode: null, diagnostic: 'provision aborted by the caller before the ssh child was spawned — nothing was written remotely' }
  }

  return await new Promise<ProvisionResult>((resolvePromise) => {
    const child = spawnSsh(opts.ssh, argv)
    let stderrTail = ''
    let settled = false

    const removeAbort = (): void => { opts.signal?.removeEventListener('abort', onAbort) }
    const settle = (r: ProvisionResult): void => {
      if (settled) return
      settled = true
      removeAbort()
      if (!r.ok) {
        try { child.kill() } catch { /* already gone */ }
        child.stdin.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
      }
      resolvePromise(r)
    }
    function onAbort(): void {
      settle({
        ok: false, kind: 'aborted', exitCode: null, indeterminate: true,
        diagnostic: 'upload aborted before the remote outcome was observed — the atomic promote may or may not have completed, so the remote artifact state is INDETERMINATE (the install path holds either the previous artifact or the complete new one, never a tear); reconnect to find out'
      })
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (e) => {
      settle({
        ok: false, kind: 'other', exitCode: null,
        diagnostic: `failed to spawn the ssh program "${opts.ssh?.program ?? DEFAULT_SSH_PROGRAM}" for the upload: ${errText(e)}`
      })
    })
    child.stdin.on('error', () => { /* EPIPE from an early-exiting child; exit path reports */ })
    child.stdout.on('data', () => { /* the upload command produces no stdout */ })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + sanitizeStderr(chunk.toString('utf8'))).slice(-STDERR_TAIL_CHARS)
    })
    child.on('exit', (code) => {
      if (code === 0) settle({ ok: true })
      else if (code === UPLOAD_SIZE_MISMATCH_EXIT) {
        settle({
          ok: false, kind: 'size-mismatch', exitCode: code,
          diagnostic: `the remote received a byte count different from the ${bytes.length}-byte artifact — nothing was promoted (the temp file was removed); retry the provision${stderrTail ? ` — stderr: ${stderrTail}` : ''}`
        })
      } else if (code === 255) {
        settle({
          ok: false, kind: 'transport', exitCode: code,
          diagnostic: `ssh transport failure during the upload (exit 255) — check host reachability and auth${stderrTail ? ` — stderr: ${stderrTail}` : ''}`
        })
      } else {
        settle({
          ok: false, kind: 'other', exitCode: code,
          diagnostic: `the upload command exited ${code === null ? 'by signal' : code}${stderrTail ? ` — stderr: ${stderrTail}` : ''}`
        })
      }
    })

    child.stdin.write(bytes)
    child.stdin.end()
  })
}

// ── Node-pty co-provisioning (feature 0023, REQ-012..021) ─────────────────────────────────────
//
// Runs BEFORE the F19 connect/provision-once sequence, gated entirely on `opts.nodePty` being
// present and `ptyBackend` being (the default) `'node-pty'` (REQ-018). At most one probe and at
// most one install exec channel per `connectWithProvisioning` call (REQ-016).

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

/** The read-only probe exec channel (REQ-008/009/017): abort is always determinate here. */
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

  return await new Promise<ProbeGateResult>((resolvePromise) => {
    const child = spawnSsh(opts.ssh, argv)
    // REQ-026 (ESC-003/FINDING-010): a BOUNDED trailing window (never unbounded concatenation),
    // and settle the MOMENT a parseable sentinel line exists — tearing the child down instead of
    // waiting for stream end, so an endless-stdout remote can neither wedge the connect nor grow
    // memory in the privileged Electron main process.
    let stdoutWindow = ''
    let stderrTail = ''
    let settled = false

    const teardownChild = (): void => {
      try { child.kill() } catch { /* already gone */ }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }
    const removeAbort = (): void => { opts.signal?.removeEventListener('abort', onAbort) }
    const settle = (r: ProbeGateResult): void => {
      if (settled) return
      settled = true
      removeAbort()
      teardownChild()
      resolvePromise(r)
    }
    function onAbort(): void {
      settle({
        kind: 'aborted',
        diagnostic: 'the node-pty probe was aborted by the caller — the probe is read-only, so nothing was written remotely'
      })
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (e) => {
      settle({ kind: 'fatal', diagnostic: `failed to spawn the ssh program for the node-pty probe: ${errText(e)}` })
    })
    child.stdin.on('error', () => { /* EPIPE on a dying child; the exit path reports */ })
    child.stdin.end()
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return
      stdoutWindow = appendBoundedProbeStdout(stdoutWindow, chunk.toString('utf8'))
      const probe = parseProbeStdout(stdoutWindow)
      if (probe !== null) settle({ kind: 'probe', probe })
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + sanitizeStderr(chunk.toString('utf8'))).slice(-STDERR_TAIL_CHARS)
    })
    child.on('exit', (code) => {
      if (settled) return
      // Sentinel-less stream that ended: classify per REQ-009 with the excerpt bounded by the cap.
      const c = classifyProbeOutcome({ exitCode: code, stdout: stdoutWindow, stderrExcerpt: stderrTail })
      if (c.kind === 'fatal') settle({ kind: 'fatal', diagnostic: c.diagnostic })
      else settle({ kind: 'probe', probe: c.probe })
    })
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

  return await new Promise((resolvePromise) => {
    const child = spawnSsh(opts.ssh, argv)
    let stderrTail = ''
    let settled = false

    const removeAbort = (): void => { opts.signal?.removeEventListener('abort', onAbort) }
    const settle = (r: InstallGateResult & { indeterminate?: boolean }): void => {
      if (settled) return
      settled = true
      removeAbort()
      if (r.kind !== 'ok') {
        try { child.kill() } catch { /* already gone */ }
        child.stdin.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
      }
      resolvePromise(r)
    }
    function onAbort(): void {
      settle({
        kind: 'aborted', indeterminate: true,
        diagnostic: 'node-pty install aborted before the remote outcome was observed — the install path holds either the PREVIOUS node-pty (or none) or the COMPLETE verified new one, never a tear; reconnecting will resolve it'
      })
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (e) => {
      settle({ kind: 'fatal', diagnostic: `failed to spawn the ssh program for the node-pty install: ${errText(e)}` })
    })
    child.stdin.on('error', () => { /* EPIPE from an early-exiting child; exit path reports */ })
    child.stdout.on('data', () => { /* the install command produces no stdout on success */ })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + sanitizeStderr(chunk.toString('utf8'))).slice(-STDERR_TAIL_CHARS)
    })
    child.on('exit', (code) => {
      if (settled) return
      const stderrPart = stderrTail.length > 0 ? ` — stderr: ${stderrTail}` : ''
      if (code === 0) {
        settle({ kind: 'ok' })
      } else if (code === NODE_PTY_BYTES_EXIT) {
        settle({
          kind: 'fatal',
          diagnostic: `node-pty install failed: a byte-count/short-read mismatch was detected while streaming the prebuilt payload — nothing was promoted remotely; retry the connect${stderrPart}`
        })
      } else if (code === NODE_PTY_SHA_EXIT) {
        settle({
          kind: 'fatal',
          diagnostic: `node-pty install failed: a sha-256 checksum mismatch was detected verifying the received pty.node — nothing was promoted remotely; retry the connect${stderrPart}`
        })
      } else if (code === NODE_PTY_RACE_EXIT) {
        settle({
          kind: 'fatal',
          diagnostic: `node-pty install lost a concurrent-install promote collision against a DIFFERENT install already present on the remote (another connect got there first with a divergent payload) — this is not a transfer failure; reconnect and the next connect's probe will detect and repair the install deterministically${stderrPart}`
        })
      } else if (code === 255) {
        settle({
          kind: 'fatal',
          diagnostic: `ssh transport failure during the node-pty install (exit 255) — check host reachability and auth${stderrPart}`
        })
      } else {
        settle({ kind: 'fatal', diagnostic: `the node-pty install command exited ${code === null ? 'by signal' : code}${stderrPart}` })
      }
    })

    if (opts.signal?.aborted) { onAbort(); return }
    child.stdin.write(payload)
    child.stdin.end()
  })
}

/** What one node-pty co-provision pass established (REQ-016 needs this for the recovery cycle and
 *  the honest terminal wording). */
interface CoProvisionEngagement {
  /** A skip or install decision on a MATCHED target ran this pass — eligible for the recovery
   *  cycle (REQ-016: "if co-provisioning ran this connect, decision skip OR install"). */
  engaged: boolean
  /** An install actually ran this pass (for the honest terminal wording — never claim an install
   *  was applied on a skip path, FINDING-021). */
  installed: boolean
  remoteAgentDir: string
}

type CoProvisionPass =
  | { kind: 'final'; result: ConnectResult }        // no-match fatal / install fatal / aborted
  | { kind: 'proceed'; engagement: CoProvisionEngagement }

/** One node-pty co-provision pass: probe → classify → derive libc → select target → read+validate
 *  the LOCAL manifest → decide → (skip | install | proceed-unmanaged | fatal no-match). A `final`
 *  result short-circuits the whole connect; a `proceed` result continues to the agent connect and
 *  carries what this pass established (REQ-012..015). Used both for the initial pass and for the
 *  single recovery cycle (REQ-016). */
async function runCoProvisionPass(opts: BootstrapOptions): Promise<CoProvisionPass> {
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
 *  connectAgent() fatal diagnostic (which embeds the launch's sanitized stderr). */
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
  opts: BootstrapOptions, installedBefore: boolean, remoteAgentDir: string
): Promise<ConnectResult> {
  const pass = await runCoProvisionPass(opts)
  if (pass.kind === 'final') return pass.result
  const installedNow = installedBefore || pass.engagement.installed

  const relaunch = await connectAgent(opts)
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
async function resolveLaunchFatal(
  fatal: { diagnostic: string },
  opts: BootstrapOptions,
  engagement: CoProvisionEngagement | undefined,
  installedEver: boolean,
  canRecover: boolean
): Promise<ConnectResult> {
  const diagnostic = fatal.diagnostic
  if (glibcFloorHint(diagnostic).length > 0) {
    return { ok: false, kind: 'fatal', diagnostic: withGlibcHint(diagnostic) }
  }
  if (engagement?.engaged === true && looksLikeNodePtyResolutionFailure(diagnostic)) {
    if (canRecover) return await runRecoveryCycle(opts, installedEver, engagement.remoteAgentDir)
    return terminalNodePtyFatal(installedEver, engagement.remoteAgentDir, diagnostic)
  }
  return { ok: false, kind: 'fatal', diagnostic: withGlibcHint(diagnostic) }
}

/** The bootstrap policy (REQ-014): classify → provision → retry exactly ONCE. Feature 0023
 *  (REQ-016..021) inserts the node-pty co-provision gate BEFORE this sequence — see
 *  `runCoProvisionPass` — plus at most ONE recovery cycle on a module-resolution launch failure.
 *  Absent `opts.nodePty` (or `ptyBackend: 'fake'`), this function's behavior is byte-identical to
 *  the pre-0023 flow (REQ-018). */
export async function connectWithProvisioning(opts: BootstrapOptions): Promise<ConnectResult> {
  const useNodePty = opts.nodePty !== undefined && (opts.ptyBackend ?? 'node-pty') === 'node-pty'

  let engagement: CoProvisionEngagement | undefined
  let installedEver = false
  if (useNodePty) {
    const pass = await runCoProvisionPass(opts)
    if (pass.kind === 'final') return pass.result
    engagement = pass.engagement
    installedEver = engagement.installed
  }

  const first = await connectAgent(opts)
  if (first.ok) return first
  if (first.kind === 'aborted') return first
  if (first.kind === 'fatal') {
    return await resolveLaunchFatal(first, opts, engagement, installedEver, true)
  }

  const provision = await provisionAgent(opts)
  if (!provision.ok) {
    if (provision.kind === 'aborted') {
      return {
        ok: false, kind: 'aborted', diagnostic: provision.diagnostic,
        ...(provision.indeterminate === true ? { indeterminate: true } : {})
      }
    }
    return {
      ok: false, kind: 'fatal',
      diagnostic: `provisioning after a "${first.kind}" connect failure did not complete: ${provision.diagnostic}`
    }
  }

  const second = await connectAgent(opts)
  if (second.ok) return second
  if (second.kind === 'aborted') return second
  if (second.kind === 'fatal') {
    // The launch cap (two launches) is spent after the F19 upload leg — no recovery cycle here.
    return await resolveLaunchFatal(second, opts, engagement, installedEver, false)
  }
  return {
    ok: false, kind: 'provision-ineffective',
    diagnostic: `still ${second.kind} after provisioning (first attempt: ${first.kind}; exactly one upload was applied and reported success) — the uploaded artifact did not take effect at the install path; no further attempts will be made. If both attempts classified "absent", also verify the remote host exposes a node binary on the login shell's PATH — a missing node exits ${LAUNCH_ABSENT_EXIT} exactly like a missing artifact (FINDING-004)`
  }
}
