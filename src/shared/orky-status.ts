// Pure, Electron-free, `../api`-free status mappers for the Orky pipeline (feature 0004). Every
// function here is TOTAL (never throws on empty/malformed input) and PURE (no Date.now, no I/O, no
// Math.random — `now` and `thresholdMs` are ALWAYS injected by the caller). This is the determinism
// + data-provenance anchor: the hardcoded ORKY_PHASES list is the single source of truth that mirrors
// Orky's upstream pipeline (see docs/features/orky-status.md for the drift note).
import type { OrkyPhase, OrkyKind, OrkyReason, OrkyFeatureStatus, OrkyPaneStatus } from './types'

export type { OrkyPhase, OrkyKind, OrkyReason, OrkyFeatureStatus, OrkyPaneStatus } from './types'

/** Canonical pipeline phase order; `human-review` is the final real gate and counts toward M (REQ-001). */
export const ORKY_PHASES: readonly OrkyPhase[] = [
  'brainstorm', 'spec', 'plan', 'tests', 'implement', 'review', 'doc-sync', 'human-review'
] as const

/** Default stall threshold: a live executing phase with no heartbeat for >120s is stalled (REQ-003). */
export const STALL_THRESHOLD_MS = 120_000

// ── On-disk (parse-layer) raw shapes ────────────────────────────────────────────────────────────
export interface OrkyGate { passed?: boolean; at?: string }
export interface OrkyEscalation { id?: string; status?: string; reason?: string }
export interface OrkyFeatureRaw {
  feature: string
  phase: string | null
  gates: Record<string, OrkyGate>
  escalations: OrkyEscalation[]
}
export interface OrkyFinding {
  status?: string
  severity?: string
  contract_violation?: boolean
}
export interface OrkyActive {
  feature?: string
  projectRoot?: string
  phase?: string
  lastTickAt?: string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── Normalizers (TASK-002) — totalize a raw JSON.parse result into a safe-defaulted shape ─────────
/** Normalize a raw findings value into an array; a non-array / undefined / garbage value → `[]`. */
export function normalizeFindings(raw: unknown): OrkyFinding[] {
  return Array.isArray(raw) ? (raw as OrkyFinding[]) : []
}

/** Normalize a raw feature (state.json) value into a safe shape — never throws (REQ-019). */
export function normalizeFeatureRaw(raw: unknown): OrkyFeatureRaw {
  const o = isObject(raw) ? raw : {}
  const gates = isObject(o.gates) ? (o.gates as Record<string, OrkyGate>) : {}
  const escalations = Array.isArray(o.escalations) ? (o.escalations as OrkyEscalation[]) : []
  return {
    feature: typeof o.feature === 'string' ? o.feature : '',
    phase: typeof o.phase === 'string' ? o.phase : null,
    gates,
    escalations
  }
}

// ── Gate N/M (REQ-001) ───────────────────────────────────────────────────────────────────────────
/** Count the canonical phases whose gate has `passed === true`. Unknown keys ignored; total. */
export function gateN(gates: Record<string, OrkyGate> | undefined | null): number {
  if (!isObject(gates)) return 0
  let n = 0
  for (const p of ORKY_PHASES) if (gates[p]?.passed === true) n++
  return n
}

// ── Open-blocking findings (REQ-002) ──────────────────────────────────────────────────────────────
const BLOCKING_SEVERITY = new Set(['CRITICAL', 'HIGH'])
/** Count open findings that are CRITICAL/HIGH OR a contract violation. Total; no silent capping. */
export function openBlockingCount(findings: OrkyFinding[] | undefined | null): number {
  if (!Array.isArray(findings)) return 0
  let n = 0
  for (const f of findings) {
    if (!isObject(f)) continue
    if (f.status !== 'open') continue
    if (BLOCKING_SEVERITY.has(String(f.severity)) || f.contract_violation === true) n++
  }
  return n
}

// ── Executing / complete / failed predicates over a normalized raw feature ────────────────────────
function isComplete(f: OrkyFeatureRaw): boolean {
  return f.gates['human-review']?.passed === true
}
/** Executing = a phase is in flight with no gate entry yet for the current phase (and not complete). */
function isExecuting(f: OrkyFeatureRaw): boolean {
  if (!f.phase) return false
  if (isComplete(f)) return false
  return f.gates[f.phase] === undefined
}
function isFailed(f: OrkyFeatureRaw): boolean {
  return !!f.phase && f.gates[f.phase]?.passed === false
}

// ── Stall detection (REQ-003) ─────────────────────────────────────────────────────────────────────
/** `true` only when the ACTIVE feature has an executing phase, a live tick, and now-tick > threshold. */
export function isStalled(
  activeFeatureSlug: string | null,
  feature: OrkyFeatureRaw,
  lastTickAt: number | null,
  now: number,
  thresholdMs: number = STALL_THRESHOLD_MS
): boolean {
  if (!activeFeatureSlug) return false
  const f = normalizeFeatureRaw(feature)
  if (f.feature !== activeFeatureSlug) return false   // non-active feature has no live heartbeat
  if (!isExecuting(f)) return false                   // finished / halted → never stalled (finished wins)
  if (lastTickAt == null) return false                // no heartbeat to compare → not stalled, no throw
  return now - lastTickAt > thresholdMs               // strict `>`: the boundary itself is not stalled
}

// ── Per-feature mapping into the terminal-status model (REQ-004/005/006) ──────────────────────────
/** Map a raw feature into the wire-shaped `OrkyFeatureStatus`. Total + pure (injected now/threshold). */
export function orkyFeatureStatus(
  raw: OrkyFeatureRaw,
  findings: OrkyFinding[] | undefined | null,
  isActive: boolean,
  lastTickAt: number | null,
  now: number,
  thresholdMs: number = STALL_THRESHOLD_MS
): OrkyFeatureStatus {
  const f = normalizeFeatureRaw(raw)
  const slug = f.feature || '(unknown)'
  const complete = isComplete(f)
  const failed = isFailed(f)
  const openBlocking = openBlockingCount(normalizeFindings(findings))

  const openEsc = f.escalations.find(e => isObject(e) && e.status === 'open')
  const stalled = isStalled(isActive ? f.feature : null, f, isActive ? lastTickAt : null, now, thresholdMs)
  const inHumanReview = f.phase === 'human-review' && !complete

  // needs-you priority: escalation > stalled > human-review (REQ-005 / structured `reason`).
  let reason: OrkyReason = null
  if (openEsc) reason = 'escalation'
  else if (stalled) reason = 'stalled'
  else if (inHumanReview) reason = 'human-review'
  const needsHuman = reason !== null

  let kind: OrkyKind
  if (complete) kind = 'done'
  else if (needsHuman) kind = 'needs-input'
  else if (isExecuting(f)) kind = 'busy'
  else kind = 'idle'

  // Actionable detail (CONV-001) — always names the feature + the concrete reason, never bare text.
  let detail: string
  if (reason === 'escalation') {
    detail = `${slug}: open escalation ${openEsc?.id ?? '(unknown)'}` +
      (openEsc?.reason ? ` (${openEsc.reason})` : '') + ' — needs you'
  } else if (reason === 'stalled') {
    const mins = Math.max(1, Math.round((now - (lastTickAt ?? now)) / 60_000))
    detail = `${slug}: stalled ${mins}m — no heartbeat`
  } else if (reason === 'human-review') {
    detail = `${slug}: awaiting human-review — needs you`
  } else if (complete) {
    detail = `${slug}: pipeline complete`
  } else if (failed) {
    detail = `${slug}: ${f.phase ?? 'gate'} gate failed`
  } else if (kind === 'busy') {
    detail = `${slug}: ${f.phase ?? 'running'} in progress`
  } else {
    detail = `${slug}: ${f.phase ?? 'idle'}`
  }

  return {
    feature: slug,
    kind,
    phase: f.phase as OrkyPhase | null,
    gateN: gateN(f.gates),
    gateM: ORKY_PHASES.length,
    openBlocking,
    needsHuman,
    failed,
    reason,
    lastActivityAt: isActive ? (lastTickAt ?? 0) : 0,
    detail
  }
}

// ── Deterministic chip selector (REQ-007) ─────────────────────────────────────────────────────────
const REASON_RANK: Record<Exclude<OrkyReason, null>, number> = {
  escalation: 0, stalled: 1, 'human-review': 2
}
function reasonRank(r: OrkyReason): number {
  return r == null ? 3 : REASON_RANK[r]
}
/** Total ordering: needsHuman-first, then reason rank, then newer activity, then feature-id ascending. */
function compareFeatures(a: OrkyFeatureStatus, b: OrkyFeatureStatus): number {
  if (a.needsHuman !== b.needsHuman) return a.needsHuman ? -1 : 1
  const ra = reasonRank(a.reason), rb = reasonRank(b.reason)
  if (ra !== rb) return ra - rb
  if (a.lastActivityAt !== b.lastActivityAt) return b.lastActivityAt - a.lastActivityAt
  return a.feature < b.feature ? -1 : a.feature > b.feature ? 1 : 0
}

/** The single most-needs-you feature, fully order-independent. Empty input → null. */
export function selectChipFeature(features: OrkyFeatureStatus[] | undefined | null): OrkyFeatureStatus | null {
  if (!Array.isArray(features) || features.length === 0) return null
  return [...features].sort(compareFeatures)[0]
}

// ── Pane roll-up + chip label (REQ-007/008/020/021) ───────────────────────────────────────────────
function chipLabel(f: OrkyFeatureStatus): string {
  const base = `${f.feature} · ${f.phase} · ${f.gateN}/${f.gateM}`
  return f.openBlocking > 0 ? `${base} · ●${f.openBlocking} open` : base
}

/** Total + pure pane roll-up. The popover `features` are ALL non-Idle features, ranked. */
export function orkyPaneStatus(features: OrkyFeatureStatus[] | undefined | null): OrkyPaneStatus {
  const list = Array.isArray(features) ? features.filter(isObject) as OrkyFeatureStatus[] : []
  const chip = selectChipFeature(list)
  if (!chip) {
    return { kind: 'idle', label: '', needsHuman: false, failed: false, features: [], chipFeature: null }
  }
  const nonIdle = list.filter(f => f.kind !== 'idle').sort(compareFeatures)
  return {
    kind: chip.kind,
    label: chipLabel(chip),
    needsHuman: chip.needsHuman,
    failed: chip.failed,
    features: nonIdle,
    chipFeature: chip.feature
  }
}
