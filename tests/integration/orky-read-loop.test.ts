// App-level INTEGRATION suite — the READ half of the read→decide→act loop, across features
// F5 (cross-project registry) × F6 (decision queue) × F9 (OrkyPane detail) × F11 (cockpit template)
// × F13 (needs-you notifier) × 0004's brownfield seams (OrkyTracker / findOrkyRoot /
// @shared/orky-status), all wired REAL (no mocks): one shared OrkyRootEngine, the real
// OrkyRegistryStore, real chokidar watchers, real fs reads against the synthetic multi-project
// fixture. Written AFTER the build, against the assembled system (integration phase — additive;
// no per-feature suite is touched).
//
// Span map (feature seams each test crosses) — TEST-684..TEST-690:
//   TEST-684  0004(findOrkyRoot/OrkyTracker/orky:status emit) → F5 aggregate (pane + persisted + both)
//   TEST-685  F5 snapshot → F6 buildDecisionQueue/decisionQueueCount (verbatim status carry)
//   TEST-686  F5 membership → F9 registry.detail ↔ aggregate consistency (+ non-member refusal)
//   TEST-687  F5 snapshot → F13 notifier (pane-LESS project notifies; dedupe on re-emit)
//   TEST-688  F11 cockpit blueprint → F9 pane binding → F5/F9 detail readability
//   TEST-689  read/write boundary, BEHAVIORAL: every read path above made ZERO writes under .orky/
//   TEST-690  read/write boundary, STRUCTURAL: read-path modules import no write/exec primitives;
//             CLI-exec capability is confined to F7's two sanctioned modules
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { OrkyPaneStatus, OrkyRegistrySnapshot } from '@shared/types'
import { buildDecisionQueue, decisionQueueCount } from '@shared/decision-queue'
import { orkyCockpitTemplate } from '@shared/orky-cockpit'
import { workspaceFromTemplate } from '@shared/workspace-model'
import { OrkyRootEngine } from '../../src/main/orky/orky-root-engine'
import { OrkyRegistry } from '../../src/main/orky/orky-registry'
import { OrkyRegistryStore } from '../../src/main/persistence/orky-registry-store'
import { OrkyTracker } from '../../src/main/orky/orky-tracker'
import { findOrkyRoot } from '../../src/main/orky/find-orky-root'
import { OrkyNeedsYouNotifier } from '../../src/main/orky/orky-needs-you-notifier'
import {
  seedMultiProjectFixture, hashTree, diffTrees, waitFor,
  ALPHA_FEATURE, BRAVO_REVIEW_FEATURE, BRAVO_ESC_FEATURE, ALPHA_ESCALATION_ID,
  type OrkyFixture
} from './orky-fixture'

let fx: OrkyFixture
let userData: string
let engine: OrkyRootEngine
let registry: OrkyRegistry
let tracker: OrkyTracker
let baseline: { alpha: Map<string, string>; bravo: Map<string, string>; charlie: Map<string, string> }

const paneEmits: Array<{ paneId: string; status: OrkyPaneStatus | null }> = []
const notifyOnes: Array<{ title: string; body: string; projectRoot: string }> = []
const notifyDigests: Array<{ title: string; body: string; projectCount: number }> = []
let notifier: OrkyNeedsYouNotifier

function entryFor(root: string): OrkyRegistrySnapshot[number] | undefined {
  return registry.current().find(e => e.root === root)
}

beforeAll(async () => {
  fx = seedMultiProjectFixture('orky-int-read-')
  baseline = {
    alpha: hashTree(join(fx.alpha, '.orky')),
    bravo: hashTree(join(fx.bravo, '.orky')),
    charlie: hashTree(join(fx.charlie, '.orky'))
  }

  userData = mkdtempSync(join(tmpdir(), 'orky-int-read-userdata-'))
  const store = new OrkyRegistryStore(userData)
  await store.save([fx.alpha, fx.bravo]) // alpha + bravo persisted; charlie stays pane-only

  engine = new OrkyRootEngine({ debounceMs: 50 })
  registry = new OrkyRegistry(engine, store)

  // F13 observer wired to the LIVE aggregate BEFORE init, so first-population transitions count.
  notifier = new OrkyNeedsYouNotifier({
    now: () => Date.now(),
    shouldNotify: () => true,
    notifyOne: n => notifyOnes.push(n),
    notifyDigest: n => notifyDigests.push(n)
  })
  registry.onSnapshot(s => notifier.onSnapshot(s))

  // 0004's pane-facing facade over the SAME shared engine (the production composition).
  tracker = new OrkyTracker((paneId, status) => paneEmits.push({ paneId, status }), {}, engine)

  await registry.init()

  // Pane membership through the REAL production wiring: tracker.watch resolves the pane's cwd
  // upward to the project root (findOrkyRoot), and the resolved root feeds trackPaneRoot — the
  // exact register-orky.ts flow.
  const bravoRoot = await tracker.watch('pane-bravo', fx.bravoNestedCwd)
  expect(bravoRoot).toBe(resolve(fx.bravo))
  registry.trackPaneRoot('pane-bravo', bravoRoot)

  const charlieRoot = await tracker.watch('pane-charlie', fx.charlieNestedCwd)
  expect(charlieRoot).toBe(resolve(fx.charlie))
  registry.trackPaneRoot('pane-charlie', charlieRoot)

  await waitFor(
    () => registry.current().length === 3 && registry.current().every(e => e.status !== null),
    'aggregate populated for all three fixture projects'
  )
}, 30_000)

afterAll(() => {
  tracker?.dispose()
  registry?.dispose()
  engine?.dispose()
  fx?.dispose()
  rmSync(userData, { recursive: true, force: true })
})

describe('read loop: F5 aggregate over 0004 plumbing', () => {
  // TEST-684 — spans 0004 (findOrkyRoot, OrkyTracker, orky:status emit) × F5 (membership merge,
  // pane-independent aggregate): the pane-less persisted project surfaces its needs-you status.
  it('TEST-684: F5 surfaces a needs-you entry for the pane-less project; sources merge pane/persisted/both', () => {
    const snapshot = registry.current()
    expect(snapshot.map(e => e.root)).toEqual([...snapshot.map(e => e.root)].sort()) // codepoint order (REQ-007)

    const alpha = entryFor(fx.alpha)
    expect(alpha).toBeDefined()
    expect(alpha!.source).toBe('persisted') // NO open pane — the integration summary's item 1
    expect(alpha!.status!.kind).toBe('needs-input')
    expect(alpha!.status!.needsHuman).toBe(true)
    expect(alpha!.status!.chipFeature).toBe(ALPHA_FEATURE)
    const alphaFeature = alpha!.status!.features.find(f => f.feature === ALPHA_FEATURE)
    expect(alphaFeature?.reason).toBe('escalation')
    expect(alphaFeature?.gateN).toBe(5)
    expect(alphaFeature?.gateM).toBe(8)

    const bravo = entryFor(resolve(fx.bravo))
    expect(bravo?.source).toBe('both') // open pane AND persisted
    const reasons = new Map(bravo!.status!.features.map(f => [f.feature, f.reason]))
    expect(reasons.get(BRAVO_ESC_FEATURE)).toBe('escalation')
    expect(reasons.get(BRAVO_REVIEW_FEATURE)).toBe('human-review')

    const charlie = entryFor(resolve(fx.charlie))
    expect(charlie?.source).toBe('pane') // pane-only, never persisted
    expect(charlie!.status!.kind).toBe('idle')
    expect(charlie!.status!.features).toEqual([]) // clean project: empty popover roll-up

    // 0004's pane-scoped orky:status seam saw the same engine read (brownfield contract intact).
    const bravoPaneEmit = paneEmits.filter(e => e.paneId === 'pane-bravo' && e.status !== null)
    expect(bravoPaneEmit.length).toBeGreaterThan(0)
    expect(bravoPaneEmit[bravoPaneEmit.length - 1].status!.needsHuman).toBe(true)
    // findOrkyRoot resolved the DEEP pane cwd to the project root (the upward-walk seam).
    expect(findOrkyRoot(fx.bravoNestedCwd)).toBe(resolve(fx.bravo))
  })

  // TEST-685 — spans F5 → F6: the queue is built from the live aggregate, groups/ranks with the
  // shared comparator, and carries the upstream status objects VERBATIM (same references).
  it('TEST-685: F6 ranks and groups the aggregate — escalations first, clean projects absent, count = 3', () => {
    const snapshot = registry.current()
    const groups = buildDecisionQueue(snapshot)

    expect(groups.map(g => g.projectRoot)).toEqual([fx.alpha, resolve(fx.bravo)]) // alpha newer → first
    expect(groups.map(g => g.projectName)).toEqual(['alpha', 'bravo'])
    expect(decisionQueueCount(groups)).toBe(3)

    // charlie (idle) contributes nothing — membership is EXACTLY the upstream needs-you signal.
    expect(groups.some(g => g.projectRoot === resolve(fx.charlie))).toBe(false)

    // Within bravo: upstream popover order — escalation ranks above human-review.
    expect(groups[1].items.map(i => i.featureSlug)).toEqual([BRAVO_ESC_FEATURE, BRAVO_REVIEW_FEATURE])

    // Verbatim carry (REQ-015/D2): the queue item's status IS the aggregate's feature object.
    const alphaEntry = snapshot.find(e => e.root === fx.alpha)!
    const upstream = alphaEntry.status!.features.find(f => f.feature === ALPHA_FEATURE)!
    expect(groups[0].items[0].status).toBe(upstream)
  })

  // TEST-686 — spans F5 → F9: the one-shot detail pull for a MEMBER root exposes the escalation
  // identity the one-click answer actions bind to, and agrees with the aggregate's carried status; non-members refused.
  it('TEST-686: F9 detail exposes the open escalation and agrees with the aggregate; non-member roots are refused', async () => {
    const detail = await registry.detail(fx.alpha)
    if (!detail.ok) throw new Error(`detail failed: ${detail.error}`)
    expect(detail.activeFeature).toBeNull()
    expect(detail.features).toHaveLength(1)

    const feature = detail.features[0]
    expect(feature.slug).toBe(ALPHA_FEATURE)
    expect(feature.escalations).toHaveLength(1)
    expect(feature.escalations[0]).toMatchObject({
      id: ALPHA_ESCALATION_ID,
      status: 'open',
      reason: 'session-storage design needs a human decision'
    })

    // Same mapper pipeline both sides (REQ-007/REQ-015): detail status ↔ aggregate status agree.
    const aggregate = entryFor(fx.alpha)!.status!.features.find(f => f.feature === ALPHA_FEATURE)!
    expect(feature.status.kind).toBe(aggregate.kind)
    expect(feature.status.needsHuman).toBe(aggregate.needsHuman)
    expect(feature.status.reason).toBe(aggregate.reason)
    expect(feature.status.gateN).toBe(aggregate.gateN)
    expect(feature.status.gateM).toBe(aggregate.gateM)

    // The detail channel can never read an arbitrary path — non-members get the structured refusal.
    const refused = await registry.detail(join(fx.base, 'not-a-member'))
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.errorKind).toBe('root-not-tracked')
  })

  // TEST-687 — spans F5 → F13: OS-level needs-you transitions fire for ALL tracked projects —
  // including the pane-LESS one — and the dedupe holds on a re-emitted identical snapshot.
  it('TEST-687: F13 notifies for the pane-less project (3 individual, 0 digest) and dedupes re-emits', () => {
    // 3 needs-you items = 3 individual toasts (DIGEST_THRESHOLD), no digest.
    expect(notifyOnes).toHaveLength(3)
    expect(notifyDigests).toHaveLength(0)

    const byRoot = new Map(notifyOnes.map(n => [n.projectRoot, n]))
    const alphaToast = byRoot.get(fx.alpha)
    expect(alphaToast).toBeDefined() // the pane-less project DID notify
    expect(alphaToast!.body).toContain('open escalation')
    expect(alphaToast!.title + alphaToast!.body).toContain('alpha')

    const bravoToasts = notifyOnes.filter(n => n.projectRoot === resolve(fx.bravo))
    expect(bravoToasts).toHaveLength(2) // one per (root, slug, reason) identity
    const bodies = bravoToasts.map(t => t.body).join('\n')
    expect(bodies).toContain('open escalation')
    expect(bodies).toContain('awaiting human review')

    // Dedupe (REQ-003): the SAME snapshot re-observed emits nothing new.
    notifier.onSnapshot(registry.current())
    expect(notifyOnes).toHaveLength(3)
    expect(notifyDigests).toHaveLength(0)
  })

  // TEST-688 — spans F11 → F9 → F5: the cockpit blueprint instantiates to a workspace whose orky
  // pane binds the fixture root byte-verbatim, and that binding names a detail-readable member.
  it('TEST-688: F11 cockpit template binds an OrkyPane + terminal to the project root, readable via F9', async () => {
    let n = 0
    const tpl = orkyCockpitTemplate({ root: fx.alpha, shellId: 'powershell' })
    const ws = workspaceFromTemplate(tpl, 'ws-int-1', tpl.name, () => `uuid-${++n}`)

    expect(ws.name).toBe('Orky: alpha')
    const configs = Object.values(ws.panes).map(p => p.config as unknown as Record<string, unknown>)
    expect(configs).toHaveLength(2)
    const orkyPane = configs.find(c => c.kind === 'orky')
    const termPane = configs.find(c => c.kind === 'terminal')
    expect(orkyPane).toMatchObject({ kind: 'orky', root: fx.alpha }) // byte-verbatim binding
    expect(termPane).toMatchObject({ kind: 'terminal', shellId: 'powershell', cwd: fx.alpha })

    // The bound root is a live aggregate member — the pane's F9 detail pull succeeds.
    const detail = await registry.detail(orkyPane!.root as string)
    expect(detail.ok).toBe(true)
  })
})

describe('read/write boundary (the load-bearing invariant)', () => {
  // TEST-689 — BEHAVIORAL half, spanning EVERY read feature exercised above (F5 engine watch +
  // re-reads, F6 queue builds, F9 detail pulls, F13 notifier, F11 instantiation, 0004 tracker):
  // zero bytes changed under any fixture .orky/ tree.
  it('TEST-689: all read paths together made ZERO writes under any .orky/ tree', () => {
    for (const [name, root, before] of [
      ['alpha', fx.alpha, baseline.alpha],
      ['bravo', fx.bravo, baseline.bravo],
      ['charlie', fx.charlie, baseline.charlie]
    ] as const) {
      const diff = diffTrees(before, hashTree(join(root, '.orky')))
      expect(diff, `${name}/.orky must be byte-identical after the read loop`).toEqual({
        added: [], removed: [], changed: []
      })
    }
  })

  // TEST-690 — STRUCTURAL half: the read-path modules can only READ (their fs imports are the
  // read-only primitives; no child_process anywhere), and process-exec capability is confined to
  // F7's sanctioned modules (dispatcher + contract handshake) exactly.
  it('TEST-690: read-path modules import no write/exec primitives; CLI exec is confined to F7', () => {
    const READ_ONLY_FS = new Set(['readFile', 'readdir', 'stat', 'lstat', 'statSync', 'existsSync'])
    const readPathFiles = [
      'src/main/orky/orky-root-engine.ts',
      'src/main/orky/orky-root-detail.ts',
      'src/main/orky/orky-tracker.ts',
      'src/main/orky/find-orky-root.ts',
      'src/main/orky/orky-registry.ts',
      'src/main/orky/orky-needs-you-notifier.ts',
      'src/main/status/orky-osc-parser.ts',
      'src/shared/orky-status.ts',
      'src/shared/orky-registry.ts',
      'src/shared/decision-queue.ts',
      'src/shared/orky-cockpit.ts',
      'src/shared/orky-pane.ts'
    ]
    for (const rel of readPathFiles) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      // No process execution on any read path.
      expect(src.includes('child_process'), `${rel} must not touch child_process`).toBe(false)
      // Every fs import must be a read-only primitive.
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(?:node:)?fs(?:\/promises)?'/g)) {
        for (const raw of m[1].split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0].trim()
          if (!name || name === 'type') continue
          expect(READ_ONLY_FS.has(name.replace(/^type\s+/, '')), `${rel} imports fs.${name} — a read path may only read`).toBe(true)
        }
      }
    }

    // Exec capability confinement: orky-cli-runner (the ONLY execFile wrapper for Orky CLIs) is
    // imported by exactly the F7 dispatcher and the read-only contract handshake.
    const orkyMain = 'src/main/orky'
    const importers: string[] = []
    for (const f of [
      'find-orky-root.ts', 'orky-action-audit.ts', 'orky-action-dispatcher.ts', 'orky-action-queue.ts',
      'orky-cli-locate.ts', 'orky-cli-runner.ts', 'orky-contract-handshake.ts',
      'orky-needs-you-notifier.ts', 'orky-registry.ts', 'orky-root-detail.ts', 'orky-root-engine.ts',
      'orky-stream-status.ts', 'orky-tracker.ts', 'validate-root.ts'
    ]) {
      const src = readFileSync(resolve(process.cwd(), orkyMain, f), 'utf8')
      if (f !== 'orky-cli-runner.ts' && /from '\.\/orky-cli-runner'/.test(src)) importers.push(f)
    }
    expect(importers.sort()).toEqual(['orky-action-dispatcher.ts', 'orky-contract-handshake.ts'])
  })
})
