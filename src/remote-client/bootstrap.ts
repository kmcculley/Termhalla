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
 * The F15 machinery is REUSED from the one sanctioned barrel — never re-derived (frozen
 * TEST-2005): this module constructs the exact-version handshake machine; the shared connect
 * pump (`connect-pump.ts`, the 0024 FINDING-001 consolidation) owns the decoder/encode wire
 * plumbing for BOTH connect legs, and the shared exec-channel scaffold (`exec-channel.ts`,
 * quality-audit Group C #9) owns the one-shot command channels.
 *
 * Node-pty co-provisioning (feature 0023, REQ-016..021) lives in `co-provision.ts`: when
 * `options.nodePty` is present and `ptyBackend` is (the default) `'node-pty'`, a probe →
 * decide → (skip | install | proceed-unmanaged | fatal no-match) gate runs BEFORE the sequence
 * above. Absent `nodePty`, or `ptyBackend: 'fake'`, this module behaves exactly as it did
 * before that feature (REQ-018 — strictly additive, byte-identical legacy flow).
 */
import { readFile } from 'node:fs/promises'
import { createClientHandshake } from '@shared/remote/protocol'
import {
  buildAgentLaunchCommand, buildAgentUploadCommand, buildSshExecArgv,
  remoteAgentInstallPath, LAUNCH_ABSENT_EXIT, UPLOAD_SIZE_MISMATCH_EXIT
} from './ssh-command'
import type { SshExecSeed } from './ssh-command'
import type { SshProgramOverride } from './ssh-spawn'
import { runSshExecChannel, errText, defaultNonce } from './exec-channel'
import { runConnectPump, connectFailureResult } from './connect-pump'
import type { ConnectResult } from './connect-pump'
import { classifyConnectOutcome } from './classify'
import { connectDaemonAgent } from './bootstrap-daemon'
import { runCoProvisionPass, resolveLaunchFatal } from './co-provision'
import type { CoProvisionEngagement } from './co-provision'

export type { AgentSessionHandle, ConnectFailureKind, ConnectResult } from './connect-pump'
export { defaultNonce } from './exec-channel'

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
  /** Daemon-flow opt-in (feature 0024-agent-daemonization, REQ-013 — locked D6′). Additive:
   *  ABSENT ⇒ the launch command, exec-channel sequence, and every result stay BYTE-IDENTICAL to
   *  the pre-0024 flow (`connectAgent`, direct-exec). PRESENT (`{ workspaceId }`) ⇒ the daemon
   *  flow (`connectDaemonAgent` — spawn-then-attach over a persistent, PER-WORKSPACE
   *  unix-domain-socket daemon keyed by a token derived from `workspaceId`, so two same-host
   *  workspaces are fully independent, REQ-018) replaces the direct-exec launch/relaunch legs
   *  below; node-pty co-provisioning and the provision-once upload sequence keep running BEFORE it,
   *  in the same order, against the same version-embedded install path. All new failure kinds
   *  (incl. `daemon-protocol-drift`) surface through the EXISTING `ConnectFailureKind` values —
   *  this field never widens that union. */
  daemon?: { workspaceId: string }
}

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
  return await runConnectPump({
    argv, ssh: opts.ssh, signal: opts.signal, version: opts.version, onDiagnostic: opts.onDiagnostic,
    handshake: createClientHandshake({ version: opts.version }),
    classifyFailure: (extra, obs) => connectFailureResult(
      classifyConnectOutcome({
        sawAnyFrame: obs.sawAnyFrame,
        exitCode: extra.exitCode ?? null,
        stderrExcerpt: obs.stderrTail,
        ...(extra.handshakeFailureKind !== undefined ? { handshakeFailureKind: extra.handshakeFailureKind } : {})
      }),
      extra.handshakeFailureKind, installPath, opts.version
    )
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

  return await runSshExecChannel<ProvisionResult>({
    argv, ssh: opts.ssh, signal: opts.signal, stdinPayload: bytes,
    abortResult: () => ({
      ok: false, kind: 'aborted', exitCode: null, indeterminate: true,
      diagnostic: 'upload aborted before the remote outcome was observed — the atomic promote may or may not have completed, so the remote artifact state is INDETERMINATE (the install path holds either the previous artifact or the complete new one, never a tear); reconnect to find out'
    }),
    spawnErrorResult: (program, message) => ({
      ok: false, kind: 'other', exitCode: null,
      diagnostic: `failed to spawn the ssh program "${program}" for the upload: ${message}`
    }),
    classifyExit: (code, stderrTail) => {
      if (code === 0) return { ok: true }
      if (code === UPLOAD_SIZE_MISMATCH_EXIT) {
        return {
          ok: false, kind: 'size-mismatch', exitCode: code,
          diagnostic: `the remote received a byte count different from the ${bytes.length}-byte artifact — nothing was promoted (the temp file was removed); retry the provision${stderrTail ? ` — stderr: ${stderrTail}` : ''}`
        }
      }
      if (code === 255) {
        return {
          ok: false, kind: 'transport', exitCode: code,
          diagnostic: `ssh transport failure during the upload (exit 255) — check host reachability and auth${stderrTail ? ` — stderr: ${stderrTail}` : ''}`
        }
      }
      return {
        ok: false, kind: 'other', exitCode: code,
        diagnostic: `the upload command exited ${code === null ? 'by signal' : code}${stderrTail ? ` — stderr: ${stderrTail}` : ''}`
      }
    }
  })
}

/** Additive routing (feature 0024-agent-daemonization, REQ-013): `opts.daemon` absent ⇒ the
 *  pre-0024 direct-exec `connectAgent`, byte-identical (the SAME function reference — no new
 *  branch is taken); `opts.daemon: { workspaceId }` ⇒ the daemon-flow `connectDaemonAgent` (which
 *  derives the per-workspace scope token from `workspaceId`). */
const chooseConnect = (opts: BootstrapOptions): typeof connectAgent =>
  opts.daemon !== undefined ? connectDaemonAgent : connectAgent

/** The bootstrap policy (REQ-014): classify → provision → retry exactly ONCE. Feature 0023
 *  (REQ-016..021) inserts the node-pty co-provision gate BEFORE this sequence — see
 *  `runCoProvisionPass` (co-provision.ts) — plus at most ONE recovery cycle on a
 *  module-resolution launch failure. Absent `opts.nodePty` (or `ptyBackend: 'fake'`), this
 *  function's behavior is byte-identical to the pre-0023 flow (REQ-018). Absent `opts.daemon`,
 *  likewise byte-identical to the pre-0024 flow (REQ-013). */
export async function connectWithProvisioning(opts: BootstrapOptions): Promise<ConnectResult> {
  const useNodePty = opts.nodePty !== undefined && (opts.ptyBackend ?? 'node-pty') === 'node-pty'
  const connect = chooseConnect(opts)

  let engagement: CoProvisionEngagement | undefined
  let installedEver = false
  if (useNodePty) {
    const pass = await runCoProvisionPass(opts)
    if (pass.kind === 'final') return pass.result
    engagement = pass.engagement
    installedEver = engagement.installed
  }

  const first = await connect(opts)
  if (first.ok) return first
  if (first.kind === 'aborted') return first
  if (first.kind === 'fatal') {
    return await resolveLaunchFatal(first, opts, { engagement, installedEver, canRecover: true }, connect)
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

  const second = await connect(opts)
  if (second.ok) return second
  if (second.kind === 'aborted') return second
  if (second.kind === 'fatal') {
    // The launch cap (two launches) is spent after the F19 upload leg — no recovery cycle here.
    return await resolveLaunchFatal(second, opts, { engagement, installedEver, canRecover: false }, connect)
  }
  return {
    ok: false, kind: 'provision-ineffective',
    diagnostic: `still ${second.kind} after provisioning (first attempt: ${first.kind}; exactly one upload was applied and reported success) — the uploaded artifact did not take effect at the install path; no further attempts will be made. If both attempts classified "absent", also verify the remote host exposes a node binary on the login shell's PATH — a missing node exits ${LAUNCH_ABSENT_EXIT} exactly like a missing artifact (FINDING-004)`
  }
}
