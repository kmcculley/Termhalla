import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { OrkyActionResult } from '@shared/types'
import {
  validateResolveEscalationRequest,
  validateSubmitWorkRequest,
  validateRecordHumanGateRequest,
  validateDriveStatusRequest
} from '@shared/orky-action-validate'
import { mapCliRunToResult, type CliRun } from '@shared/orky-action-result'
import { runOrkyCli } from './orky-cli-runner'
import { locateOrkyCli, describeMissingCli } from './orky-cli-locate'
import { normalizeProjectRoot } from './validate-root'
import { OrkyActionAuditLog, type OrkyActionAuditRecord } from './orky-action-audit'
import { OrkyActionQueue } from './orky-action-queue'

/**
 * The `OrkyActionDispatcher` service (feature 0007, TASK-008) — the single main-process implementation
 * of the four `orkyAction:*` actions (`resolveEscalation`/`submitWork`/`recordHumanGate`/`driveStatus`).
 * Termhalla's first write-capable IPC surface into an Orky-adopted project: EVERY mutation is performed
 * by invoking one of Orky's own CLIs (`feedback emit`, `gatekeeper resolve-escalation`,
 * `gatekeeper record`); this dispatcher never writes a file under any `.orky/` tree itself (REQ-019),
 * never spawns an agent, and never drives the pipeline (D1). The ONLY four Orky subcommands this file
 * may ever invoke are the hard-coded literals below ('emit', 'resolve-escalation', 'record', 'drive') —
 * no request field ever selects a subcommand string (REQ-016).
 *
 * Security layering, in order, on every action: request validation (REQ-014) -> server-side project-root
 * allowlist against `registry.roots()` (D3/REQ-004) -> server-side feature-slug confinement, featureDir
 * built here, never renderer-supplied (REQ-005) -> Orky CLI location resolution (REQ-012) -> (for
 * mutating actions) per-featureDir serialization (REQ-015) -> the CLI invocation itself
 * (abortable/unref()'d/timeout-bounded, REQ-010) -> total exit-code/JSON mapping (REQ-011). EVERY
 * invocation that reaches this dispatcher — success or rejection — appends one append-only audit record
 * (REQ-013) before returning; a sender rejected at the IPC-registrar boundary never reaches this class
 * at all (REQ-003), so it is never audited here.
 */

export type RunCli = (
  cliPath: string,
  args: string[],
  opts?: { timeoutMs?: number; signal?: AbortSignal }
) => Promise<CliRun>
export type LocateOrkyCli = (kind: 'gatekeeper' | 'feedback') => string | null

export interface OrkyActionDispatcherDeps {
  registry: { roots(): string[] }       // the SAME app-wide OrkyRegistry instance (feature 0005)
  auditLog: OrkyActionAuditLog
  queue: OrkyActionQueue
  runCli?: RunCli                        // default: the real runOrkyCli
  locateOrkyCli?: LocateOrkyCli           // default: the real locateOrkyCli bound to process.env
  now?: () => number                     // default: Date.now
}

const HUMAN_GATES = new Set(['brainstorm', 'human-review'])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function extractString(raw: unknown, field: string): string | undefined {
  if (!isPlainObject(raw)) return undefined
  const v = raw[field]
  return typeof v === 'string' ? v : undefined
}

/** A redaction-safe projection of the raw request for the audit log (REQ-013): structural fields
 *  (feature/gate/verdict/escalationId/phase) are copied verbatim; free-text human-authored fields
 *  (decision/title/detail/evidence) are captured as `<field>Length: number` ONLY, never the raw text. */
function summarizeArgs(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!isPlainObject(raw)) return out
  for (const field of ['feature', 'gate', 'verdict', 'escalationId', 'phase']) {
    const v = raw[field]
    if (typeof v === 'string') out[field] = v
  }
  for (const field of ['decision', 'title', 'detail', 'evidence']) {
    const v = raw[field]
    if (typeof v === 'string') out[`${field}Length`] = v.length
  }
  return out
}

type FeatureDirResult = { ok: true; featureDir: string } | { ok: false; errorKind: 'feature-not-found'; error: string }

export class OrkyActionDispatcher {
  private readonly registry: { roots(): string[] }
  private readonly auditLog: OrkyActionAuditLog
  private readonly queue: OrkyActionQueue
  private readonly runCli: RunCli
  private readonly locateCli: LocateOrkyCli
  private readonly now: () => number
  private readonly controllers = new Set<AbortController>()

  constructor(deps: OrkyActionDispatcherDeps) {
    this.registry = deps.registry
    this.auditLog = deps.auditLog
    this.queue = deps.queue
    this.runCli = deps.runCli ?? runOrkyCli
    this.locateCli = deps.locateOrkyCli ?? ((kind) => locateOrkyCli(kind))
    this.now = deps.now ?? Date.now
  }

  async resolveEscalation(req: unknown, windowId: number | null = null): Promise<OrkyActionResult> {
    const result = await this.doResolveEscalation(req)
    await this.recordAudit('resolveEscalation', windowId, req, result)
    return result
  }

  async submitWork(req: unknown, windowId: number | null = null): Promise<OrkyActionResult> {
    const result = await this.doSubmitWork(req)
    await this.recordAudit('submitWork', windowId, req, result)
    return result
  }

  async recordHumanGate(req: unknown, windowId: number | null = null): Promise<OrkyActionResult> {
    const result = await this.doRecordHumanGate(req)
    await this.recordAudit('recordHumanGate', windowId, req, result)
    return result
  }

  async driveStatus(req: unknown, windowId: number | null = null): Promise<OrkyActionResult> {
    const result = await this.doDriveStatus(req)
    await this.recordAudit('driveStatus', windowId, req, result)
    return result
  }

  /** Aborts every in-flight `AbortController` this instance created for a CLI call. No owned
   *  timers/watchers otherwise — the CLI-runner's children are already `unref()`'d and self-terminating
   *  on timeout. Exists for symmetry with the composition-root disposer contract. */
  dispose(): void {
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  // ── resolveEscalation (REQ-006) ────────────────────────────────────────────────────────────────
  private async doResolveEscalation(req: unknown): Promise<OrkyActionResult> {
    const v = validateResolveEscalationRequest(req)
    if (!v.ok) return { ok: false, path: null, dispatched: false, errorKind: 'invalid-args', error: v.error }
    const { projectRoot, feature, escalationId, decision } = v.req

    const rootCheck = this.checkRoot(projectRoot)
    if (!rootCheck.ok) return { ok: false, path: null, dispatched: false, errorKind: 'root-not-allowed', error: rootCheck.error }

    const fdir = await this.resolveFeatureDir(projectRoot, feature)
    if (!fdir.ok) return { ok: false, path: null, dispatched: false, errorKind: fdir.errorKind, error: fdir.error }
    const featureDir = fdir.featureDir

    const feedbackCli = this.locateCli('feedback')
    if (!feedbackCli) return { ok: false, path: null, dispatched: false, errorKind: 'orky-cli-not-found', error: describeMissingCli('feedback') }

    return this.queue.run(featureDir, async () => {
      const emitArgs = ['emit', '--app', projectRoot, '--type', 'decision', '--feature', feature, '--payload', JSON.stringify({ escalationId, decision })]
      const emitRun = await this.runWithAbort(feedbackCli, emitArgs)
      const emitMapped = mapCliRunToResult('resolveEscalation', 'feedback', emitRun)
      if (!emitMapped.ok) {
        return { ok: false, path: 'feedback', dispatched: false, errorKind: emitMapped.errorKind, error: emitMapped.error, exitCode: emitMapped.exitCode } as OrkyActionResult
      }
      const emitData = (emitMapped.data ?? {}) as { mode?: string }
      if (emitData.mode !== 'noop') {
        return { ok: true, path: 'feedback', feedback: 'enabled', dispatched: true, data: emitMapped.data, exitCode: emitMapped.exitCode } as OrkyActionResult
      }

      const gatekeeperCli = this.locateCli('gatekeeper')
      if (!gatekeeperCli) {
        return { ok: false, path: 'feedback', feedback: 'disabled', dispatched: false, errorKind: 'orky-cli-not-found', error: describeMissingCli('gatekeeper') } as OrkyActionResult
      }
      const fallbackArgs = ['resolve-escalation', '--feature', featureDir, '--id', escalationId, '--decision', decision]
      const fallbackRun = await this.runWithAbort(gatekeeperCli, fallbackArgs)
      const fallbackMapped = mapCliRunToResult('resolveEscalation', 'gatekeeper', fallbackRun)
      if (!fallbackMapped.ok) {
        return { ok: false, path: 'gatekeeper', feedback: 'disabled', dispatched: false, errorKind: fallbackMapped.errorKind, error: fallbackMapped.error, exitCode: fallbackMapped.exitCode } as OrkyActionResult
      }
      return { ok: true, path: 'gatekeeper', feedback: 'disabled', dispatched: true, data: fallbackMapped.data, exitCode: fallbackMapped.exitCode } as OrkyActionResult
    })
  }

  // ── submitWork (REQ-007) — feedback-only; disabled is a DISTINCT non-dispatch failure ──────────
  private async doSubmitWork(req: unknown): Promise<OrkyActionResult> {
    const v = validateSubmitWorkRequest(req)
    if (!v.ok) return { ok: false, path: null, dispatched: false, errorKind: 'invalid-args', error: v.error }
    const { projectRoot, feature, title, detail, phase } = v.req

    const rootCheck = this.checkRoot(projectRoot)
    if (!rootCheck.ok) return { ok: false, path: null, dispatched: false, errorKind: 'root-not-allowed', error: rootCheck.error }

    let featureDir: string | undefined
    if (feature !== undefined) {
      const fdir = await this.resolveFeatureDir(projectRoot, feature)
      if (!fdir.ok) return { ok: false, path: null, dispatched: false, errorKind: fdir.errorKind, error: fdir.error }
      featureDir = fdir.featureDir
    }

    const feedbackCli = this.locateCli('feedback')
    if (!feedbackCli) return { ok: false, path: null, dispatched: false, errorKind: 'orky-cli-not-found', error: describeMissingCli('feedback') }

    const queueKey = featureDir ?? projectRoot
    return this.queue.run(queueKey, async () => {
      const payload: Record<string, unknown> = { title }
      if (detail !== undefined) payload.detail = detail
      if (phase !== undefined) payload.phase = phase
      const args = [
        'emit', '--app', projectRoot, '--type', 'work.request',
        ...(feature !== undefined ? ['--feature', feature] : []),
        '--payload', JSON.stringify(payload)
      ]
      const run = await this.runWithAbort(feedbackCli, args)
      const mapped = mapCliRunToResult('submitWork', 'feedback', run)
      if (!mapped.ok) {
        return { ok: false, path: 'feedback', dispatched: false, errorKind: mapped.errorKind, error: mapped.error, exitCode: mapped.exitCode } as OrkyActionResult
      }
      const data = (mapped.data ?? {}) as { mode?: string }
      if (data.mode !== 'noop') {
        return { ok: true, path: 'feedback', feedback: 'enabled', dispatched: true, data: mapped.data, exitCode: mapped.exitCode } as OrkyActionResult
      }
      return {
        ok: false,
        path: 'feedback',
        feedback: 'disabled',
        dispatched: false,
        errorKind: 'feedback-disabled',
        error: `the feedback control plane is disabled for ${projectRoot}; work items cannot be submitted until it is enabled`,
        exitCode: mapped.exitCode
      } as OrkyActionResult
    })
  }

  // ── recordHumanGate (REQ-008) — gate restricted server-side, NEVER --force ─────────────────────
  private async doRecordHumanGate(req: unknown): Promise<OrkyActionResult> {
    const v = validateRecordHumanGateRequest(req)
    if (!v.ok) return { ok: false, path: null, dispatched: false, errorKind: 'invalid-args', error: v.error }
    const { projectRoot, feature, gate, verdict, evidence } = v.req

    if (!HUMAN_GATES.has(gate)) {
      return { ok: false, path: null, dispatched: false, errorKind: 'gate-not-allowed', error: `gate '${gate}' may not be recorded through this action (allowed: brainstorm, human-review)` }
    }

    const rootCheck = this.checkRoot(projectRoot)
    if (!rootCheck.ok) return { ok: false, path: null, dispatched: false, errorKind: 'root-not-allowed', error: rootCheck.error }

    const fdir = await this.resolveFeatureDir(projectRoot, feature)
    if (!fdir.ok) return { ok: false, path: null, dispatched: false, errorKind: fdir.errorKind, error: fdir.error }
    const featureDir = fdir.featureDir

    const gatekeeperCli = this.locateCli('gatekeeper')
    if (!gatekeeperCli) return { ok: false, path: null, dispatched: false, errorKind: 'orky-cli-not-found', error: describeMissingCli('gatekeeper') }

    return this.queue.run(featureDir, async () => {
      const args = [
        'record', '--feature', featureDir, '--gate', gate, '--verdict', verdict,
        ...(evidence !== undefined ? ['--evidence', evidence] : [])
      ]
      const run = await this.runWithAbort(gatekeeperCli, args)
      const mapped = mapCliRunToResult('recordHumanGate', 'gatekeeper', run)
      if (!mapped.ok) {
        return { ok: false, path: 'gatekeeper', dispatched: false, errorKind: mapped.errorKind, error: mapped.error, exitCode: mapped.exitCode } as OrkyActionResult
      }
      return { ok: true, path: 'gatekeeper', dispatched: true, data: mapped.data, exitCode: mapped.exitCode } as OrkyActionResult
    })
  }

  // ── driveStatus (REQ-009) — read-only, bypasses the queue, dispatched:false always ──────────────
  private async doDriveStatus(req: unknown): Promise<OrkyActionResult> {
    const v = validateDriveStatusRequest(req)
    if (!v.ok) return { ok: false, path: null, dispatched: false, errorKind: 'invalid-args', error: v.error }
    const { projectRoot, feature } = v.req

    const rootCheck = this.checkRoot(projectRoot)
    if (!rootCheck.ok) return { ok: false, path: null, dispatched: false, errorKind: 'root-not-allowed', error: rootCheck.error }

    const fdir = await this.resolveFeatureDir(projectRoot, feature)
    if (!fdir.ok) return { ok: false, path: null, dispatched: false, errorKind: fdir.errorKind, error: fdir.error }
    const featureDir = fdir.featureDir

    const gatekeeperCli = this.locateCli('gatekeeper')
    if (!gatekeeperCli) return { ok: false, path: null, dispatched: false, errorKind: 'orky-cli-not-found', error: describeMissingCli('gatekeeper') }

    const args = ['drive', '--feature', featureDir]
    const run = await this.runWithAbort(gatekeeperCli, args)
    const mapped = mapCliRunToResult('driveStatus', 'gatekeeper', run)
    if (!mapped.ok) {
      return { ok: false, path: 'gatekeeper', dispatched: false, errorKind: mapped.errorKind, error: mapped.error, exitCode: mapped.exitCode }
    }
    return { ok: true, path: 'gatekeeper', dispatched: false, data: mapped.data, exitCode: mapped.exitCode }
  }

  // ── shared helpers ───────────────────────────────────────────────────────────────────────────
  /** Membership test against `registry.roots()` (D3/REQ-004) — the SHARED `normalizeProjectRoot`
   *  comparison key (CONV-010), never a raw renderer argument, never pane-only membership. */
  private checkRoot(projectRoot: string): { ok: true } | { ok: false; error: string } {
    const key = normalizeProjectRoot(projectRoot)
    const known = this.registry.roots().some((r) => normalizeProjectRoot(r) === key)
    if (!known) return { ok: false, error: `project ${projectRoot} is not a tracked Orky project; add it via the registry first` }
    return { ok: true }
  }

  /** Builds `join(projectRoot, '.orky', 'features', slug)` SERVER-SIDE (never renderer-supplied,
   *  REQ-005) and confirms it exists as a directory. `slug` has already passed TASK-002's
   *  single-path-segment shape validation, so the resolved path is guaranteed confined under
   *  `<projectRoot>/.orky/features/`.
   *
   *  Deliberately SYNCHRONOUS (`statSync`, not `fs/promises`'s `stat`): this is a fast, tiny existence
   *  check, and keeping it synchronous means two concurrent dispatcher calls for DIFFERENT feature dirs
   *  never race each other's real disk-I/O completion order — each call's synchronous prefix (through
   *  this check) runs to completion before the next `await` boundary, so `queue.run()` for a given
   *  featureDir is always reached in call order (REQ-015's "concurrent actions on two different feature
   *  dirs run without serializing" acceptance requires no ordering coupling, but relying on real,
   *  variable-latency async I/O to prove call order would make that acceptance flaky by construction). */
  private async resolveFeatureDir(projectRoot: string, slug: string): Promise<FeatureDirResult> {
    const featureDir = join(projectRoot, '.orky', 'features', slug)
    try {
      const s = statSync(featureDir)
      if (!s.isDirectory()) return { ok: false, errorKind: 'feature-not-found', error: `feature '${slug}' was not found under ${projectRoot}` }
    } catch {
      return { ok: false, errorKind: 'feature-not-found', error: `feature '${slug}' was not found under ${projectRoot}` }
    }
    return { ok: true, featureDir }
  }

  /** Runs one CLI invocation through an `AbortController` this instance owns (REQ-010) so `dispose()`
   *  can abort any in-flight child. */
  private async runWithAbort(cliPath: string, args: string[]): Promise<CliRun> {
    const controller = new AbortController()
    this.controllers.add(controller)
    try {
      return await this.runCli(cliPath, args, { signal: controller.signal })
    } finally {
      this.controllers.delete(controller)
    }
  }

  /** Appends one audit record for EVERY invocation that reaches this dispatcher — success or a
   *  dispatcher-level rejection alike (REQ-013). Best-effort (OrkyActionAuditLog.append never throws);
   *  never alters the returned OrkyActionResult. */
  private async recordAudit(action: string, windowId: number | null, rawReq: unknown, result: OrkyActionResult): Promise<void> {
    const record: OrkyActionAuditRecord = {
      ts: this.now(),
      windowId,
      action,
      projectRoot: extractString(rawReq, 'projectRoot') ?? '',
      argsSummary: summarizeArgs(rawReq),
      ok: result.ok,
      path: result.path,
      dispatched: result.dispatched
    }
    const feature = extractString(rawReq, 'feature')
    if (feature !== undefined) record.feature = feature
    if (result.errorKind !== undefined) record.errorKind = result.errorKind
    if (result.exitCode !== undefined) record.exitCode = result.exitCode
    // Best-effort, defensively — `OrkyActionAuditLog.append` itself never throws/rejects, but this
    // guard also tolerates a caller-supplied `auditLog` that does not honor that contract (REQ-013:
    // an audit-write failure must never alter/fail the action's own returned result).
    try {
      await this.auditLog.append(record)
    } catch (err) {
      console.error('[orky-action-dispatcher] audit append failed:', err)
    }
  }
}
