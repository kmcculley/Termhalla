// FROZEN integration suite — feature 0009-native-orky-pane (phase 4 / TASK-006).
// REQ-007 (detail payload pinned field-by-field against the REAL on-disk shapes, one injected clock,
// total on malformed input, same mapper pipeline as the aggregate) + REQ-014 (payload-canonical
// ordering) + REQ-013 (the assembler imports the shared predicate, never forks it).
//
// AMENDED 2026-07-02 on the ESC-001 tests loopback (FINDING-021, sanctioned by the coordinator):
// the amended REQ-007 wire shape carries `slug` — the feature DIR name from the sorted walk, the
// payload's UNIQUE per-feature key (status.feature is state.json's collidable `feature` field).
// TEST-392 gains the slug assertion; TEST-459/TEST-460 (below) pin the duplicate-`feature`-field
// vectors and the slug ordering tiebreak. Logged in 04-tests.md's loopback section.
//
// Chosen contract (prose-only in spec/plan — this suite freezes it; the implementer MUST match):
//   src/main/orky/orky-root-detail.ts exports
//     assembleOrkyRootDetail(root: string, opts: { now: () => number; retryDelayMs?: number }):
//       Promise<OrkyRootDetailResult>
//       — `root` is the PROJECT root (the dir containing .orky/); `opts.now` supplies the ONE clock
//         instant (`computedAt`) every time-derived datum uses; `retryDelayMs` (default 150) is the
//         torn-read retry delay (REQ-008 — exercised in tests/main/orky-root-detail-bounds.test.ts).
//     capFeatureSlugs(slugs: string[]): { slugs: string[]; capped: boolean }
//       — the PURE sort-before-cap seam (codepoint sort, then the 200-dir cap; REQ-008a/REQ-014).
//
// The REAL-bytes fixture is THIS repo's own .orky/features/0006-decision-queue-panel/ ledger
// (state.json + findings.json copied verbatim into a temp tree) — the exact shapes the spec's
// Verified contract pins (tokens gates, evidence gates, contract_violation findings, ESC-001).
//
// Runs RED today: src/main/orky/orky-root-detail.ts does not exist yet (module-not-found).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assembleOrkyRootDetail } from '../../src/main/orky/orky-root-detail'
import { ORKY_PHASES, parseOrkyTimestamp, isBlockingFinding } from '@shared/orky-status'
import { OrkyRootEngine } from '../../src/main/orky/orky-root-engine'

const NOW = 1_700_000_000_000

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks() })

function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  return new Promise((res, rej) => {
    const t0 = Date.now()
    const i = setInterval(() => {
      if (pred()) { clearInterval(i); res() }
      else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')) }
    }, 25)
  })
}

const REAL_SLUG = '0006-decision-queue-panel'
const realState = (): string => readFileSync(resolve(process.cwd(), `.orky/features/${REAL_SLUG}/state.json`), 'utf8')
const realFindings = (): string => readFileSync(resolve(process.cwd(), `.orky/features/${REAL_SLUG}/findings.json`), 'utf8')
// The amended wire field (FINDING-021) — read via a tolerant accessor so this suite type-checks
// while the shared OrkyFeatureDetail type is still pre-amendment (the RED state).
const slugOf = (f: unknown): unknown => (f as { slug?: unknown }).slug

type Seed = { state?: unknown | string; findings?: unknown | string }
function seedRoot(features: Record<string, Seed>, active?: { slug: string; phase?: string; lastTickAt?: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-detail-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const orky = join(root, '.orky')
  mkdirSync(join(orky, 'features'), { recursive: true })
  if (active) {
    writeFileSync(join(orky, 'active.json'), JSON.stringify({
      feature: `.orky/features/${active.slug}`, projectRoot: root, phase: active.phase ?? 'implement',
      lastTickAt: active.lastTickAt ?? new Date(NOW - 1_000).toISOString(), lastAction: 'x'
    }), 'utf8')
  }
  for (const [slug, f] of Object.entries(features)) {
    const dir = join(orky, 'features', slug)
    mkdirSync(dir, { recursive: true })
    if (f.state !== undefined) writeFileSync(join(dir, 'state.json'), typeof f.state === 'string' ? f.state : JSON.stringify(f.state), 'utf8')
    if (f.findings !== undefined) writeFileSync(join(dir, 'findings.json'), typeof f.findings === 'string' ? f.findings : JSON.stringify(f.findings), 'utf8')
  }
  return root
}

describe('payload pinned against the REAL 0006 on-disk bytes (REQ-007)', () => {
  it('TEST-392 REQ-007 real state.json/findings.json: gates in canonical ORKY_PHASES order, tokens-gates carry evidence:null, findings in FILE order with the SHARED blocking predicate, escalations verbatim, activeFeature by basename, computedAt = the injected clock', async () => {
    const root = seedRoot({ [REAL_SLUG]: { state: realState(), findings: realFindings() } }, { slug: REAL_SLUG })
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.root).toBe(root)
    expect(res.computedAt).toBe(NOW)
    expect(res.activeFeature).toBe(REAL_SLUG) // active.json basename rule, engine parity
    expect(res.featuresCapped).toBe(false)
    expect(res.skippedFeatures).toEqual([])
    expect(res.features).toHaveLength(1)
    const f = res.features[0]
    // ESC-001 loopback (FINDING-021): the payload's unique per-feature key is the DIR slug, verbatim
    expect(slugOf(f)).toBe(REAL_SLUG)
    const rawState = JSON.parse(realState()) as { gates: Record<string, Record<string, unknown>>; escalations: Array<Record<string, unknown>> }
    const rawFindings = JSON.parse(realFindings()) as Array<Record<string, unknown>>

    // gates: exactly one entry per ORKY_PHASES member, canonical order, fields mapped verbatim
    expect(f.gates.map(g => g.phase)).toEqual([...ORKY_PHASES])
    for (const g of f.gates) {
      const raw = rawState.gates[g.phase]
      expect(g.passed).toBe(raw ? raw.passed === true : null)
      expect(g.at).toBe(typeof raw?.at === 'string' ? parseOrkyTimestamp(raw.at) : null)
      expect(g.evidence).toBe(typeof raw?.evidence === 'string' ? raw.evidence : null)
      expect(g.external).toBe(raw?.external === true)
    }
    // the real spec gate is a tokens-gate with NO top-level evidence → evidence null (never invented)
    const specGate = f.gates.find(g => g.phase === 'spec')!
    expect(Array.isArray(rawState.gates['spec'].tokens)).toBe(true)
    expect(specGate.evidence).toBeNull()
    // the real brainstorm gate carries a string evidence → verbatim
    expect(f.gates.find(g => g.phase === 'brainstorm')!.evidence).toBe(rawState.gates['brainstorm'].evidence)

    // findings: FILE order, verbatim fields, blocking computed by the SHARED isBlockingFinding
    expect(f.findings).toHaveLength(rawFindings.length)
    f.findings.forEach((fd, i) => {
      const raw = rawFindings[i]
      expect(fd.id).toBe(typeof raw.id === 'string' && raw.id !== '' ? raw.id : null)
      expect(fd.claim).toBe(typeof raw.claim === 'string' ? raw.claim : '')
      expect(fd.severity).toBe(typeof raw.severity === 'string' ? raw.severity : null)
      expect(fd.status).toBe(typeof raw.status === 'string' ? raw.status : null)
      expect(fd.blocking).toBe(isBlockingFinding(raw))
    })
    expect(f.findingsUnreadable).toBe(false)
    // the real ledger's RESOLVED contract_violation entries are NOT blocking (FINDING-007's vector, on real bytes)
    const cvIdx = rawFindings.map((r, i) => ({ r, i })).filter(({ r }) => r.contract_violation === true && r.status === 'resolved')
    expect(cvIdx.length).toBeGreaterThan(0)
    for (const { i } of cvIdx) expect(f.findings[i].blocking).toBe(false)

    // escalations: state.json array order, verbatim, timestamps through parseOrkyTimestamp
    expect(f.escalations).toHaveLength(rawState.escalations.length)
    f.escalations.forEach((e, i) => {
      const raw = rawState.escalations[i]
      expect(e.id).toBe(typeof raw.id === 'string' && raw.id !== '' ? raw.id : null)
      expect(e.status).toBe(typeof raw.status === 'string' ? raw.status : null)
      expect(e.reason).toBe(typeof raw.reason === 'string' ? raw.reason : '')
      expect(e.at).toBe(typeof raw.at === 'string' ? parseOrkyTimestamp(raw.at) : null)
      expect(e.resolvedAt).toBe(typeof raw.resolvedAt === 'string' ? parseOrkyTimestamp(raw.resolvedAt) : null)
      expect(e.decision).toBe(typeof raw.decision === 'string' ? raw.decision : null)
    })
    expect(f.escalations[0].id).toBe('ESC-001')
  })

  it('TEST-393 REQ-007 synthetic completions: an UNRECORDED gate maps passed:null/at:null; external:true only on an explicit true; a resolved escalation carries decision + resolvedAt epochs', async () => {
    const root = seedRoot({
      'synth-feat': {
        state: {
          feature: 'synth-feat', phase: 'spec',
          gates: {
            brainstorm: { passed: true, at: '2026-01-01T00:00:00Z', evidence: 'human ok', external: true },
            spec: { passed: false, at: 'not-a-timestamp' }
          },
          escalations: [
            { id: 'ESC-9', phase: 'spec', status: 'resolved', reason: 'pick', kind: 'decision', at: '2026-01-02T00:00:00Z', decision: 'option B', resolvedAt: '2026-01-03T00:00:00Z' }
          ]
        }
      }
    })
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const f = res.features[0]
    const bs = f.gates.find(g => g.phase === 'brainstorm')!
    expect(bs).toEqual({ phase: 'brainstorm', passed: true, at: Date.UTC(2026, 0, 1), evidence: 'human ok', external: true })
    const spec = f.gates.find(g => g.phase === 'spec')!
    expect(spec.passed).toBe(false)
    expect(spec.at).toBeNull()          // unparseable timestamp → null, never NaN/throw
    expect(spec.external).toBe(false)
    for (const phase of ['plan', 'tests', 'implement', 'review', 'doc-sync', 'human-review']) {
      const g = f.gates.find(x => x.phase === phase)!
      expect(g).toEqual({ phase, passed: null, at: null, evidence: null, external: false }) // unrecorded
    }
    expect(f.escalations[0]).toEqual({
      id: 'ESC-9', phase: 'spec', status: 'resolved', reason: 'pick', kind: 'decision',
      at: Date.UTC(2026, 0, 2), decision: 'option B', resolvedAt: Date.UTC(2026, 0, 3)
    })
    expect(res.activeFeature).toBeNull() // no active.json
  })

  it('TEST-394 REQ-007 total over malformed input: object severity, numeric claim, non-array escalations, garbage gates — pinned defaults, no throw, nothing mistyped passed through', async () => {
    const root = seedRoot({
      'mangled': {
        state: { feature: 'mangled', phase: 'implement', gates: 'garbage', escalations: { not: 'an array' } },
        findings: [{ severity: { nested: true }, claim: 42, status: 'open', id: 7 }]
      }
    })
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.features).toHaveLength(1)
    const f = res.features[0]
    // garbage gates → all 8 canonical entries, all unrecorded
    expect(f.gates.map(g => g.phase)).toEqual([...ORKY_PHASES])
    for (const g of f.gates) expect(g.passed).toBeNull()
    // non-array escalations → []
    expect(f.escalations).toEqual([])
    // mistyped finding fields → pinned defaults (never the raw mistyped value)
    expect(f.findings).toHaveLength(1)
    expect(f.findings[0].severity).toBeNull()
    expect(f.findings[0].claim).toBe('')
    expect(f.findings[0].id).toBeNull()
    expect(f.findings[0].status).toBe('open')
    expect(f.findings[0].blocking).toBe(false)
  })

  it('TEST-395 REQ-007 tz-safety: a tz-less ISO gate timestamp is interpreted as UTC — identical epoch as its explicit-Z twin on ANY host TZ', async () => {
    const root = seedRoot({
      'tzless': { state: { feature: 'tzless', phase: 'spec', gates: { brainstorm: { passed: true, at: '2026-03-01T12:00:00' } }, escalations: [] } },
      'tzfull': { state: { feature: 'tzfull', phase: 'spec', gates: { brainstorm: { passed: true, at: '2026-03-01T12:00:00Z' } }, escalations: [] } }
    })
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const at = (slug: string): number | null =>
      res.features.find(f => f.status.feature === slug)!.gates.find(g => g.phase === 'brainstorm')!.at
    expect(at('tzless')).toBe(Date.UTC(2026, 2, 1, 12))
    expect(at('tzless')).toBe(at('tzfull'))
  })
})

describe('determinism + ordering (REQ-007 / REQ-014)', () => {
  it('TEST-396 REQ-007 two reads of the same fixture WITH the same injected clock are deep-equal and both carry that clock as computedAt', async () => {
    const root = seedRoot({ [REAL_SLUG]: { state: realState(), findings: realFindings() } }, { slug: REAL_SLUG })
    const a = await assembleOrkyRootDetail(root, { now: () => NOW })
    const b = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(a).toEqual(b)
    expect(a.ok && a.computedAt).toBe(NOW)
    // a different injected clock is carried verbatim (the ONE instant, by construction)
    const c = await assembleOrkyRootDetail(root, { now: () => NOW + 5 })
    expect(c.ok && c.computedAt).toBe(NOW + 5)
  })

  it('TEST-397 REQ-014 features are sorted by status.feature CODEPOINT (uppercase before lowercase — never localeCompare)', async () => {
    const state = (slug: string) => ({ feature: slug, phase: 'spec', gates: {}, escalations: [] })
    // FINDING-010: names must be codepoint-distinct, NOT case-only-distinct — b-feat/B-feat
    // collapse into ONE physical dir on case-insensitive filesystems (NTFS/APFS).
    const root = seedRoot({
      'b2-feat': { state: state('b2-feat') },
      'B-feat': { state: state('B-feat') },
      'a-feat': { state: state('a-feat') }
    })
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // codepoint: 'B' (0x42) < 'a' (0x61) < 'b' (0x62); localeCompare would sort a-feat first.
    expect(res.features.map(f => f.status.feature)).toEqual(['B-feat', 'a-feat', 'b2-feat'])
  })

  it('TEST-398 REQ-007 no-contradiction: under the SAME injected clock, every aggregate feature entry deep-equals the detail feature\'s carried status — and the detail ALSO carries what the aggregate popover set drops (clean-done)', async () => {
    const passed = (at = '2026-06-30T00:00:00.000Z') => ({ passed: true, at })
    const root = seedRoot({
      'esc-feat': {
        state: {
          feature: 'esc-feat', phase: 'implement',
          gates: { brainstorm: passed(), spec: passed(), plan: passed(), tests: passed() },
          escalations: [{ id: 'ESC-001', status: 'open', reason: 'pick an option' }]
        },
        findings: []
      },
      'done-feat': {
        state: {
          feature: 'done-feat', phase: 'doc-sync',
          gates: {
            brainstorm: passed(), spec: passed(), plan: passed(), tests: passed(),
            implement: passed(), review: passed(), 'doc-sync': passed(), 'human-review': passed()
          },
          escalations: []
        },
        findings: []
      }
    }, { slug: 'esc-feat' })
    const orkyDir = join(root, '.orky')

    // the aggregate, computed by the REAL engine under the SAME clock
    const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20 })
    cleanups.push(() => engine.dispose())
    const statuses: Array<{ features?: Array<{ feature: string }> } | null> = []
    engine.onStatus((_dir, status) => statuses.push(status as never))
    await engine.addConsumer('t', orkyDir)
    await waitFor(() => statuses.some(s => s !== null))
    const aggregate = statuses.filter(s => s !== null).pop()!

    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // every aggregate (popover-eligible) entry deep-equals the detail's carried status for that slug
    for (const agg of aggregate.features ?? []) {
      const det = res.features.find(f => f.status.feature === agg.feature)
      expect(det, `detail must carry ${agg.feature}`).toBeDefined()
      expect(det!.status).toEqual(agg)
    }
    // and the aggregate DELIBERATELY omits the clean-done feature the pane must still show (D3's reason to exist)
    expect((aggregate.features ?? []).some(x => x.feature === 'done-feat')).toBe(false)
    expect(res.features.some(f => f.status.feature === 'done-feat')).toBe(true)
    expect(res.features.some(f => f.status.feature === 'esc-feat')).toBe(true)
  })
})

describe('the wire carries the UNIQUE dir slug (REQ-007 / REQ-014 / FINDING-021 — ESC-001 loopback)', () => {
  it('TEST-459 REQ-007 a duplicate-feature-field fixture (TWO dirs whose state.json share one feature value) yields TWO entries with DISTINCT slugs byte-equal to their dir names', async () => {
    const state = { feature: 'same-name', phase: 'spec', gates: {}, escalations: [] }
    const root = seedRoot({ 'dup-a': { state }, 'dup-b': { state } })
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // a copied feature dir must never collapse rows: two entries, unique keys
    expect(res.features).toHaveLength(2)
    expect(res.features.map(f => f.status.feature)).toEqual(['same-name', 'same-name'])
    expect(res.features.map(f => slugOf(f))).toEqual(['dup-a', 'dup-b'])
    // every slug byte-equals its fixture dir name
    for (const f of res.features) expect(['dup-a', 'dup-b']).toContain(slugOf(f))
  })

  it('TEST-460 REQ-014 payload order is TOTAL under duplicate feature values: status.feature codepoint with the slug codepoint tiebreak — deterministic across repeated reads', async () => {
    const state = (feature: string) => ({ feature, phase: 'spec', gates: {}, escalations: [] })
    const root = seedRoot({
      'z-dir': { state: state('aaa') },
      'a-dir': { state: state('aaa') },
      'm-dir': { state: state('bbb') }
    })
    const first = await assembleOrkyRootDetail(root, { now: () => NOW })
    const second = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // 'aaa' entries first (feature codepoint), tie broken by slug codepoint: a-dir before z-dir
    expect(first.features.map(f => `${f.status.feature}@${String(slugOf(f))}`))
      .toEqual(['aaa@a-dir', 'aaa@z-dir', 'bbb@m-dir'])
    expect(second).toEqual(first) // total order — no ambiguity for readdir order to leak through
  })
})

describe('the assembler consumes the shared pipeline — never forks it (REQ-007 / REQ-013 / REQ-015)', () => {
  it('TEST-399 REQ-007 REQ-013 source assertion: orky-root-detail.ts imports the @shared/orky-status pipeline incl. isBlockingFinding and contains NO local blocking predicate and no localeCompare', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/main/orky/orky-root-detail.ts'), 'utf8')
    expect(src).toMatch(/from '@shared\/orky-status'/)
    for (const name of ['isBlockingFinding', 'orkyFeatureStatus', 'parseOrkyTimestamp']) {
      expect(src, `assembler must import/use ${name}`).toContain(name)
    }
    // no re-derivation: the predicate's raw ingredients must not reappear locally
    expect(src).not.toContain('BLOCKING_SEVERITY')
    expect(src).not.toContain('contract_violation')
    expect(src).not.toMatch(/toLowerCase\(\)\s*===\s*'open'/)
    expect(src).not.toContain('localeCompare')
  })
})
