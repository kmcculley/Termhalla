// Pure decision-queue logic for the cross-project Orky registry aggregate (feature 0006).
// Everything here is TOTAL (never throws on null/empty/malformed input — CONV-002) and PURE:
// no DOM, no Electron, no renderer api bridge, no node builtins, and — critically — no ambient
// platform reads: the renderer main world is contextIsolated, so the usual global is NOT defined
// even though the vitest harness defines it (REQ-009 / FINDING-003, the test-green/runtime-broken
// trap). The fold mode is always INJECTED (`opts.caseFold`), derived by the renderer caller from
// `navigator.platform` via `caseFoldFromPlatform`.
//
// Determinism (REQ-006): no locale-dependent comparison, no clock, no randomness — identical
// aggregate in → identical group/item order out.
import type { OrkyFeatureStatus, OrkyRegistrySnapshot } from './types'
import { compareOrkyFeatures } from './orky-status'
import { isPlainObject } from './guards'
import { basename } from './paths'

/** One needs-a-human-now entry: the stable `(projectRoot, featureSlug)` identity F8 attaches
 *  actions to, plus the carried upstream status VERBATIM (no re-projection — REQ-015/D2). */
export interface DecisionQueueItem {
  projectRoot: string            // OrkyRegistryEntry.root, verbatim
  featureSlug: string            // OrkyFeatureStatus.feature, verbatim
  status: OrkyFeatureStatus      // the reused upstream shape — the SAME object, never copied
}

/** One project's group of queue items, in upstream `status.features` (comparator) order. */
export interface DecisionQueueGroup {
  projectRoot: string            // verbatim root (full path — the hover/title text)
  projectName: string            // display name = basename of root
  items: DecisionQueueItem[]     // ≥1
}

// The upstream OrkyReason values (Verified contract: 'escalation' | 'stalled' | 'human-review' | null).
const KNOWN_REASONS = new Set(['escalation', 'stalled', 'human-review'])

/** REQ-013's per-feature DEEP validation (review loopback, FINDING-021): a record that passes the
 *  shallow membership check (`needsHuman === true`, non-empty `feature`) must ALSO carry every
 *  consumed field well-typed before it may become a queue item — the panel interpolates
 *  `reason`/`phase`/`gateN`/`gateM`/`detail` directly as React children (an object-typed field
 *  would crash the whole renderer tree) and `reason`/`lastActivityAt` feed `compareOrkyFeatures`
 *  (a missing/mistyped value would drive the group comparator to NaN, making the sort order
 *  implementation-defined). Verified contract: reason ∈ {escalation, stalled, human-review, null};
 *  phase string|null; gateN/gateM/openBlocking/lastActivityAt finite numbers; detail string
 *  (tolerated absent — never rendered mistyped). */
function hasConsumableFields(f: Record<string, unknown>): boolean {
  return (
    (f.reason === null || (typeof f.reason === 'string' && KNOWN_REASONS.has(f.reason))) &&
    (f.phase === null || typeof f.phase === 'string') &&
    Number.isFinite(f.gateN) &&
    Number.isFinite(f.gateM) &&
    Number.isFinite(f.openBlocking) &&
    Number.isFinite(f.lastActivityAt) &&
    (f.detail === undefined || typeof f.detail === 'string')
  )
}

/** Build the grouped decision queue from a registry snapshot. Membership is EXACTLY the upstream
 *  needs-a-human-now signal (REQ-004): a feature carried in `status.features` with
 *  `needsHuman === true` — never re-derived from gates/escalations/stalls. Within a group the
 *  upstream array order is preserved verbatim (the pinned contiguous needsHuman prefix, REQ-005);
 *  across groups, projects order by their top item's rank via the shared `compareOrkyFeatures`
 *  comparator, ties broken by root codepoint comparison (REQ-005/REQ-006).
 *  Total: `null`/non-array/malformed snapshot → `[]`; a garbage entry or mistyped feature
 *  contributes nothing and never breaks well-formed siblings (REQ-013/CONV-002). */
export function buildDecisionQueue(snapshot: OrkyRegistrySnapshot | null): DecisionQueueGroup[] {
  if (!Array.isArray(snapshot)) return []
  const byRoot = new Map<string, DecisionQueueGroup>()
  for (const entry of snapshot) {
    if (!isPlainObject(entry)) continue
    const root = entry.root
    if (typeof root !== 'string' || root.length === 0) continue
    const status = entry.status
    if (!isPlainObject(status)) continue                        // null / mistyped status → no items
    const features = status.features
    if (!Array.isArray(features)) continue
    const items: DecisionQueueItem[] = []
    for (const f of features) {
      if (!isPlainObject(f)) continue
      // Membership: ONLY the carried needsHuman flag (busy/idle/done/malformed features → no item) —
      // then the FULL consumed-field validation (REQ-013 / FINDING-021): an admitted-shape record
      // mistyping any consumed field contributes no item, so no object ever reaches a React child
      // and no NaN ever reaches the comparator. Well-formed siblings are unaffected (CONV-002).
      if (f.needsHuman === true && typeof f.feature === 'string' && f.feature.length > 0 && hasConsumableFields(f)) {
        items.push({ projectRoot: root, featureSlug: f.feature, status: f as unknown as OrkyFeatureStatus })
      }
    }
    if (items.length === 0) continue
    const existing = byRoot.get(root)
    if (existing) existing.items.push(...items)
    else byRoot.set(root, { projectRoot: root, projectName: basename(root), items })
  }
  const groups = [...byRoot.values()]
  groups.sort((a, b) => {
    const byRank = compareOrkyFeatures(a.items[0].status, b.items[0].status)
    // NaN-hardened (FINDING-021 belt-and-braces): admission validation keeps NaN out of the
    // comparator inputs, but a non-finite rank must still fall through to the deterministic
    // root-codepoint tie-break rather than poison Array.prototype.sort (a NaN comparator result
    // coerces to +0, degrading the whole order to insertion order — REQ-005/REQ-006).
    if (byRank !== 0 && Number.isFinite(byRank)) return byRank
    return a.projectRoot < b.projectRoot ? -1 : a.projectRoot > b.projectRoot ? 1 : 0
  })
  return groups
}

/** THE single count source (badge AND list — REQ-007): sum of items across groups. */
export function decisionQueueCount(groups: DecisionQueueGroup[]): number {
  if (!Array.isArray(groups)) return 0
  let n = 0
  for (const g of groups) if (isPlainObject(g) && Array.isArray(g.items)) n += g.items.length
  return n
}

// ── Pane↔root matcher (REQ-009) ───────────────────────────────────────────────────────────────────

type PathAnchor = 'unc' | 'drive' | 'abs' | 'rel'

interface FoldedPath {
  anchor: PathAnchor
  segments: string[]
}

/** Resolve-style normalization by pure string logic (equivalent to `normalizeProjectRoot`'s
 *  comparison-key semantics — CONV-010): slash-fold ALWAYS (`\` ≡ `/`), trailing separators and
 *  `.`/`..` segments collapsed, case-fold iff `caseFold`. Returns `null` for a non-string/empty
 *  input. */
function foldPath(input: unknown, caseFold: boolean): FoldedPath | null {
  if (typeof input !== 'string' || input.length === 0) return null
  let s = input.replace(/\\/g, '/')
  if (caseFold) s = s.toLowerCase()
  const anchor: PathAnchor = s.startsWith('//') ? 'unc'
    : /^[A-Za-z]:/.test(s) ? 'drive'
      : s.startsWith('/') ? 'abs' : 'rel'
  const segments: string[] = []
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (segments.length > (anchor === 'drive' ? 1 : 0)) segments.pop()   // clamp at the root
      continue
    }
    segments.push(seg)
  }
  return { anchor, segments }
}

/** `true` iff `root` equals `pane` or is a path-segment-boundary ancestor of it. */
function contains(root: FoldedPath, pane: FoldedPath): boolean {
  if (root.anchor !== pane.anchor) return false
  if (root.segments.length > pane.segments.length) return false
  for (let i = 0; i < root.segments.length; i++) {
    if (root.segments[i] !== pane.segments[i]) return false
  }
  return true
}

/** Renderer-safe pane↔root matcher (REQ-009): the LONGEST member root that contains `panePath`
 *  (boundary-safe both directions; slash-fold always, case-fold iff `opts.caseFold`), or `null`.
 *  The fold mode is INJECTED — this module never reads ambient platform state. Total: empty/
 *  malformed inputs → `null`, never a throw. */
export function matchPaneRoot(
  panePath: string, roots: readonly string[], opts: { caseFold: boolean }
): string | null {
  const caseFold = opts?.caseFold === true
  const pane = foldPath(panePath, caseFold)
  if (pane === null || !Array.isArray(roots)) return null
  let best: string | null = null
  let bestDepth = -1
  for (const root of roots) {
    const folded = foldPath(root, caseFold)
    if (folded === null) continue
    if (!contains(folded, pane)) continue
    if (folded.segments.length > bestDepth) {
      best = root
      bestDepth = folded.segments.length
    }
  }
  return best
}

/** REQ-009's matcher seam (amended at the review loopback, ESC-001 / FINDING-020): the FIRST
 *  VALID candidate is DECISIVE — it either matches a member root (via `matchPaneRoot`) or the
 *  pane matches nothing (`null`, the REQ-010 fallback-affordance signal). A valid non-matching
 *  candidate NEVER falls through to a later (stale) signal: a pane that cd'd out of every member
 *  root is unbound main-side (`findOrkyRoot(live cwd)` = null) and must be unbound here too.
 *  Only INVALID candidates (null/undefined/'') are skipped, without consuming a turn.
 *  Candidate AVAILABILITY per REQ-009's when/ONLY-when conditions is `selectPaneCandidates`'
 *  job — callers must route through it, never hand-build an all-signals array. */
export function matchPaneRootFromCandidates(
  candidates: readonly (string | null | undefined)[], roots: readonly string[], opts: { caseFold: boolean }
): string | null {
  if (!Array.isArray(candidates)) return null
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    return matchPaneRoot(candidate, roots, opts)
  }
  return null
}

/** A pane's root-binding signals, as known to the renderer (REQ-009): the live tracked cwd
 *  (`cwds[paneId]`), the persisted terminal `config.cwd`, and `gitStatus.root`. */
export interface PaneCandidateSignals {
  liveCwd?: string | null
  configCwd?: string | null
  gitRoot?: string | null
}

/** REQ-009's candidate-AVAILABILITY seam (review loopback, ESC-001 / FINDING-020): pure
 *  availability gating over the pane's signals, deliberately blind to the member-root set so a
 *  known-but-elsewhere live cwd can never be displaced by a stale persisted cwd.
 *  - `[liveCwd]` when a live cwd is known — even if it will not match;
 *  - `[configCwd]` only when NO live cwd is known;
 *  - `[gitRoot]` ONLY when neither cwd signal exists;
 *  - `[]` when no signal at all (the pane can never match; REQ-010's fallback applies).
 *  Total (CONV-002): a mistyped signal is treated as absent, never a throw. */
export function selectPaneCandidates(signals: PaneCandidateSignals): string[] {
  if (!isPlainObject(signals)) return []
  const { liveCwd, configCwd, gitRoot } = signals
  if (typeof liveCwd === 'string' && liveCwd.length > 0) return [liveCwd]
  if (typeof configCwd === 'string' && configCwd.length > 0) return [configCwd]
  if (typeof gitRoot === 'string' && gitRoot.length > 0) return [gitRoot]
  return []
}

/** Fold-mode derivation for the renderer caller (REQ-009 / FINDING-003): true iff `platform`
 *  names Windows (e.g. `navigator.platform` `'Win32'`). A pure string → boolean function — tests
 *  and callers inject the string; this function reads nothing ambient. */
export function caseFoldFromPlatform(platform: string): boolean {
  return typeof platform === 'string' && /^win/i.test(platform)
}

// ── Most-recently-focused pane pick (REQ-009) ─────────────────────────────────────────────────────

/** A pane candidate for the MRU pick: its id plus its workspace's position in the window's tab
 *  order (the deterministic tie-break). */
export interface MruPaneRef {
  paneId: string
  workspaceIndex: number
}

/** Deterministic most-recently-focused pick (REQ-009): the highest `focusSeq` entry wins; panes
 *  absent from the map (never focused this session) rank LAST; ties break by workspace order, then
 *  pane-id codepoint. Empty input → `null`; total, never throws. */
export function selectMruPane(
  panes: readonly MruPaneRef[], focusSeq: Readonly<Record<string, number>>
): MruPaneRef | null {
  if (!Array.isArray(panes)) return null
  const seqOf = (p: MruPaneRef): number => {
    const v = isPlainObject(focusSeq) ? focusSeq[p.paneId] : undefined
    return typeof v === 'number' ? v : Number.NEGATIVE_INFINITY
  }
  let best: MruPaneRef | null = null
  for (const p of panes) {
    if (typeof p !== 'object' || p === null || typeof p.paneId !== 'string') continue
    if (best === null) { best = p; continue }
    const a = seqOf(p), b = seqOf(best)
    if (a > b) { best = p; continue }
    if (a < b) continue
    if (p.workspaceIndex < best.workspaceIndex) { best = p; continue }
    if (p.workspaceIndex > best.workspaceIndex) continue
    if (p.paneId < best.paneId) best = p
  }
  return best
}
