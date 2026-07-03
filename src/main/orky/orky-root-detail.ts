// Read-only, ONE-SHOT per-root Orky detail assembler (feature 0009, TASK-006 —
// REQ-007/REQ-008/REQ-013/REQ-014). Backs `OrkyRegistry.detail` / the `registry:detail` pull.
//
// It reuses the engine's read semantics and resource bounds — the same 200-dir / 1 MiB limits
// (warned, never silent — CONV-003) and the same symlinked-feature-dir skip — with THREE pinned,
// deliberate divergences from `orky-root-engine.ts`'s walk (spec REQ-008):
//   (a) deterministic survivor set (FINDING-006): the slug list is sorted by codepoint BEFORE the
//       cap is applied (`capFeatureSlugs`), so WHICH features survive is a pure function of the
//       on-disk state — never raw enumeration order;
//   (b) torn-read stability (FINDING-004): the producer's state/active writes are non-atomic and
//       this one-shot read has no watcher-style write-finish shield, so an EXISTING-but-unparseable
//       file is retried exactly once after a short fixed delay (default 150 ms — the watcher's own
//       stability threshold), then SURFACED (`skippedFeatures` / `findingsUnreadable`) — never a
//       silent drop. Absent and oversized files retry nothing (absence is a legitimate state;
//       oversize is a deterministic, warned skip);
//   (c) unreadable is surfaced, not swallowed — the engine's silent per-feature skip is replaced by
//       the markers above on THIS path only (the engine itself is untouched).
//
// One-shot discipline (REQ-008/REQ-013): pure `fs/promises` READS only — no watcher, no engine
// consumer registration, no recurring timer (the bounded retry's single delay lives within one
// request), and no write of any kind. The payload is a pure function of (the on-disk bytes, the
// injected clock): `opts.now` is sampled ONCE and that instant clocks EVERY time-derived datum
// (`computedAt`, stall verdicts) — internally clock-consistent by construction (FINDING-005).
import { readFile, readdir, stat, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  OrkyEscalationDetail, OrkyFeatureDetail, OrkyFindingDetail, OrkyGateDetail, OrkyPhase,
  OrkyRootDetailResult
} from '@shared/types'
import {
  ORKY_PHASES, isBlockingFinding, normalizeFeatureRaw, normalizeFindings, orkyFeatureStatus,
  parseOrkyTimestamp
} from '@shared/orky-status'

/** Engine-parity read bounds — the SAME values `orky-root-engine.ts` enforces (200 feature dirs /
 *  1 MiB per file, each warned on, no silent capping). Declared locally because the engine does not
 *  export them and this one-shot path deliberately imports nothing from the engine (REQ-008's
 *  no-new-consumer half). */
const MAX_FEATURE_DIRS = 200
const MAX_FILE_BYTES = 1024 * 1024 // 1 MiB

/** The PURE sort-before-cap seam (REQ-008a / REQ-014, FINDING-006): slugs sorted by codepoint, THEN
 *  the 200-dir cap — so the survivor set is deterministic under any enumeration order. The engine's
 *  own raw-order cap is a flagged upstream F5 note, deliberately NOT copied here. */
export function capFeatureSlugs(slugs: string[]): { slugs: string[]; capped: boolean } {
  const sorted = [...slugs].sort()
  if (sorted.length > MAX_FEATURE_DIRS) {
    return { slugs: sorted.slice(0, MAX_FEATURE_DIRS), capped: true }
  }
  return { slugs: sorted, capped: false }
}

type ReadOutcome =
  | { kind: 'ok'; value: unknown }
  | { kind: 'absent' }     // no file — a legitimate state, never retried
  | { kind: 'oversized' }  // above MAX_FILE_BYTES — deterministic warned skip, never retried
  | { kind: 'symlink' }    // the LEAF file is a symlink — refused unfollowed, surfaced, never retried
  | { kind: 'torn' }       // EXISTS but could not be read/parsed — the retry candidate

async function readJsonOnce(path: string): Promise<ReadOutcome> {
  let size: number
  try {
    // lstat, not stat: a symlinked leaf file (active.json / state.json / findings.json) inside a
    // tracked root could redirect this read anywhere on disk and echo the target into the payload
    // (the FINDING-011 CWE-59 oracle) — refused UNFOLLOWED here, surfaced downstream exactly like
    // an unreadable file. Detail-path only; the engine keeps its own semantics.
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      console.warn(`[orky-detail] refusing symlinked ${path} — leaf files are never followed`)
      return { kind: 'symlink' }
    }
    size = info.size
  } catch (err) {
    // Errno classification (REQ-008b / FINDING-028): only TRUE absence (ENOENT/ENOTDIR) is
    // 'absent'. Any other stat failure (EACCES/EPERM — a permission-broken tree) is an
    // EXISTING-but-unreadable file: it flows through the bounded retry and is then SURFACED
    // (skippedFeatures / findingsUnreadable), never silently classified as missing.
    const code = (err as NodeJS.ErrnoException | null)?.code
    return code === 'ENOENT' || code === 'ENOTDIR' ? { kind: 'absent' } : { kind: 'torn' }
  }
  if (size > MAX_FILE_BYTES) {
    console.warn(`[orky-detail] skipping oversized ${path} (${size} bytes > ${MAX_FILE_BYTES})`)
    return { kind: 'oversized' }
  }
  let content: string
  try { content = await readFile(path, 'utf8') } catch { return { kind: 'torn' } }
  try { return { kind: 'ok', value: JSON.parse(content) } } catch { return { kind: 'torn' } }
}

/** Bounded torn-read retry (REQ-008b): an existing-but-unparseable file is re-read exactly once
 *  after `retryDelayMs`; whatever the second attempt yields is final. A torn-then-DELETED file
 *  legitimately lands 'absent' on the retry (the dir is genuinely mid-deletion, so the coverage
 *  invariant is vacuous for it — the FINDING-033 note). Cross-FILE coherence is deliberately NOT
 *  arbitrated here: an ok:true payload is coherent per-file, not per-feature-across-files — the
 *  documented, accepted read-skew class REQ-008 pins, healed by the next `registry:rootChanged`
 *  notification cycle (see docs/features/orky-pane.md). */
async function readJsonStable(path: string, retryDelayMs: number): Promise<ReadOutcome> {
  const first = await readJsonOnce(path)
  if (first.kind !== 'torn') return first
  if (retryDelayMs > 0) await new Promise<void>(r => setTimeout(r, retryDelayMs))
  return readJsonOnce(path)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function strOrNull(v: unknown): string | null { return typeof v === 'string' ? v : null }
function nonEmptyStrOrNull(v: unknown): string | null { return typeof v === 'string' && v !== '' ? v : null }
function epochOrNull(v: unknown): number | null { return typeof v === 'string' ? parseOrkyTimestamp(v) : null }

/** Exactly one entry per ORKY_PHASES member, canonical order; fields mapped verbatim with the
 *  pinned null defaults (REQ-007) — a truthy-but-mistyped gate entry yields the same verdicts a
 *  `raw.passed === true`-style read would (total, never a throw). */
function mapGates(gates: Record<string, unknown>): OrkyGateDetail[] {
  return ORKY_PHASES.map((phase: OrkyPhase): OrkyGateDetail => {
    const g = gates[phase]
    const rec = isObj(g) ? g : undefined
    return {
      phase,
      passed: g ? rec?.passed === true : null, // recorded entry -> explicit true/false; no entry -> null
      at: epochOrNull(rec?.at),
      evidence: strOrNull(rec?.evidence),
      external: rec?.external === true
    }
  })
}

function mapFinding(f: unknown): OrkyFindingDetail {
  const rec = isObj(f) ? f : {}
  return {
    id: nonEmptyStrOrNull(rec.id),
    lens: strOrNull(rec.lens),
    severity: strOrNull(rec.severity),
    status: strOrNull(rec.status),
    gate: strOrNull(rec.gate),
    claim: typeof rec.claim === 'string' ? rec.claim : '',
    blocking: isBlockingFinding(f), // the SHARED predicate — never re-derived here (REQ-013/REQ-015)
    // v2 `finding_resolution` fields (feature 0015, REQ-109) — same total-mapping discipline as
    // OrkyEscalationDetail's decision/resolvedAt: verbatim-or-null for strings, tz-safe epoch parse
    // (string-only, per epochOrNull) for the timestamp.
    resolution: strOrNull(rec.resolution),
    resolvedBy: strOrNull(rec.resolvedBy),
    resolvedAt: epochOrNull(rec.resolvedAt)
  }
}

function mapEscalation(e: unknown): OrkyEscalationDetail {
  const rec = isObj(e) ? e : {}
  return {
    id: nonEmptyStrOrNull(rec.id),
    phase: strOrNull(rec.phase),
    status: strOrNull(rec.status),
    reason: typeof rec.reason === 'string' ? rec.reason : '',
    kind: strOrNull(rec.kind),
    at: epochOrNull(rec.at),
    decision: strOrNull(rec.decision),
    resolvedAt: epochOrNull(rec.resolvedAt)
  }
}

/** The active feature's slug = the basename of `active.json.feature` (engine parity). */
function activeSlugOf(active: unknown): string | null {
  if (!isObj(active)) return null
  const feature = active.feature
  if (typeof feature !== 'string') return null
  const parts = feature.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}
function activePhaseOf(active: unknown): OrkyPhase | null {
  if (!isObj(active)) return null
  return typeof active.phase === 'string' ? (active.phase as OrkyPhase) : null
}
function activeTickOf(active: unknown): number | null {
  if (!isObj(active)) return null
  return epochOrNull(active.lastTickAt)
}

/**
 * Assemble ONE tracked root's full Orky detail. `root` is the PROJECT root (the dir containing
 * `.orky/`); `opts.now` supplies the single clock instant; `opts.retryDelayMs` (default 150) is the
 * torn-read retry delay. Never throws and never rejects for any on-disk state (CONV-002): a missing
 * `.orky/` returns the structured `orky-missing` result naming the path; a present-but-empty tree
 * returns `ok:true` with empty `features` (the unreadable-vs-empty distinction, REQ-018 parity).
 * Coverage invariant: every feature dir whose state.json exists appears in `features` OR
 * `skippedFeatures` — an `ok:true` payload is never silently shorter than the tree.
 */
export async function assembleOrkyRootDetail(
  root: string,
  opts: { now: () => number; retryDelayMs?: number }
): Promise<OrkyRootDetailResult> {
  const retryDelayMs = opts.retryDelayMs ?? 150
  const now = opts.now() // sampled ONCE — the payload's single clock instant (REQ-007)
  const orkyDir = join(root, '.orky')

  let dirExists = false
  try { dirExists = (await stat(orkyDir)).isDirectory() } catch { dirExists = false }
  if (!dirExists) {
    return {
      ok: false,
      root,
      error: `No Orky data found at ${orkyDir} — the .orky directory is missing or unreadable. ` +
        'Run an Orky pipeline in this project (or restore its .orky directory) to read its status.',
      errorKind: 'orky-missing'
    }
  }

  const activeRead = await readJsonStable(join(orkyDir, 'active.json'), retryDelayMs)
  const active = activeRead.kind === 'ok' ? activeRead.value : undefined // unparseable -> absent-equivalent (engine parity)
  const activeSlug = activeSlugOf(active)
  const activePhase = activePhaseOf(active)
  const lastTickAt = activeTickOf(active)

  let entries: string[] = []
  try { entries = await readdir(join(orkyDir, 'features')) } catch { entries = [] }
  const { slugs, capped } = capFeatureSlugs(entries)
  if (capped) {
    console.warn(`[orky-detail] ${join(orkyDir, 'features')} has ${entries.length} entries; ` +
      `capping at ${MAX_FEATURE_DIRS} (codepoint-sorted survivor set)`)
  }

  const features: OrkyFeatureDetail[] = []
  const skippedFeatures: string[] = []
  for (const slug of slugs) {
    const fdir = join(orkyDir, 'features', slug)
    // Symlink guard (engine parity): a features/<slug> symlink could redirect the read outside the
    // project — skipped silently (it is not an unreadable feature; it is not a feature dir at all).
    let isLink = false
    try { isLink = (await lstat(fdir)).isSymbolicLink() } catch { continue }
    if (isLink) { console.warn(`[orky-detail] skipping symlinked feature dir: ${fdir}`); continue }

    const stateRead = await readJsonStable(join(fdir, 'state.json'), retryDelayMs)
    if (stateRead.kind === 'absent') continue // a dir without state.json is not a feature (engine parity)
    if (stateRead.kind !== 'ok') {
      // Torn (still unreadable after the bounded retry), oversized (deterministic skip, no retry)
      // or a refused symlink: SURFACED via skippedFeatures, never silently dropped (REQ-008b/c).
      console.warn(`[orky-detail] ${join(fdir, 'state.json')} could not be read — surfacing '${slug}' in skippedFeatures`)
      skippedFeatures.push(slug)
      continue
    }

    const findingsRead = await readJsonStable(join(fdir, 'findings.json'), retryDelayMs)
    const findingsUnreadable = findingsRead.kind !== 'ok' && findingsRead.kind !== 'absent'
    const findingsValue = findingsRead.kind === 'ok' ? findingsRead.value : undefined

    const raw = normalizeFeatureRaw(stateRead.value)
    const findings = normalizeFindings(findingsValue)
    const isActive = !!activeSlug && raw.feature === activeSlug
    // The SAME mapper pipeline the aggregate uses (REQ-007/REQ-015) — same active-slug / live-phase /
    // heartbeat / stall inputs the engine's re-read computes, under THIS payload's one clock.
    const status = orkyFeatureStatus(
      raw, findings, isActive,
      isActive ? activePhase : null,
      isActive ? lastTickAt : null,
      now
    )
    const rawFindings: unknown[] = Array.isArray(findingsValue) ? (findingsValue as unknown[]) : []
    features.push({
      // The UNIQUE per-feature key (REQ-007 / FINDING-021): the DIR name from the sorted walk,
      // verbatim — status.feature is producer-written free text and can collide.
      slug,
      status,
      gates: mapGates(raw.gates as Record<string, unknown>),
      findings: rawFindings.map(mapFinding),          // FILE order, verbatim
      findingsUnreadable,
      escalations: (raw.escalations as unknown[]).map(mapEscalation) // FILE order, verbatim
    })
  }

  // Payload-canonical order (REQ-014): status.feature codepoint with the slug codepoint tiebreak —
  // a TOTAL, unique order even under duplicate `feature` fields; never a locale comparison.
  features.sort((a, b) =>
    a.status.feature < b.status.feature ? -1 : a.status.feature > b.status.feature ? 1 :
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)

  return {
    ok: true,
    root,
    activeFeature: activeSlug,
    computedAt: now,
    features,
    skippedFeatures,
    featuresCapped: capped
  }
}
