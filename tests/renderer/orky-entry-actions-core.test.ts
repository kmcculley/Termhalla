// FROZEN unit suite — feature 0008-queue-answer-resume-actions (phase 4).
// The PURE core of the shared entry-action layer (D5/REQ-011), driven behaviorally as plain
// functions per the repo's testability rule (CLAUDE.md: "Renderer pure logic you want unit-tested
// must not import ../api … Inject the IPC call as an argument"; the same constraint pane-ops.ts
// documents). The spec's REQ-005 acceptance explicitly sanctions the helper split
// ("a source scan of orky-entry-actions.tsx (and its helper, if any)").
//
// Chosen frozen contract (02-spec.md Public interface + 03-plan.md TASK-001/002/005 — this suite
// freezes it, the 0012 orky-capture-slice precedent):
//   src/renderer/components/orky-entry-actions-core.ts — api-free, React-free, store-free — exports
//     OrkyEntryTarget            { projectRoot; featureSlug; reason: OrkyReason; escalationId?: string }
//     answerModeFor(reason)      'escalation' → 'escalation' | 'human-review' → 'human-review' | else null
//     flightKey(projectRoot, featureSlug, action)          // CONV-039 collision-proof composite key
//     withSingleFlight<T>(key, fn): Promise<T>             // the SHARED module-scope in-flight registry
//                                                          // (REQ-007): an existing flight for `key` is
//                                                          // returned AS-IS (same promise reference) and
//                                                          // fn is NOT started; released on settle
//                                                          // regardless of caller mount state (REQ-010)
//     isInFlight(key): boolean                             // the pending derivation EVERY mounted
//                                                          // instance reads (REQ-007 two-instance clause)
//     subscribeFlights(listener): () => void               // notified on every acquire AND release — the
//                                                          // seam that lets a SECOND mount of the same
//                                                          // target re-render pending
//     bindEscalationTarget(target, registryDetail): Promise<EscalationBinding>
//     verifyEscalationTarget(target, boundId, registryDetail): Promise<EscalationBinding>
//       EscalationBinding = { ok: true; escalationId: string; escalationReason: string | null }
//                         | { ok: false; message: string }
//     buildResolveEscalationRequest(target, escalationId, decision)   // EXACT keys, no smuggling (REQ-004)
//     buildRecordHumanGateRequest(target, verdict, evidence?)
//     buildDriveStatusRequest(target)
//     settleAnswer(reason, result): SettledOutcome          // honesty keyed ONLY on ok/dispatched/errorKind
//     settlePreview(result): SettledOutcome
//       SettledOutcome = { status: 'success'; message: string }
//                      | { status: 'failure'; kind: string; error: string; message: string; indeterminate: boolean }
//
// REQ-007's two-instance acceptance ("TWO useOrkyEntryActions instances mounted for the SAME
// target … one dispatch, BOTH render pending") is realized in this harness (node-env, no jsdom —
// no React lifecycle can mount) as: TWO independent consumers of the SAME flightKey share ONE
// started fn and ONE promise (TEST-585), every consumer observes pending via isInFlight and is
// re-render-notified via subscribeFlights (TEST-586), the hook is STRUCTURALLY pinned to consult
// exactly this shared seam and never a per-instance ref (orky-entry-actions-structure TEST-600),
// and the real double-gesture single-dispatch count is driven end-to-end in
// tests/e2e/orky-queue-actions.spec.ts (TEST-608).
//
// Runs RED today: src/renderer/components/orky-entry-actions-core.ts does not exist
// (module-not-found fails every test in this file).
//
// [AMENDED at the ESC-001 tests LOOPBACK (review → tests), 2026-07-02 — FINDING-013 supersession]
// TEST-593's preview fixture originally used the UNREAL flattened shape data:{next:'run-phase spec'}
// — a single pre-joined string the gatekeeper CLI never emits. gk drive() returns STRUCTURED
// objects (Orky plugin/gatekeeper/gatekeeper.js:843-904): {next:'run-phase', phase},
// {next:'await-human', reason[, phase]}, {next:'retry-phase', phase, failed, attempt},
// {next:'done'} — and the pinned contract now requires settlePreview to render next PLUS phase
// PLUS reason when carried (WHICH phase to run / WHY a human is needed are the load-bearing data).
// Only TEST-593 changed; every other TEST id in this file is byte-unchanged. Intent preserved:
// the preview stays read-only-honest with zero mutation-claiming words.
import { describe, it, expect, vi } from 'vitest'
import type { OrkyFeatureDetail, OrkyEscalationDetail, OrkyFeatureStatus, OrkyRootDetailResult, OrkyActionResult } from '@shared/types'
import {
  answerModeFor,
  flightKey,
  withSingleFlight,
  isInFlight,
  subscribeFlights,
  bindEscalationTarget,
  verifyEscalationTarget,
  buildResolveEscalationRequest,
  buildRecordHumanGateRequest,
  buildDriveStatusRequest,
  settleAnswer,
  settlePreview,
  type OrkyEntryTarget
} from '../../src/renderer/components/orky-entry-actions-core'

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────
const ROOT = 'C:\\proj\\alpha'
const target = (over: Partial<OrkyEntryTarget> = {}): OrkyEntryTarget =>
  ({ projectRoot: ROOT, featureSlug: '0008-queue', reason: 'escalation', ...over })

const esc = (over: Partial<OrkyEscalationDetail>): OrkyEscalationDetail => ({
  id: null, phase: null, status: null, reason: '', kind: null, at: null, decision: null, resolvedAt: null, ...over
})

const feat = (slug: string, statusFeature: string, escalations: OrkyEscalationDetail[], detail = ''): OrkyFeatureDetail => ({
  slug,
  status: {
    feature: statusFeature, kind: 'needs-input', phase: 'implement', gateN: 4, gateM: 8,
    openBlocking: 0, needsHuman: true, failed: false, reason: 'escalation', lastActivityAt: 0, detail
  } as OrkyFeatureStatus,
  gates: [], findings: [], findingsUnreadable: false, escalations
})

const detailOk = (features: OrkyFeatureDetail[]): OrkyRootDetailResult => ({
  ok: true, root: ROOT, activeFeature: null, computedAt: 0, features, skippedFeatures: [], featuresCapped: false
})
const detailFail: OrkyRootDetailResult = { ok: false, root: ROOT, error: 'registry detail unavailable: engine not ready', errorKind: 'root-not-tracked' }

/** F7-shaped results; errorKind widened to string because the renderer-synthesized 'ipc-failure'
 *  is deliberately NOT in the F7 union (02-spec.md Verified contract). */
const fail = (kind: string, error: string): OrkyActionResult =>
  ({ ok: false, path: 'feedback', dispatched: false, errorKind: kind, error } as unknown as OrkyActionResult)
const okDispatched: OrkyActionResult = { ok: true, path: 'feedback', feedback: 'enabled', dispatched: true, data: {} }

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

// ── REQ-007: the collision-proof composite key (CONV-039) ────────────────────────────────────────
describe('flightKey — CONV-039 collision-proof (projectRoot, featureSlug, action) identity (REQ-007)', () => {
  it('TEST-584 REQ-007 same tuple → same key; the tuple boundary can never be forged by any printable separator inside a path/slug; answer and preview are independent keys', () => {
    expect(flightKey('C:\\a', 'feat', 'answer')).toBe(flightKey('C:\\a', 'feat', 'answer'))
    // No printable separator an OS permits inside a path or slug may make two DISTINCT tuples
    // collide (CONV-039): shift each candidate separator across the field boundary.
    for (const sep of [' ', '|', ':', '/', '\\', '-', '_', '.', '::', ' - ']) {
      expect(
        flightKey(`C:\\a${sep}b`, 'c', 'answer'),
        `separator ${JSON.stringify(sep)} inside projectRoot must not collide with the field boundary`
      ).not.toBe(flightKey('C:\\a', `b${sep}c`, 'answer'))
    }
    // Distinct targets and distinct actions are independent gates (REQ-007).
    expect(flightKey(ROOT, 'f1', 'answer')).not.toBe(flightKey(ROOT, 'f2', 'answer'))
    expect(flightKey(ROOT, 'f1', 'answer')).not.toBe(flightKey(ROOT, 'f1', 'preview'))
  })
})

// ── REQ-007: the SHARED single-flight gate (two-instance vector at the seam) ─────────────────────
describe('withSingleFlight — one flight per key across EVERY consumer (REQ-007)', () => {
  it('TEST-585 REQ-007 two consumers of the SAME key (the F8-row mount and a simulated F10-pane mount) share ONE started fn and ONE promise; both observe pending via isInFlight; a different key dispatches independently', async () => {
    const key = flightKey(ROOT, 'two-instance', 'answer')
    let release!: (v: string) => void
    const inFlight = new Promise<string>((r) => { release = r })
    const fnA = vi.fn(() => inFlight)              // instance 1 fires the gesture
    const fnB = vi.fn(() => Promise.resolve('B'))  // instance 2 fires before the first settles

    const p1 = withSingleFlight(key, fnA)
    const p2 = withSingleFlight(key, fnB)
    expect(fnA).toHaveBeenCalledTimes(1)           // exactly ONE dispatch (spy count 1)
    expect(fnB).not.toHaveBeenCalled()             // the second gesture is a no-op, not a queue
    expect(p2).toBe(p1)                            // BOTH instances share the SAME flight
    expect(isInFlight(key)).toBe(true)             // …and BOTH can render dq-action-pending off this

    // Distinct targets are independent (REQ-007): a different key starts its own flight.
    const other = flightKey(ROOT, 'other-feature', 'answer')
    const fnC = vi.fn(() => Promise.resolve('C'))
    await withSingleFlight(other, fnC)
    expect(fnC).toHaveBeenCalledTimes(1)

    release('settled')
    await expect(p1).resolves.toBe('settled')
    await tick()
    expect(isInFlight(key)).toBe(false)
  })

  it('TEST-586 REQ-007 REQ-010 the gate is released on settle REGARDLESS of outcome (resolve AND reject), a new dispatch is then accepted, and subscribeFlights notifies on every acquire and release (the cross-instance pending re-render seam)', async () => {
    const key = flightKey(ROOT, 'release-on-settle', 'answer')
    const seen: boolean[] = []
    const unsubscribe = subscribeFlights(() => seen.push(isInFlight(key)))

    // rejection settles the flight too — the settled outcome propagates AND the gate releases
    await expect(withSingleFlight(key, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await tick()
    expect(isInFlight(key)).toBe(false)
    expect(seen).toContain(true)                          // acquire was observable while pending
    expect(seen[seen.length - 1]).toBe(false)             // release was notified after settle

    // after settle the SAME target accepts a fresh dispatch (REQ-010 "after settle the shared
    // gate accepts a new dispatch for that target")
    const fnAgain = vi.fn(() => Promise.resolve('again'))
    await expect(withSingleFlight(key, fnAgain)).resolves.toBe('again')
    expect(fnAgain).toHaveBeenCalledTimes(1)

    // unsubscribing stops notifications (the unmount half of the subscription contract)
    unsubscribe()
    const before = seen.length
    await withSingleFlight(flightKey(ROOT, 'post-unsub', 'answer'), () => Promise.resolve(1))
    await tick()
    expect(seen.length).toBe(before)
  })
})

// ── REQ-002: answer mode is chosen from status.reason, never invented ────────────────────────────
describe('answerModeFor — context-driven answer mode (REQ-002 / D2)', () => {
  it('TEST-587 REQ-002 escalation → escalation-answer, human-review → human-review-answer, stalled → NO answer, null → NO answer', () => {
    expect(answerModeFor('escalation')).toBe('escalation')
    expect(answerModeFor('human-review')).toBe('human-review')
    expect(answerModeFor('stalled')).toBeNull()   // nothing to resolve/record — preview+resume only
    expect(answerModeFor(null)).toBeNull()        // never appears in the queue, never invented
  })
})

// ── REQ-003: identity binding at display time ────────────────────────────────────────────────────
describe('bindEscalationTarget — the id comes from the F9 detail channel, never guessed (REQ-003)', () => {
  it('TEST-588 REQ-003 a supplied escalationId (F10) binds AS-IS with ZERO pulls; without one (F8) ONE registryDetail pull binds the FIRST OPEN escalation in state.json array order — resolved entries are skipped, the structural id beats any id named in status.detail free text, and the reason is captured for display', async () => {
    // F10 path: the caller already holds the display-time id — no sourcing pull.
    const pullNever = vi.fn(async () => detailOk([]))
    const supplied = await bindEscalationTarget(target({ escalationId: 'ESC-042' }), pullNever)
    expect(supplied).toMatchObject({ ok: true, escalationId: 'ESC-042' })
    expect(pullNever).not.toHaveBeenCalled()

    // F8 path: the queue row carries no id — one pull, first OPEN wins (orky-status.ts:219 mirror).
    // The detail free text deliberately names a DIFFERENT id: the structural source must win.
    const snapshot = detailOk([
      feat('0001-other', '0001-other', [esc({ id: 'ESC-900', status: 'open' })]),
      feat('0008-queue', '0008-queue', [
        esc({ id: 'ESC-001', status: 'resolved', reason: 'old' }),
        esc({ id: 'ESC-007', status: 'open', reason: 'pick option A or B' }),
        esc({ id: 'ESC-008', status: 'open', reason: 'later one' })
      ], 'escalation ESC-999 blocking')
    ])
    const pull = vi.fn(async () => snapshot)
    const bound = await bindEscalationTarget(target(), pull)
    expect(pull).toHaveBeenCalledTimes(1)
    expect(pull).toHaveBeenCalledWith(ROOT)
    expect(bound).toEqual({ ok: true, escalationId: 'ESC-007', escalationReason: 'pick option A or B' })

    // the feature may also match by status.feature when the dir slug differs (spec REQ-003 step 1)
    const byStatusFeature = detailOk([feat('dir-name-differs', '0008-queue', [esc({ id: 'ESC-011', status: 'open' })])])
    const bound2 = await bindEscalationTarget(target(), async () => byStatusFeature)
    expect(bound2).toMatchObject({ ok: true, escalationId: 'ESC-011' })
  })

  it('TEST-589 REQ-003 every unbindable shape refuses with a SPECIFIC, pairwise-distinct message (CONV-001) and never fabricates an id: pull failed / feature unmatched / two features collide on the slug / no open escalation / id-less open escalation', async () => {
    const vectors: Array<[string, OrkyRootDetailResult]> = [
      ['pull failed', detailFail],
      ['feature unmatched', detailOk([feat('some-other', 'some-other', [esc({ id: 'ESC-001', status: 'open' })])])],
      ['slug collision', detailOk([
        feat('0008-queue', 'renamed-elsewhere', [esc({ id: 'ESC-001', status: 'open' })]),
        feat('another-dir', '0008-queue', [esc({ id: 'ESC-002', status: 'open' })])
      ])],
      // no open escalation — even though the free-text detail names one (never read from there)
      ['no open escalation', detailOk([feat('0008-queue', '0008-queue', [esc({ id: 'ESC-001', status: 'resolved' })], 'escalation ESC-999 blocking')])],
      ['id-less open escalation', detailOk([feat('0008-queue', '0008-queue', [esc({ id: null, status: 'open' })])])]
    ]
    const messages: string[] = []
    for (const [name, snapshot] of vectors) {
      const bound = await bindEscalationTarget(target(), async () => snapshot)
      expect(bound.ok, `${name} must not bind`).toBe(false)
      if (!bound.ok) {
        expect(bound.message.length, `${name} needs a specific message`).toBeGreaterThan(10)
        expect(bound.message, `${name} must never surface an id sourced from free text`).not.toContain('ESC-999')
        messages.push(bound.message)
      }
    }
    // CONV-001: the five failure classes are pairwise distinct — never one bare shared string.
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('TEST-590 REQ-003 verifyEscalationTarget: a bound id still OPEN verifies even when no longer positionally first (identity beats position); resolved-meanwhile / feature-vanished / pull-failure all refuse with the "changed — re-open to answer" class and dispatch nothing', async () => {
    // identity beats position: ESC-007 is now SECOND among the open set — still verified, same id.
    const reordered = detailOk([feat('0008-queue', '0008-queue', [
      esc({ id: 'ESC-100', status: 'open', reason: 'a newer one now sits first' }),
      esc({ id: 'ESC-007', status: 'open', reason: 'the one the human read' })
    ])])
    const stillOpen = await verifyEscalationTarget(target(), 'ESC-007', async () => reordered)
    expect(stillOpen).toMatchObject({ ok: true, escalationId: 'ESC-007' })

    // the race: the bound id was resolved meanwhile (another open one exists — must NOT be substituted)
    const changed = detailOk([feat('0008-queue', '0008-queue', [
      esc({ id: 'ESC-007', status: 'resolved' }),
      esc({ id: 'ESC-009', status: 'open' })
    ])])
    for (const [name, snapshot] of [
      ['resolved meanwhile', changed],
      ['feature vanished', detailOk([])],
      ['verification pull failed', detailFail]
    ] as Array<[string, OrkyRootDetailResult]>) {
      const verdict = await verifyEscalationTarget(target(), 'ESC-007', async () => snapshot)
      expect(verdict.ok, name).toBe(false)
      if (!verdict.ok) {
        expect(verdict.message, `${name} must carry the changed/re-open class`).toMatch(/changed|re-?open/i)
        expect(verdict.message, `${name} must never offer a substituted id`).not.toContain('ESC-009')
      }
    }
  })

  it('TEST-591 REQ-003 REQ-011 pull-count discipline: the F8-style target makes TWO DISTINCT pulls (bind + verify — the verify sees the FRESH snapshot, never a memoized copy); the F10-style target makes exactly ONE (the submit-time verification only)', async () => {
    // F8-style: no id on the target. The second pull returns a CHANGED world — verify must see it.
    const first = detailOk([feat('0008-queue', '0008-queue', [esc({ id: 'ESC-007', status: 'open' })])])
    const second = detailOk([feat('0008-queue', '0008-queue', [esc({ id: 'ESC-007', status: 'resolved' }), esc({ id: 'ESC-009', status: 'open' })])])
    let calls = 0
    const registryDetail = vi.fn(async () => (++calls === 1 ? first : second))
    const f8 = target()
    const bound = await bindEscalationTarget(f8, registryDetail)
    expect(bound).toMatchObject({ ok: true, escalationId: 'ESC-007' })
    const verdict = await verifyEscalationTarget(f8, 'ESC-007', registryDetail)
    expect(verdict.ok).toBe(false)                       // freshness proven: verify saw snapshot #2
    expect(registryDetail).toHaveBeenCalledTimes(2)      // two distinct pulls, never reused

    // F10-style: the id came with the target — NO display-time sourcing pull, ONE verification pull.
    const f10 = target({ escalationId: 'ESC-007' })
    const onePull = vi.fn(async () => first)
    expect((await bindEscalationTarget(f10, onePull)).ok).toBe(true)
    expect((await verifyEscalationTarget(f10, 'ESC-007', onePull)).ok).toBe(true)
    expect(onePull).toHaveBeenCalledTimes(1)             // exactly ONE registryDetail call total
  })
})

// ── REQ-004: requests are built with EXACTLY the entry identity + the inline input ───────────────
describe('request builders — no extra keys, no client-side rewrite (REQ-004)', () => {
  it('TEST-592 REQ-004 resolveEscalation carries exactly {projectRoot, feature, escalationId, decision} with decision BYTE-VERBATIM (flag-like prefix, emoji, inner/trailing whitespace all preserved — F7 owns the guards); recordHumanGate carries exactly {projectRoot, feature, gate, verdict} plus evidence ONLY when non-empty; driveStatus carries exactly {projectRoot, feature}', () => {
    const t = target()
    const decision = '--force  option B — ship the --json variant ✔  '
    const resolveReq = buildResolveEscalationRequest(t, 'ESC-007', decision)
    expect(resolveReq).toEqual({ projectRoot: ROOT, feature: '0008-queue', escalationId: 'ESC-007', decision })
    expect(Object.keys(resolveReq).sort()).toEqual(['decision', 'escalationId', 'feature', 'projectRoot'])
    expect(resolveReq.decision).toBe(decision)     // byte-for-byte — no trim, no --guard, no re-encode

    const review = target({ reason: 'human-review' })
    const withEvidence = buildRecordHumanGateRequest(review, 'fail', '--evidence-looking text, verbatim')
    expect(withEvidence).toEqual({
      projectRoot: ROOT, feature: '0008-queue', gate: 'human-review', verdict: 'fail',
      evidence: '--evidence-looking text, verbatim'
    })
    // empty/whitespace-only evidence means ABSENCE: the key is omitted, never sent as ''
    for (const empty of [undefined, '', '   ']) {
      const req = buildRecordHumanGateRequest(review, 'pass', empty)
      expect(req).toEqual({ projectRoot: ROOT, feature: '0008-queue', gate: 'human-review', verdict: 'pass' })
      expect('evidence' in req).toBe(false)
    }

    expect(buildDriveStatusRequest(t)).toEqual({ projectRoot: ROOT, feature: '0008-queue' })
  })
})

// ── REQ-005/REQ-008: honest success wording, keyed only on F7's own result ───────────────────────
describe('settleAnswer / settlePreview — success honesty (REQ-005 / REQ-008)', () => {
  it('TEST-593 REQ-005 REQ-008 escalation success says answered/submitted (never done/complete); human-review success says the verdict was recorded; the preview renders the NEXT action off result.data with NO mutation-claiming word; a dispatched:false answer result is NEVER a durable success [AMENDED — FINDING-013: the preview renders next + phase + reason from the REAL gk drive shape]', () => {
    const answered = settleAnswer('escalation', okDispatched)
    expect(answered.status).toBe('success')
    if (answered.status === 'success') {
      expect(answered.message).toMatch(/answered|submitted/i)
      expect(answered.message).not.toMatch(/done|complete/i)
    }

    const recorded = settleAnswer('human-review', { ...okDispatched, path: 'gatekeeper' })
    expect(recorded.status).toBe('success')
    if (recorded.status === 'success') {
      expect(recorded.message).toMatch(/recorded|verdict/i)
      expect(recorded.message).not.toMatch(/done|complete/i)
    }

    // driveStatus is READ-ONLY and dispatched:false ALWAYS (0007 REQ-009) — the preview result
    // names the computed next action and claims no mutation whatsoever.
    // [AMENDED — FINDING-013] fixtures are the REAL gk drive() shapes (gatekeeper.js:843-904),
    // never the flattened single string; the preview must render next + phase + reason as carried
    // ("next: await-human" alone is information-free on exactly the rows a human is queued for).
    const previewVectors: Array<{ data: Record<string, unknown>; must: string[] }> = [
      { data: { next: 'run-phase', phase: 'spec' }, must: ['run-phase', 'spec'] },
      { data: { next: 'await-human', reason: 'open escalation', escalations: ['ESC-007'] }, must: ['await-human', 'open escalation'] },
      { data: { next: 'await-human', reason: 'iteration cap reached for implement (3/3)', phase: 'implement' }, must: ['await-human', 'iteration cap reached for implement (3/3)'] },
      { data: { next: 'retry-phase', phase: 'implement', failed: ['findings'], attempt: 2 }, must: ['retry-phase', 'implement'] },
      { data: { next: 'done' }, must: ['done'] }
    ]
    for (const { data, must } of previewVectors) {
      const preview = settlePreview({ ok: true, path: 'gatekeeper', dispatched: false, data })
      expect(preview.status).toBe('success')
      if (preview.status === 'success') {
        for (const piece of must) expect(preview.message, `the preview must carry "${piece}"`).toContain(piece)
        expect(preview.message).toMatch(/next/i)
        expect(preview.message).not.toMatch(/resumed|advanced|dispatched|continued|unblock/i)
      }
    }

    // an answer whose own result says dispatched:false landed nothing durable — never success copy
    const notDurable = settleAnswer('escalation', { ok: true, path: 'feedback', dispatched: false })
    expect(notDurable.status).not.toBe('success')
  })
})

// ── REQ-009: failure honesty classes — verbatim, per kind, per action ────────────────────────────
describe('settleAnswer failures — indeterminate vs feedback-disabled vs definite (REQ-009)', () => {
  it('TEST-594 REQ-009 cli-timeout, cli-unparseable AND the renderer-synthesized ipc-failure are INDETERMINATE for a mutating answer: the wording admits the write may have landed and warns a retry may duplicate — never a definite non-dispatch — with the F7 error VERBATIM', () => {
    for (const kind of ['cli-timeout', 'cli-unparseable', 'ipc-failure']) {
      const error = `the gatekeeper command melted: sector 7G (${kind})`
      const out = settleAnswer('escalation', fail(kind, error))
      expect(out.status).toBe('failure')
      if (out.status === 'failure') {
        expect(out.kind).toBe(kind)
        expect(out.indeterminate, `${kind} on a mutating answer is indeterminate (CONV-015; cli-unparseable per FINDING-006 — the child completed-unreadable OR never ran)`).toBe(true)
        expect(out.error).toBe(error)                                     // verbatim (CONV-001)
        expect(out.message).toContain(error)
        expect(out.message).toMatch(/uncertain|may still|may have|duplicate/i)
        expect(out.message).not.toMatch(/was not (answered|recorded|submitted|dispatched)|did not go through|nothing was written/i)
      }
    }
  })

  it('TEST-595 REQ-009 feedback-disabled is the DISTINCT no-write outcome (nothing was written; enabling is an audited human decision outside Termhalla) — never indeterminate; every remaining kind is DEFINITE with the CLI error verbatim and NO duplicate warning', () => {
    const refusal = 'feedback is disabled — the write path requires enable-feedback (an audited decision, ADR-027)'
    const disabled = settleAnswer('escalation', fail('feedback-disabled', refusal))
    expect(disabled.status).toBe('failure')
    if (disabled.status === 'failure') {
      expect(disabled.indeterminate).toBe(false)
      expect(disabled.message).toContain(refusal)                         // verbatim
      expect(disabled.message).toMatch(/nothing was written|no .*write/i) // the distinct no-write class
      expect(disabled.message).toMatch(/audited|adr-?027/i)               // enabling is not Termhalla's call
      expect(disabled.message).not.toMatch(/duplicate|may have/i)
    }

    for (const kind of ['cli-error', 'orky-cli-not-found', 'invalid-args', 'root-not-allowed', 'feature-not-found', 'gate-not-allowed', 'unknown-sender']) {
      const error = `definite failure text for ${kind}`
      const out = settleAnswer('escalation', fail(kind, error))
      expect(out.status).toBe('failure')
      if (out.status === 'failure') {
        expect(out.kind).toBe(kind)
        expect(out.indeterminate, `${kind} is a DEFINITE non-dispatch`).toBe(false)
        expect(out.message).toContain(error)                              // verbatim (CONV-001)
        expect(out.message).not.toMatch(/duplicate/i)
      }
    }
  })

  it('TEST-596 REQ-005 REQ-009 preview failures use the SAME classifier but a read cannot duplicate a write: cli-timeout / cli-unparseable / ipc-failure stay indeterminate with SAFE-RETRY wording and NO duplicate warning; a definite preview kind renders verbatim', () => {
    for (const kind of ['cli-timeout', 'cli-unparseable', 'ipc-failure']) {
      const error = `the drive read broke: ${kind}`
      const out = settlePreview(fail(kind, error))
      expect(out.status).toBe('failure')
      if (out.status === 'failure') {
        expect(out.kind).toBe(kind)
        expect(out.indeterminate).toBe(true)
        expect(out.message).toContain(error)
        expect(out.message).toMatch(/retry|try again/i)                   // retrying a READ is safe
        expect(out.message).not.toMatch(/duplicate/i)                     // never the write warning
      }
    }
    const definite = settlePreview(fail('cli-error', 'gatekeeper drive failed: no state.json'))
    expect(definite.status).toBe('failure')
    if (definite.status === 'failure') {
      expect(definite.indeterminate).toBe(false)
      expect(definite.message).toContain('gatekeeper drive failed: no state.json')
    }
  })
})
