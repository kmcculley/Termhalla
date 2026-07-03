// App-level INTEGRATION suite — the ACT half of the read→decide→act loop, dispatched through F7 to
// the REAL Orky CLIs (gatekeeper/cli.js + feedback/cli.js under ORKY_PLUGIN_DIR) with every state
// change RE-DERIVED FROM GROUND TRUTH: state.json is mutated by the Gatekeeper (never by
// Termhalla), inbox/outbox/backlog land where the feedback plugin's own contract says, and the
// re-read (F5 engine/watcher, F9 detail, F6 queue) reflects the mutation. This is the pipeline's
// whole thesis, proven end-to-end with zero mocks: real OrkyRegistry allowlist, real
// OrkyActionAuditLog, real OrkyActionQueue, real runOrkyCli (execFile of process.execPath), real
// CLI JSON parsed by the real mappers.
//
// SKIPPED (not failed) when the Orky plugin is not installed at ORKY_PLUGIN_DIR — `npm test` stays
// deterministic on a machine without Orky; the committed golden fixtures keep the contract pinned
// there (tests/shared/orky-contract-golden.test.ts).
//
// Span map — TEST-691..TEST-702 (tests run IN ORDER; later tests assert state earlier tests created):
//   TEST-691  F7 cli-locate/cli-runner × the LIVE installed plugin (`gatekeeper contract` handshake)
//   TEST-692  F6 queue entry → F8 bind/verify/build (orky-entry-actions-core) → F7 dispatch →
//             REAL `gatekeeper resolve-escalation` → state.json mutated ON DISK by the Gatekeeper
//   TEST-693  F8 stale-answer guards + F9 detail re-derivation after the REAL mutation
//   TEST-694  0004 watcher × F5 × F6: the CLI's write propagates through chokidar → engine →
//             registry → the queue entry disappears, with no Termhalla write
//   TEST-695  F10/F8 recordHumanGate → REAL `gatekeeper record` → human-review gate passed on disk
//             → feature leaves the queue
//   TEST-696  F8/F10 preview → F7 driveStatus → REAL `gatekeeper drive` → settlePreview copy
//   TEST-697  F8 answer with feedback ENABLED → F7 → REAL `feedback emit` → outbox event on disk;
//             state.json deliberately UNTOUCHED (the control-plane contract)
//   TEST-698  F12 quick-capture → F7 submitWork → REAL `feedback submit` → inbox item on disk →
//             REAL `feedback apply` → backlog.jsonl + applied.jsonl journal (idempotent)
//   TEST-699  F12 × F7 feedback-disabled: the DISTINCT no-write outcome, verbatim CLI refusal,
//             zero filesystem trace; F8's shared classifier renders the no-write copy
//   TEST-700  F5 ↔ F7 trust boundary: an aggregate-visible pane-ONLY root is write-refused
//   TEST-701  F7 audit ledger: one record per dispatcher invocation, free text as lengths only
//   TEST-702  read/write boundary under WRITES: the changed-file set across every .orky/ tree is
//             EXACTLY the sanctioned CLI-written set; the untouched project is byte-identical
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { OrkyActionResult, OrkyRootDetailResult } from '@shared/types'
import { buildDecisionQueue } from '@shared/decision-queue'
import { OrkyActionDispatcher } from '../../src/main/orky/orky-action-dispatcher'
import { OrkyActionAuditLog } from '../../src/main/orky/orky-action-audit'
import { OrkyActionQueue } from '../../src/main/orky/orky-action-queue'
import { runOrkyCli } from '../../src/main/orky/orky-cli-runner'
import { locateOrkyCli } from '../../src/main/orky/orky-cli-locate'
import { verifyOrkyContract, EXPECTED_CONTRACT_VERSION } from '../../src/main/orky/orky-contract-handshake'
import { OrkyRootEngine } from '../../src/main/orky/orky-root-engine'
import { OrkyRegistry } from '../../src/main/orky/orky-registry'
import { OrkyRegistryStore } from '../../src/main/persistence/orky-registry-store'
import {
  answerModeFor, bindEscalationTarget, verifyEscalationTarget,
  buildResolveEscalationRequest, settleAnswer, settlePreview,
  type OrkyEntryTarget
} from '../../src/renderer/components/orky-entry-actions-core'
import {
  seedMultiProjectFixture, hashTree, diffTrees, waitFor,
  ORKY_PLUGIN_DIR, hasOrkyPlugin,
  ALPHA_FEATURE, BRAVO_REVIEW_FEATURE, BRAVO_ESC_FEATURE,
  ALPHA_ESCALATION_ID, BRAVO_ESCALATION_ID,
  type OrkyFixture
} from './orky-fixture'

const DECISION_TEXT = 'Use OAuth PKCE per RFC 7636 — rotate refresh tokens ("§4.2"), keep sessions server-side'
const CAPTURE_TITLE = 'Add rate limiting to the public API'
const CAPTURE_DETAIL = 'Sliding window, 429 + Retry-After; exempt health checks — captured from Termhalla'

let fx: OrkyFixture
let userData: string
let engine: OrkyRootEngine
let registry: OrkyRegistry
let dispatcher: OrkyActionDispatcher
let baseline: { alpha: Map<string, string>; bravo: Map<string, string>; charlie: Map<string, string> }

/** Every action name sent through the dispatcher, in order — the audit-ledger oracle (TEST-701). */
const dispatchedActions: string[] = []
function viaDispatcher<T extends OrkyActionResult>(action: string, p: Promise<T>): Promise<T> {
  dispatchedActions.push(action)
  return p
}

const locate = (kind: 'gatekeeper' | 'feedback'): string | null =>
  locateOrkyCli(kind, { ORKY_PLUGIN_DIR })

const registryDetailPull = (root: string): Promise<OrkyRootDetailResult> => registry.detail(root)

function readState(featureDir: string): {
  gates: Record<string, { passed?: boolean; external?: boolean; evidence?: string }>
  escalations: Array<{ id: string; status: string; decision?: string; resolvedAt?: string }>
} {
  return JSON.parse(readFileSync(join(featureDir, 'state.json'), 'utf8'))
}

describe.skipIf(!hasOrkyPlugin)('act loop: F6/F8/F10/F12 → F7 → the REAL Orky CLIs → ground truth', () => {
  beforeAll(async () => {
    fx = seedMultiProjectFixture('orky-int-act-')
    baseline = {
      alpha: hashTree(join(fx.alpha, '.orky')),
      bravo: hashTree(join(fx.bravo, '.orky')),
      charlie: hashTree(join(fx.charlie, '.orky'))
    }

    userData = mkdtempSync(join(tmpdir(), 'orky-int-act-userdata-'))
    const store = new OrkyRegistryStore(userData)
    await store.save([fx.alpha, fx.bravo]) // the write allowlist: persisted roots ONLY (0007 REQ-004)

    engine = new OrkyRootEngine({ debounceMs: 50 })
    registry = new OrkyRegistry(engine, store)
    await registry.init()
    registry.trackPaneRoot('pane-charlie', fx.charlie) // aggregate member, NEVER allowlisted

    dispatcher = new OrkyActionDispatcher({
      registry,                                     // the REAL F5 registry — no fake allowlist
      auditLog: new OrkyActionAuditLog(userData),   // real append-only ledger under userData
      queue: new OrkyActionQueue(),
      runCli: runOrkyCli,                           // the REAL execFile runner
      locateOrkyCli: locate                         // the REAL resolver, pinned to this plugin dir
    })

    await waitFor(
      () => registry.current().length === 3 && registry.current().every(e => e.status !== null),
      'aggregate populated for all three fixture projects'
    )
  }, 30_000)

  afterAll(() => {
    dispatcher?.dispose()
    registry?.dispose()
    engine?.dispose()
    fx?.dispose()
    rmSync(userData, { recursive: true, force: true })
  })

  // TEST-691 — spans F7's locate/run seams × the LIVE installed plugin: the startup contract
  // handshake agrees with Termhalla's mirrored constants against the plugin actually on this disk
  // (the runtime complement of the committed golden fixtures).
  it('TEST-691: live `gatekeeper contract` handshake agrees with the mirrored constants', async () => {
    const warns: string[] = []
    const check = await verifyOrkyContract({ locate, warn: l => warns.push(l) })
    expect(check.ok).toBe(true)
    expect(check.contractVersion).toBe(EXPECTED_CONTRACT_VERSION)
    expect(check.mismatches).toEqual([])
    expect(check.note).toBeUndefined() // detected and compared, not "undetectable"
    expect(warns).toEqual([])
  })

  // TEST-692 — the integration summary's item 3, disabled-feedback leg: a queue entry's one-click
  // answer travels F6 → F8's bind/verify/build core → F7 → the REAL gatekeeper, and the escalation
  // is resolved ON DISK by the Gatekeeper — Termhalla never writes state.json.
  it('TEST-692: one-click answer resolves the escalation on disk via the REAL gatekeeper (feedback disabled)', async () => {
    // (1) READ: the live queue carries the alpha entry.
    const groups = buildDecisionQueue(registry.current())
    const alphaGroup = groups.find(g => g.projectRoot === fx.alpha)
    expect(alphaGroup).toBeDefined()
    const item = alphaGroup!.items[0]
    expect(item.featureSlug).toBe(ALPHA_FEATURE)

    // (2) DECIDE: F8's shared core — answer mode from the entry's reason, escalation identity
    // bound from a FRESH F9 detail pull, re-verified at submit time, request built verbatim.
    const target: OrkyEntryTarget = {
      projectRoot: item.projectRoot, featureSlug: item.featureSlug, reason: item.status.reason
    }
    expect(answerModeFor(target.reason)).toBe('escalation')
    const binding = await bindEscalationTarget(target, registryDetailPull)
    if (!binding.ok) throw new Error(binding.message)
    expect(binding.escalationId).toBe(ALPHA_ESCALATION_ID)
    expect(binding.escalationReason).toBe('session-storage design needs a human decision')
    const verified = await verifyEscalationTarget(target, binding.escalationId, registryDetailPull)
    expect(verified.ok).toBe(true)
    const req = buildResolveEscalationRequest(target, binding.escalationId, DECISION_TEXT)

    // (3) ACT: through the real dispatcher → real feedback CLI (disabled → mode:'noop') → real
    // gatekeeper fallback. The result names the path honestly.
    const res = await viaDispatcher('resolveEscalation', dispatcher.resolveEscalation(req, 42))
    expect(res).toMatchObject({
      ok: true, path: 'gatekeeper', feedback: 'disabled', dispatched: true, exitCode: 0
    })
    expect((res.data as { status?: string }).status).toBe('resolved')

    // (4) GROUND TRUTH: state.json was mutated by the Gatekeeper — resolved, decision verbatim.
    const state = readState(fx.alphaFeatureDir)
    expect(state.escalations).toHaveLength(1)
    expect(state.escalations[0].id).toBe(ALPHA_ESCALATION_ID)
    expect(state.escalations[0].status).toBe('resolved')
    expect(state.escalations[0].decision).toBe(DECISION_TEXT) // byte-verbatim through argv + CLI
    expect(Number.isNaN(Date.parse(state.escalations[0].resolvedAt ?? ''))).toBe(false)

    // (5) The F8 classifier renders the durable-success copy off the REAL F7 result.
    expect(settleAnswer('escalation', res)).toEqual({
      status: 'success', message: 'Escalation answered — the decision was submitted.'
    })
  })

  // TEST-693 — spans F8 × F9 after the REAL mutation: the submit-time guards observe the changed
  // world (never substitute a different escalation), and the detail re-derives resolved state.
  it('TEST-693: stale-answer guards refuse after the real resolution; F9 detail re-derives it', async () => {
    const target: OrkyEntryTarget = { projectRoot: fx.alpha, featureSlug: ALPHA_FEATURE, reason: 'escalation' }

    const reVerify = await verifyEscalationTarget(target, ALPHA_ESCALATION_ID, registryDetailPull)
    expect(reVerify.ok).toBe(false)
    if (!reVerify.ok) expect(reVerify.message).toContain('nothing was sent')

    const reBind = await bindEscalationTarget(target, registryDetailPull)
    expect(reBind.ok).toBe(false)
    if (!reBind.ok) expect(reBind.message).toContain('no open escalation')

    const detail = await registry.detail(fx.alpha)
    if (!detail.ok) throw new Error(detail.error)
    expect(detail.features[0].escalations[0]).toMatchObject({
      id: ALPHA_ESCALATION_ID, status: 'resolved', decision: DECISION_TEXT
    })
    expect(detail.features[0].status.needsHuman).toBe(false)
  })

  // TEST-694 — spans 0004's watcher × F5 × F6: the Gatekeeper's own write is the ONLY trigger; the
  // live registry re-reads it through chokidar and the queue entry disappears without any
  // Termhalla-side write or manual refresh.
  it('TEST-694: the CLI write propagates watcher → engine → registry → the queue drops the entry', async () => {
    await waitFor(() => {
      const groups = buildDecisionQueue(registry.current())
      return !groups.some(g => g.projectRoot === fx.alpha)
    }, 'alpha left the decision queue after the gatekeeper resolved ESC-001')
    const alphaEntry = registry.current().find(e => e.root === fx.alpha)
    expect(alphaEntry?.status?.needsHuman).toBe(false)
  })

  // TEST-695 — spans F10/F8 → F7 → REAL `gatekeeper record`: the human-review verdict lands as an
  // external gate record on disk; the feature re-derives as done and leaves the queue.
  it('TEST-695: recordHumanGate passes human-review on disk via the REAL gatekeeper; feature re-derives done', async () => {
    const res = await viaDispatcher('recordHumanGate', dispatcher.recordHumanGate({
      projectRoot: fx.bravo, feature: BRAVO_REVIEW_FEATURE, gate: 'human-review',
      verdict: 'pass', evidence: 'integration-tester witnessed the assembled read→decide→act loop'
    }, 42))
    expect(res).toMatchObject({ ok: true, path: 'gatekeeper', dispatched: true, exitCode: 0 })
    expect(settleAnswer('human-review', res)).toEqual({
      status: 'success', message: 'Human-review verdict recorded.'
    })

    // Ground truth: the gate record is the Gatekeeper's own external-verdict shape.
    const state = readState(fx.bravoReviewFeatureDir)
    expect(state.gates['human-review']).toMatchObject({ passed: true, external: true })
    expect(state.gates['human-review'].evidence).toContain('integration-tester witnessed')

    // Re-derived: F9 detail reports the feature complete (all 8 gates), F6 drops it.
    const detail = await registry.detail(fx.bravo)
    if (!detail.ok) throw new Error(detail.error)
    const feature = detail.features.find(f => f.slug === BRAVO_REVIEW_FEATURE)!
    expect(feature.status.kind).toBe('done')
    expect(feature.status.gateN).toBe(8)
    await waitFor(() => {
      const bravoGroup = buildDecisionQueue(registry.current()).find(g => g.projectRoot === resolve(fx.bravo))
      return bravoGroup !== undefined && !bravoGroup.items.some(i => i.featureSlug === BRAVO_REVIEW_FEATURE)
    }, 'bravo/0001 left the queue after human-review passed (0002 escalation remains)')
  })

  // TEST-696 — spans F8/F10 preview → F7 driveStatus → REAL `gatekeeper drive`: the read-only
  // preview reports the pipeline's computed next action for both a blocked and a done feature.
  it('TEST-696: driveStatus preview reads the REAL computed next action (never dispatches)', async () => {
    const blocked = await viaDispatcher('driveStatus', dispatcher.driveStatus({
      projectRoot: fx.bravo, feature: BRAVO_ESC_FEATURE
    }, 42))
    expect(blocked).toMatchObject({ ok: true, path: 'gatekeeper', dispatched: false, exitCode: 0 })
    expect(blocked.data).toMatchObject({ next: 'await-human', reason: 'open escalation' })
    expect((blocked.data as { escalations?: string[] }).escalations).toEqual([BRAVO_ESCALATION_ID])
    expect(settlePreview(blocked)).toEqual({ status: 'success', message: 'next: await-human — open escalation' })

    const done = await viaDispatcher('driveStatus', dispatcher.driveStatus({
      projectRoot: fx.bravo, feature: BRAVO_REVIEW_FEATURE
    }, 42))
    expect(done.ok).toBe(true)
    expect((done.data as { next?: string }).next).toBe('done')
    expect(settlePreview(done)).toEqual({ status: 'success', message: 'next: done' })
  })

  // TEST-697 — the feedback-ENABLED answer leg: F7 rides the sanctioned `feedback emit` path; the
  // decision becomes an outbox EVENT (the control-plane contract) and state.json is deliberately
  // NOT mutated — only the Gatekeeper (via the orchestrator's apply) ever resolves it.
  it('TEST-697: answer with feedback enabled emits a decision event to the outbox; state.json untouched', async () => {
    const req = buildResolveEscalationRequest(
      { projectRoot: fx.bravo, featureSlug: BRAVO_ESC_FEATURE, reason: 'escalation' },
      BRAVO_ESCALATION_ID,
      'Cursor-based pagination; opaque continuation tokens'
    )
    const res = await viaDispatcher('resolveEscalation', dispatcher.resolveEscalation(req, 42))
    expect(res).toMatchObject({
      ok: true, path: 'feedback', feedback: 'enabled', dispatched: true, exitCode: 0
    })
    expect((res.data as { mode?: string }).mode).toBe('file')

    // Ground truth: exactly one outbox event, carrying the decision payload verbatim.
    const outbox = join(fx.bravo, '.orky', 'feedback', 'outbox')
    const events = readdirSync(outbox).filter(f => f.endsWith('.json'))
    expect(events).toHaveLength(1)
    const event = JSON.parse(readFileSync(join(outbox, events[0]), 'utf8'))
    expect(event).toMatchObject({
      type: 'decision',
      feature: BRAVO_ESC_FEATURE,
      payload: {
        escalationId: BRAVO_ESCALATION_ID,
        decision: 'Cursor-based pagination; opaque continuation tokens'
      }
    })

    // The escalation is STILL open on disk — Termhalla wrote nothing to state.json; resolution is
    // the control plane's job downstream. The queue honestly keeps the entry.
    const state = readState(fx.bravoEscFeatureDir)
    expect(state.escalations[0]).toMatchObject({ id: BRAVO_ESCALATION_ID, status: 'open' })
    expect(state.escalations[0].decision).toBeUndefined()
  })

  // TEST-698 — the integration summary's item 5: F12 quick-capture → F7 submitWork → the REAL
  // `feedback submit` (plugin v0.28.0 local-inbox injection) → REAL `feedback apply` → backlog.
  it('TEST-698: submitWork lands in the file-mode inbox; the REAL apply drains it to the backlog (idempotent)', async () => {
    const res = await viaDispatcher('submitWork', dispatcher.submitWork({
      projectRoot: fx.bravo, title: CAPTURE_TITLE, detail: CAPTURE_DETAIL
    }, 42))
    expect(res).toMatchObject({
      ok: true, path: 'feedback', feedback: 'enabled', dispatched: true, exitCode: 0
    })
    const receipt = res.data as { id?: string; kind?: string; mode?: string }
    expect(receipt.kind).toBe('work.request')
    expect(receipt.mode).toBe('file')
    expect(receipt.id).toMatch(/^IN-/)

    // Ground truth (inbox): the item is on disk in exactly the shape `apply` consumes.
    const inboxFile = join(fx.bravo, '.orky', 'feedback', 'inbox', `${receipt.id}.json`)
    const item = JSON.parse(readFileSync(inboxFile, 'utf8'))
    expect(item).toMatchObject({
      id: receipt.id, kind: 'work.request', title: CAPTURE_TITLE, detail: CAPTURE_DETAIL, by: 'local-client'
    })

    // The REAL orchestrator-side drain: `feedback apply` → backlog.jsonl, journaled.
    const feedbackCli = locate('feedback')!
    const apply = await runOrkyCli(feedbackCli, ['apply', '--app', fx.bravo])
    expect(apply.exitCode).toBe(0)
    const applied = JSON.parse(apply.stdout) as { ok: boolean; applied: Array<{ id: string; kind: string }> }
    expect(applied.ok).toBe(true)
    expect(applied.applied).toEqual([expect.objectContaining({ id: receipt.id, kind: 'work.request' })])

    const backlogLines = readFileSync(join(fx.bravo, '.orky', 'backlog.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(l => JSON.parse(l))
    expect(backlogLines).toHaveLength(1)
    expect(backlogLines[0]).toMatchObject({ title: CAPTURE_TITLE, detail: CAPTURE_DETAIL, status: 'pending' })
    expect(backlogLines[0].id).toMatch(/^WORK-/)

    const journal = readFileSync(join(fx.bravo, '.orky', 'feedback', 'applied.jsonl'), 'utf8')
    expect(journal).toContain(receipt.id)

    // Idempotence: a second apply re-applies NOTHING (the journal is the source of truth).
    const apply2 = await runOrkyCli(feedbackCli, ['apply', '--app', fx.bravo])
    expect(apply2.exitCode).toBe(0)
    expect((JSON.parse(apply2.stdout) as { applied: unknown[] }).applied).toEqual([])
    const backlogAfter = readFileSync(join(fx.bravo, '.orky', 'backlog.jsonl'), 'utf8').split('\n').filter(Boolean)
    expect(backlogAfter).toHaveLength(1)
  })

  // TEST-699 — the integration summary's item 7 for the write features: with feedback disabled the
  // REAL CLI refuses loudly, F7 discriminates the DISTINCT feedback-disabled outcome (no
  // auto-enable, verbatim refusal), and NOTHING touches the disk.
  it('TEST-699: submitWork against a feedback-disabled project is the distinct no-write outcome', async () => {
    const res = await viaDispatcher('submitWork', dispatcher.submitWork({
      projectRoot: fx.alpha, title: 'should never land', detail: 'feedback is disabled here'
    }, 42))
    expect(res).toMatchObject({
      ok: false, path: 'feedback', feedback: 'disabled', dispatched: false,
      errorKind: 'feedback-disabled', exitCode: 1
    })
    // The CLI's own refusal, verbatim (CONV-001) — names the audited enable path, never auto-enables.
    expect(res.error).toContain('feedback is disabled')
    expect(res.error).toContain('enable-feedback')

    // Ground truth: zero trace — no inbox, no feedback dir, no backlog.
    expect(existsSync(join(fx.alpha, '.orky', 'feedback'))).toBe(false)
    expect(existsSync(join(fx.alpha, '.orky', 'backlog.jsonl'))).toBe(false)

    // The shared F8/F10 classifier renders the honest no-write copy from the REAL result shape.
    const settled = settleAnswer('escalation', res)
    expect(settled.status).toBe('failure')
    if (settled.status === 'failure') {
      expect(settled.kind).toBe('feedback-disabled')
      expect(settled.indeterminate).toBe(false)
      expect(settled.message).toContain('Nothing was written')
    }
  })

  // TEST-700 — the F5↔F7 trust boundary: charlie is aggregate-VISIBLE (source 'pane', F6-readable)
  // but NOT in registry.roots() (persisted-only allowlist), so every write action refuses before
  // any CLI runs — pane presence alone never grants write capability.
  it('TEST-700: an aggregate-visible pane-only root is refused by the write allowlist', async () => {
    const entry = registry.current().find(e => e.root === fx.charlie)
    expect(entry?.source).toBe('pane')                    // visible to every read feature
    expect(registry.roots()).toEqual([fx.alpha, fx.bravo]) // but not allowlisted

    const res = await viaDispatcher('driveStatus', dispatcher.driveStatus({
      projectRoot: fx.charlie, feature: '0001-charlie-core'
    }, 42))
    expect(res).toMatchObject({ ok: false, path: null, dispatched: false, errorKind: 'root-not-allowed' })
    expect(res.error).toContain(fx.charlie)
    expect(res.exitCode).toBeUndefined() // refused BEFORE any CLI invocation
  })

  // TEST-701 — F7's audit ledger across everything above: one append-only JSONL record per
  // dispatcher invocation, in call order, with human free text captured as LENGTHS only.
  it('TEST-701: the audit ledger recorded every invocation, redaction-safe and in order', () => {
    const lines = readFileSync(join(userData, 'orky-actions.jsonl'), 'utf8').split('\n').filter(Boolean)
    const records = lines.map(l => JSON.parse(l) as Record<string, unknown>)
    expect(records.map(r => r.action)).toEqual(dispatchedActions)

    for (const r of records) {
      expect(typeof r.ts).toBe('number')
      expect(typeof r.ok).toBe('boolean')
      expect(typeof r.dispatched).toBe('boolean')
      expect(r.windowId).toBe(42)
    }

    // The resolve record carries decisionLength, never the decision text (REQ-013 redaction).
    const resolveRec = records.find(r => r.action === 'resolveEscalation')!
    expect((resolveRec.argsSummary as Record<string, unknown>).decisionLength).toBe(DECISION_TEXT.length)
    expect(readFileSync(join(userData, 'orky-actions.jsonl'), 'utf8')).not.toContain('OAuth PKCE')

    // The refused pane-only call was audited too (every invocation reaching the dispatcher is).
    const refused = records.find(r => r.errorKind === 'root-not-allowed')
    expect(refused).toBeDefined()
    expect(refused!.projectRoot).toBe(fx.charlie)
  })

  // TEST-702 — the load-bearing invariant under WRITES (integration summary item 6): across the
  // ENTIRE act loop, the only bytes that changed under any .orky/ tree are the sanctioned
  // CLI-written files. Termhalla's own writes all landed under userData, never under .orky/.
  it('TEST-702: the changed-file set under .orky/ is exactly the sanctioned CLI-written set', () => {
    // charlie: read-only member throughout — byte-identical.
    expect(diffTrees(baseline.charlie, hashTree(join(fx.charlie, '.orky'))))
      .toEqual({ added: [], removed: [], changed: [] })

    // alpha: ONLY the gatekeeper's resolve-escalation touched state.json. The disabled submitWork
    // and the disabled-channel emit left zero trace.
    const alphaDiff = diffTrees(baseline.alpha, hashTree(join(fx.alpha, '.orky')))
    expect(alphaDiff.changed).toEqual([`features/${ALPHA_FEATURE}/state.json`])
    expect(alphaDiff.added).toEqual([])
    expect(alphaDiff.removed).toEqual([])

    // bravo: the gatekeeper's record on 0001's state.json, plus the feedback plugin's own
    // outbox/inbox/journal/backlog files. 0002's state.json was NOT touched (the enabled answer
    // emitted an event; it never resolved state directly).
    const bravoDiff = diffTrees(baseline.bravo, hashTree(join(fx.bravo, '.orky')))
    expect(bravoDiff.changed).toEqual([`features/${BRAVO_REVIEW_FEATURE}/state.json`])
    expect(bravoDiff.removed).toEqual([])
    const addedKinds = bravoDiff.added.map(p =>
      p === 'backlog.jsonl' ? 'backlog'
      : p === 'feedback/applied.jsonl' ? 'journal'
      : /^feedback\/outbox\/.+\.json$/.test(p) ? 'outbox-event'
      : /^feedback\/inbox\/IN-.+\.json$/.test(p) ? 'inbox-item'
      : `UNSANCTIONED:${p}`
    ).sort()
    expect(addedKinds).toEqual(['backlog', 'inbox-item', 'journal', 'outbox-event'])
  })
})
