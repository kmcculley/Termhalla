// Pure, Electron-free, `../api`-free status mappers for the Orky pipeline (feature 0004). Every
// function here is TOTAL (never throws on empty/malformed input) and PURE (no Date.now, no I/O, no
// Math.random — `now`, `thresholdMs`, and `activePhase` are ALWAYS injected by the caller). This is the
// determinism + data-provenance anchor.
//
// DETECTION MODEL (ESC-001, gate-based full roll-up): the live phase of the ACTIVE feature is
// `active.json.phase` (injected as `activePhase`); for a NON-active feature it is the gate frontier
// (`gateFrontier`) — the lagging `state.json.phase` is a last-resort fallback only. "Needs a human" is
// derived from GATES (every autonomous gate through `doc-sync` passed AND `human-review` not yet
// passed), never from a `state.json.phase === 'human-review'` string the real pipeline never sets.
//
// PROVENANCE of the phase list (REQ-029 / FINDING-PROV-001): `ORKY_PHASES` mirrors the EXACT recorded
// `state.json.gates` keys and the gatekeeper's `DRIVER_WORK_PHASES` (the driver/work phase list) — it is
// deliberately NOT Orky's separate 9-entry constant `PHASE_ORDER` (which Orky's own source labels its
// canonical ordering) = ['intake','brainstorm','spec','plan','tests','implement','review','doc-sync','human'].
// Two intentional differences a future maintainer MUST NOT "re-sync" away:
//   • `intake` (a pre-pipeline artifact step that records NO gate) is excluded — prepending it would
//     wrongly make M = 9.
//   • Orky's trailing `human` is recorded on disk as the `human-review` gate key, so it is renamed to
//     `human-review` here — renaming it back to `human` would zero `gateN`'s match on the recorded key.
// The tests verify only that the code matches THIS embedded list; upstream drift is a manual data-update
// follow-up (see docs/features/orky-status.md), never something a test can catch.
import type { OrkyPhase, OrkyKind, OrkyReason, OrkyFeatureStatus, OrkyPaneStatus } from './types'

export type { OrkyPhase, OrkyKind, OrkyReason, OrkyFeatureStatus, OrkyPaneStatus } from './types'

/** The mirrored Orky gate phases, in order (= `DRIVER_WORK_PHASES` + the recorded gate keys; see the
 *  provenance note above — NOT Orky's separate 9-entry `PHASE_ORDER` constant).
 *  `human-review` is the final real gate and counts toward M (REQ-001). The single source of truth. */
export const ORKY_PHASES: readonly OrkyPhase[] = [
  'brainstorm', 'spec', 'plan', 'tests', 'implement', 'review', 'doc-sync', 'human-review'
] as const

/** The 7 AUTONOMOUS gates through `doc-sync` (= `ORKY_PHASES` minus the human `human-review` gate).
 *  When every one of these has passed and `human-review` has not, the run is awaiting a human (REQ-005). */
export const ORKY_AUTONOMOUS_PHASES: readonly OrkyPhase[] = [
  'brainstorm', 'spec', 'plan', 'tests', 'implement', 'review', 'doc-sync'
] as const

/** Default stall threshold (a Termhalla-side UI heuristic, NOT an Orky-derived value): a live executing
 *  phase with no heartbeat for >120s reads as stalled (REQ-003). Injectable via the tracker's opts. */
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

// ── Timezone-safe timestamp parsing (REQ-028 / FINDING-DET-001) ───────────────────────────────────
/** Parse an Orky ISO timestamp to epoch ms timezone-safely: a tz-less ISO datetime (no `Z`/offset) is
 *  interpreted as UTC (NOT the machine-local zone that `Date.parse` would assume), so identical bytes
 *  yield the same epoch ms — and the same stall (REQ-003) / recency (REQ-004/007) verdict — on any host.
 *  A `Z`/offset is honored unchanged; a non-string or unparseable value → `null` (never throws). */
export function parseOrkyTimestamp(s: unknown): number | null {
  if (typeof s !== 'string') return null
  let str = s.trim()
  const hasTz = /[zZ]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)
  // Only a tz-less ISO datetime (date + time) is normalized to UTC; everything else is left as-is.
  if (!hasTz && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) str += 'Z'
  const t = Date.parse(str)
  return Number.isNaN(t) ? null : t
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

// ── Gate frontier / live phase for a non-active feature (REQ-023) ─────────────────────────────────
/** The live phase of a non-active feature: the phase in `ORKY_PHASES` immediately AFTER the
 *  highest-index canonical gate with `passed === true`. `{}`/malformed → `'brainstorm'`; all 8 passed →
 *  `null` (complete). Total; never throws (FINDING-DA-002 — the lagging `state.json.phase` is NOT used). */
export function gateFrontier(gates: unknown): OrkyPhase | null {
  if (!isObject(gates)) return ORKY_PHASES[0]
  let highest = -1
  for (let i = 0; i < ORKY_PHASES.length; i++) {
    const g = gates[ORKY_PHASES[i]] as OrkyGate | undefined
    if (g?.passed === true) highest = i
  }
  if (highest === ORKY_PHASES.length - 1) return null
  return ORKY_PHASES[highest + 1]
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

// ── Executing / complete predicates ───────────────────────────────────────────────────────────────
/** Pipeline complete = the `human-review` gate has passed (the real terminal state; `state.json.phase`
 *  stays at `doc-sync`). */
function isComplete(f: OrkyFeatureRaw): boolean {
  return f.gates['human-review']?.passed === true
}
/** Executing-ness is read off the LIVE phase (REQ-023): a live phase is in flight when it is set, the
 *  pipeline is not complete, and that phase has no gate entry yet (the gate has not run/passed). Keyed on
 *  the live phase — NOT the lagging `state.json.phase` — so a hang in the long late phases can stall. */
function isExecutingPhase(f: OrkyFeatureRaw, livePhase: OrkyPhase | null): boolean {
  if (!livePhase) return false
  if (isComplete(f)) return false
  return f.gates[livePhase] === undefined
}

// ── Stall detection (REQ-003 / REQ-023) ───────────────────────────────────────────────────────────
/** `true` only when the ACTIVE feature has a live executing phase, a live tick, and now-tick > threshold.
 *  Executing-ness keys on `activePhase` (`active.json.phase`), the LIVE phase, not `state.json.phase`. */
export function isStalled(
  activeFeatureSlug: string | null,
  feature: OrkyFeatureRaw,
  activePhase: OrkyPhase | null,
  lastTickAt: number | null,
  now: number,
  thresholdMs: number = STALL_THRESHOLD_MS
): boolean {
  if (!activeFeatureSlug) return false                       // a non-active feature has no live heartbeat
  if (feature.feature !== activeFeatureSlug) return false
  if (!isExecutingPhase(feature, activePhase)) return false  // finished / not in flight → finished wins
  if (lastTickAt == null) return false                       // no heartbeat to compare → not stalled, no throw
  return now - lastTickAt > thresholdMs                      // strict `>`: the boundary itself is not stalled
}

// ── Per-feature mapping into the terminal-status model (REQ-004/005/006/023) ──────────────────────
/** Map a raw feature into the wire-shaped `OrkyFeatureStatus`. Total + pure (injected now/threshold/
 *  activePhase). `phase` is the LIVE phase: `activePhase` for the active feature, the gate frontier for
 *  a non-active feature. A non-active feature is NEVER `busy` (no per-project heartbeat). */
export function orkyFeatureStatus(
  raw: OrkyFeatureRaw,
  findings: OrkyFinding[] | undefined | null,
  isActive: boolean,
  activePhase: OrkyPhase | null,
  lastTickAt: number | null,
  now: number,
  thresholdMs: number = STALL_THRESHOLD_MS
): OrkyFeatureStatus {
  const f = normalizeFeatureRaw(raw)
  const slug = f.feature || '(unknown)'
  const complete = isComplete(f)
  const openBlocking = openBlockingCount(normalizeFindings(findings))

  // LIVE phase (REQ-023): active → active.json.phase; non-active → gate frontier. The lagging
  // state.json.phase is a last-resort fallback ONLY (never overrides either).
  const livePhase: OrkyPhase | null = isActive
    ? (activePhase ?? gateFrontier(f.gates))
    : gateFrontier(f.gates)

  // A halted gate failure = the live phase's gate ran and did NOT pass (explicit passed:false).
  const failed = livePhase != null && f.gates[livePhase]?.passed === false

  // needs-human is GATE-BASED (REQ-005): awaiting-human when every autonomous gate through doc-sync
  // passed and human-review is not yet passed; OR an open escalation; OR a stall. Priority
  // escalation > stalled > human-review. A complete feature is done → never needs-human.
  const openEsc = f.escalations.find(e => isObject(e) && e.status === 'open')
  const stalled = isStalled(isActive ? f.feature : null, f, activePhase, lastTickAt, now, thresholdMs)
  const autonomousAllPassed = ORKY_AUTONOMOUS_PHASES.every(p => f.gates[p]?.passed === true)
  const awaitingHuman = autonomousAllPassed && f.gates['human-review']?.passed !== true

  let reason: OrkyReason = null
  if (!complete) {
    if (openEsc) reason = 'escalation'
    else if (stalled) reason = 'stalled'
    else if (awaitingHuman) reason = 'human-review'
  }
  const needsHuman = reason !== null

  let kind: OrkyKind
  if (complete) kind = 'done'
  else if (needsHuman) kind = 'needs-input'
  else if (isActive && isExecutingPhase(f, livePhase)) kind = 'busy' // non-active is never busy (REQ-004)
  else kind = 'idle'

  // lastActivityAt (REQ-004 / FINDING-DA-004): max of the feature's own gate timestamps (tz-safe),
  // falling back to / max'd with the active heartbeat for the active feature, so the recency tiebreak
  // (REQ-007) orders non-active features rather than collapsing them all to 0.
  let lastActivityAt = 0
  for (const p of ORKY_PHASES) {
    const t = parseOrkyTimestamp(f.gates[p]?.at)
    if (t != null && t > lastActivityAt) lastActivityAt = t
  }
  if (isActive && lastTickAt != null && lastTickAt > lastActivityAt) lastActivityAt = lastTickAt

  // Actionable detail (CONV-001) — always names the feature + the concrete reason, never bare text.
  let detail: string
  if (reason === 'escalation') {
    detail = `${slug}: open escalation ${openEsc?.id ?? '(unknown)'}` +
      (openEsc?.reason ? ` (${openEsc.reason})` : '') + ' — needs you'
  } else if (reason === 'stalled') {
    const mins = Math.max(1, Math.round((now - (lastTickAt ?? now)) / 60_000))
    detail = `${slug}: stalled ${mins}m — no heartbeat`
  } else if (reason === 'human-review') {
    detail = `${slug}: awaiting human-review (gates ${gateN(f.gates)}/${ORKY_PHASES.length}) — needs you`
  } else if (complete) {
    detail = `${slug}: pipeline complete`
  } else if (failed) {
    detail = `${slug}: ${livePhase ?? 'gate'} gate failed`
  } else if (kind === 'busy') {
    detail = `${slug}: ${livePhase ?? 'running'} in progress`
  } else {
    detail = `${slug}: ${livePhase ?? 'idle'}`
  }

  return {
    feature: slug,
    kind,
    phase: livePhase,
    gateN: gateN(f.gates),
    gateM: ORKY_PHASES.length,
    openBlocking,
    needsHuman,
    failed,
    reason,
    lastActivityAt,
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

/** A feature belongs in the popover roll-up when it is busy / needs-input / failed / done-WITH-open
 *  items. A CLEAN `done` feature (`done` ∧ `openBlocking === 0`) and `idle` are EXCLUDED (REQ-020 /
 *  FINDING-DA-003) so the popover does not accumulate every merged feature as a wall of stale rows. */
function inPopover(f: OrkyFeatureStatus): boolean {
  if (f.failed) return true
  if (f.kind === 'busy' || f.kind === 'needs-input') return true
  if (f.kind === 'done' && f.openBlocking > 0) return true
  return false
}

/** Total + pure pane roll-up. The popover `features` exclude clean-done + idle, ranked by the selector. */
export function orkyPaneStatus(features: OrkyFeatureStatus[] | undefined | null): OrkyPaneStatus {
  const list = Array.isArray(features) ? features.filter(isObject) as OrkyFeatureStatus[] : []
  const chip = selectChipFeature(list)
  if (!chip) {
    return { kind: 'idle', label: '', needsHuman: false, failed: false, features: [], chipFeature: null }
  }
  const shown = list.filter(inPopover).sort(compareFeatures)
  return {
    kind: chip.kind,
    label: chipLabel(chip),
    needsHuman: chip.needsHuman,
    failed: chip.failed,
    features: shown,
    chipFeature: chip.feature
  }
}
