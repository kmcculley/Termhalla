import type {
  OrkyReason,
  OrkyRootDetailResult,
  ResolveEscalationRequest,
  RecordHumanGateRequest,
  DriveStatusRequest
} from '@shared/types'

/**
 * The PURE core of the shared entry-action layer (feature 0008, D5/REQ-011) — deliberately free of
 * React, the store, and the renderer api module, so it can be driven behaviorally under the
 * node-env vitest harness (the repo's testability rule: renderer pure logic injects its IPC call
 * as an argument). The composition point (orky-entry-actions.tsx) supplies the real
 * `registryDetail` pull and dispatches through F7's bridges; everything decision-shaped lives HERE
 * so F8 (the decision-queue rows) and F10 (the OrkyPane feature rows) share ONE source of truth
 * for keys, binding, request building and result honesty.
 *
 * Contents:
 *  - the cross-instance single-flight registry (REQ-007): a MODULE-SCOPE gate keyed on
 *    (projectRoot, featureSlug, action) that every mounted hook instance in the window consults;
 *  - escalation identity binding + submit-time re-verification (REQ-003, FINDING-003);
 *  - the request builders (REQ-004 — exact keys, byte-verbatim values, no smuggling);
 *  - the result-honesty classifier (REQ-008/REQ-009 — keyed ONLY on ok/dispatched/errorKind).
 */

/** The stable identity an entry's actions key on. F8 supplies it from a queue row (no
 *  escalationId — the row never carries one); F10 supplies it from an OrkyPane detail feature,
 *  where the display-time escalation id is already in hand. */
export interface OrkyEntryTarget {
  projectRoot: string
  featureSlug: string
  reason: OrkyReason
  escalationId?: string
}

/** The async F7-dispatching action kinds (the single-flight/pending state participants).
 *  resume-in-terminal is NOT one — it is a synchronous pane commit (REQ-014). */
export type OrkyEntryActionKind = 'answer' | 'preview'

/** The injected F9 detail pull — `(root) => api.registryDetail(root)` at the composition point. */
export type RegistryDetailPull = (root: string) => Promise<OrkyRootDetailResult>

export type EscalationBinding =
  | { ok: true; escalationId: string; escalationReason: string | null }
  | { ok: false; message: string }

export type SettledOutcome =
  | { status: 'success'; message: string }
  | { status: 'failure'; kind: string; error: string; message: string; indeterminate: boolean }

/** The widened result shape the classifier keys on: F7's own OrkyActionResult is structurally
 *  assignable, and `errorKind` is a plain string because the renderer-synthesized 'ipc-failure'
 *  kind is deliberately NOT in the F7 union. */
export interface OrkyActionSettleInput {
  ok: boolean
  dispatched: boolean
  errorKind?: string
  error?: string
  data?: unknown
}

// ── REQ-002: the answer mode is chosen from the entry's needs-you reason, never invented ─────────

export function answerModeFor(reason: OrkyReason): 'escalation' | 'human-review' | null {
  if (reason === 'escalation') return 'escalation'
  if (reason === 'human-review') return 'human-review'
  return null // 'stalled' (nothing to resolve/record) and null (never queued) offer no answer
}

// ── REQ-007: the cross-instance single-flight gate ───────────────────────────────────────────────

/** NUL separator (CONV-039): no OS permits it inside a path, and feature slugs are single path
 *  segments — so two DISTINCT (projectRoot, featureSlug, action) tuples can never collide. */
const KEY_SEP = '\u0000'

export function flightKey(projectRoot: string, featureSlug: string, action: OrkyEntryActionKind): string {
  return `${projectRoot}${KEY_SEP}${featureSlug}${KEY_SEP}${action}`
}

/** The SHARED in-flight registry — module scope, one instance per window, so every mounted
 *  consumer (an F8 row AND an F10 pane row for the same target) meets the same gate. Never a
 *  per-instance ref (REQ-007/FINDING-004). */
const flights = new Map<string, Promise<unknown>>()
const flightListeners = new Set<() => void>()

function notifyFlights(): void {
  for (const listener of Array.from(flightListeners)) listener()
}

/** Whether a flight is currently registered for `key` — the pending derivation EVERY mounted
 *  instance reads, so all of them render the pending state together. */
export function isInFlight(key: string): boolean {
  return flights.has(key)
}

/** Notified on every flight acquire AND release — the seam that lets a second mount of the same
 *  target re-render its pending state. Returns the unsubscribe. */
export function subscribeFlights(listener: () => void): () => void {
  flightListeners.add(listener)
  return () => { flightListeners.delete(listener) }
}

/** At most one flight per key: an existing flight is returned AS-IS (the same promise reference —
 *  the second gesture is a no-op, never a queued duplicate); otherwise `fn` starts and the gate is
 *  released on settle — resolve OR reject — regardless of any caller's mount state (REQ-010). */
export function withSingleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = flights.get(key)
  if (existing) return existing as Promise<T>
  const flight = fn().finally(() => {
    flights.delete(key)
    notifyFlights()
  })
  flights.set(key, flight)
  notifyFlights()
  return flight
}

// ── REQ-003: escalation identity — bound at display time, re-verified at submit time ─────────────

/** Locate the ONE detail feature the target names: match by the unique dir `slug` OR by
 *  `status.feature` (the aggregate's identity field). Zero or several matches are unbindable —
 *  never a guess. */
function matchFeature(detail: Extract<OrkyRootDetailResult, { ok: true }>, featureSlug: string) {
  const matched = detail.features.filter(f => f.slug === featureSlug || f.status.feature === featureSlug)
  return matched.length === 1 ? matched[0] : matched.length
}

/** Display-time binding: a supplied `target.escalationId` (the F10 path) binds AS-IS with zero
 *  pulls; otherwise ONE fresh detail pull binds the FIRST escalation with status 'open' in
 *  state.json array order — byte-for-byte the same selection the aggregate used to mark the row
 *  `reason:'escalation'`. The id is NEVER read out of free-text `status.detail` and NEVER
 *  fabricated: every unbindable shape refuses with a specific, actionable message. */
export async function bindEscalationTarget(
  target: OrkyEntryTarget,
  registryDetail: RegistryDetailPull
): Promise<EscalationBinding> {
  if (typeof target.escalationId === 'string' && target.escalationId.length > 0) {
    return { ok: true, escalationId: target.escalationId, escalationReason: null }
  }
  let detail: OrkyRootDetailResult
  try {
    detail = await registryDetail(target.projectRoot)
  } catch (err) {
    return { ok: false, message: `couldn't read this project's Orky detail to bind the escalation (${String(err)}) — try again once the registry answers` }
  }
  if (!detail.ok) {
    return { ok: false, message: `couldn't read this project's Orky detail to bind the escalation: ${detail.error}` }
  }
  const feature = matchFeature(detail, target.featureSlug)
  if (typeof feature === 'number') {
    return feature === 0
      ? { ok: false, message: `no feature matching "${target.featureSlug}" exists in this project's Orky detail — the queue entry may be stale` }
      : { ok: false, message: `"${target.featureSlug}" matches more than one feature in this project's Orky detail — a target can't be picked safely` }
  }
  const open = feature.escalations.find(e => e.status === 'open')
  if (!open) {
    return { ok: false, message: `no open escalation exists on "${target.featureSlug}" right now — it may already be resolved elsewhere` }
  }
  if (typeof open.id !== 'string' || open.id.length === 0) {
    return { ok: false, message: `the open escalation on "${target.featureSlug}" carries no id — answer it from an Orky session instead` }
  }
  return { ok: true, escalationId: open.id, escalationReason: open.reason ? open.reason : null }
}

/** Submit-time re-verification (FINDING-003): a FRESH detail pull; the bound id must still appear
 *  as an OPEN escalation on the matched feature. Identity beats position — a bound id that is
 *  still open verifies even when it is no longer first — and a changed world refuses honestly
 *  ("changed — re-open to answer" class) without ever substituting a different escalation. */
export async function verifyEscalationTarget(
  target: OrkyEntryTarget,
  boundId: string,
  registryDetail: RegistryDetailPull
): Promise<EscalationBinding> {
  let detail: OrkyRootDetailResult
  try {
    detail = await registryDetail(target.projectRoot)
  } catch (err) {
    return { ok: false, message: `the open escalation for this feature may have changed (the verification read failed: ${String(err)}) — re-open to answer` }
  }
  if (!detail.ok) {
    return { ok: false, message: `the open escalation for this feature may have changed (the verification read failed: ${detail.error}) — re-open to answer` }
  }
  const feature = matchFeature(detail, target.featureSlug)
  if (typeof feature === 'number') {
    return { ok: false, message: 'the feature this escalation belonged to changed underneath the answer — re-open to answer' }
  }
  const stillOpen = feature.escalations.find(e => e.id === boundId && e.status === 'open')
  if (!stillOpen) {
    return { ok: false, message: 'the open escalation for this feature changed — nothing was sent; re-open to answer' }
  }
  return { ok: true, escalationId: boundId, escalationReason: stillOpen.reason ? stillOpen.reason : null }
}

// ── REQ-004: requests built from EXACTLY the entry identity + the inline input ───────────────────

export function buildResolveEscalationRequest(
  target: OrkyEntryTarget,
  escalationId: string,
  decision: string
): ResolveEscalationRequest {
  // decision byte-verbatim as typed — no trim, no flag-guard, no re-encode (F7 owns validation)
  return { projectRoot: target.projectRoot, feature: target.featureSlug, escalationId, decision }
}

export function buildRecordHumanGateRequest(
  target: OrkyEntryTarget,
  verdict: 'pass' | 'fail',
  evidence?: string
): RecordHumanGateRequest {
  const req: RecordHumanGateRequest = {
    projectRoot: target.projectRoot,
    feature: target.featureSlug,
    gate: 'human-review',
    verdict
  }
  // an empty/whitespace-only evidence field means ABSENCE: the key is omitted, never sent as ''
  if (typeof evidence === 'string' && evidence.trim().length > 0) req.evidence = evidence
  return req
}

export function buildDriveStatusRequest(target: OrkyEntryTarget): DriveStatusRequest {
  return { projectRoot: target.projectRoot, feature: target.featureSlug }
}

// ── REQ-008/REQ-009: result honesty, keyed ONLY on F7's own ok/dispatched/errorKind ──────────────

/** The kinds whose failure leaves a MUTATING answer's fate genuinely unknown (CONV-015 class):
 *  a timed-out child, a renderer↔main transport failure, and — per FINDING-006 — cli-unparseable,
 *  which folds together a completed child with an unreadable report AND a spawn-class failure
 *  whose child never ran. None of them proves a non-dispatch. */
const INDETERMINATE_KINDS = new Set(['cli-timeout', 'cli-unparseable', 'ipc-failure'])

/** The ONE indeterminate-outcome classification, exported so every failure surface (incl.
 *  OrkyCaptureModal's in-modal error region and detached toast — 2026-07-17 audit Finding 7)
 *  shares it instead of hand-coding a kind list that drifts (the modal had omitted
 *  cli-unparseable, rendering the DEFINITE "rejected" copy for an outcome that proves nothing). */
export const isIndeterminateKind = (kind: string): boolean => INDETERMINATE_KINDS.has(kind)

export function settleAnswer(
  reason: 'escalation' | 'human-review',
  result: OrkyActionSettleInput
): SettledOutcome {
  if (result.ok && result.dispatched) {
    return {
      status: 'success',
      message: reason === 'escalation'
        ? 'Escalation answered — the decision was submitted.'
        : 'Human-review verdict recorded.'
    }
  }
  if (result.ok) {
    // ok but dispatched:false on an ANSWER landed nothing durable — never durable-success copy.
    return {
      status: 'failure',
      kind: 'not-dispatched',
      error: result.error ?? '',
      message: 'The answer settled without landing durably — nothing was recorded. Re-open the entry and try again.',
      indeterminate: false
    }
  }
  const kind = result.errorKind ?? 'cli-error'
  const error = result.error ?? 'the action settled without an error message'
  if (kind === 'feedback-disabled') {
    // the DISTINCT no-write outcome: enabling the write path is an audited human decision made
    // outside Termhalla (ADR-027) — no enable affordance, no duplicate warning.
    return {
      status: 'failure',
      kind,
      error,
      message: `Nothing was written — this project's Orky feedback path is disabled. ${error} Enabling it is an audited human decision made outside Termhalla (ADR-027).`,
      indeterminate: false
    }
  }
  if (isIndeterminateKind(kind)) {
    return {
      status: 'failure',
      kind,
      error,
      message: `The outcome is uncertain — the answer may or may not have landed. ${error} The command may still finish; retrying may create a duplicate.`,
      indeterminate: true
    }
  }
  return { status: 'failure', kind, error, message: `The answer failed: ${error}`, indeterminate: false }
}

export function settlePreview(result: OrkyActionSettleInput): SettledOutcome {
  if (result.ok) {
    // driveStatus is READ-ONLY and dispatched:false ALWAYS — the preview names the computed next
    // action and claims no mutation whatsoever. The REAL gk drive() output is STRUCTURED
    // ({next, phase?, reason?, …} — gatekeeper.js:843-904), so the message carries the phase
    // (WHICH phase to run is the load-bearing datum) and the reason (WHY a human is awaited) as
    // carried, never flattened away (FINDING-013): "next: run-phase spec",
    // "next: await-human — open escalation".
    const data = result.data as { next?: unknown; phase?: unknown; reason?: unknown } | undefined
    const next = typeof data?.next === 'string' && data.next.length > 0 ? data.next : 'unknown'
    const phase = typeof data?.phase === 'string' && data.phase.length > 0 ? ` ${data.phase}` : ''
    const reason = typeof data?.reason === 'string' && data.reason.length > 0 ? ` — ${data.reason}` : ''
    return { status: 'success', message: `next: ${next}${phase}${reason}` }
  }
  const kind = result.errorKind ?? 'cli-error'
  const error = result.error ?? 'the preview read settled without an error message'
  if (isIndeterminateKind(kind)) {
    // the same classifier, but a READ cannot duplicate anything: safe-retry wording only.
    return {
      status: 'failure',
      kind,
      error,
      message: `The preview read may not have completed. ${error} A retry is safe — reading changes nothing.`,
      indeterminate: true
    }
  }
  return { status: 'failure', kind, error, message: `The preview failed: ${error}`, indeterminate: false }
}
