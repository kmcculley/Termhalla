// Shared synthetic multi-project `.orky/` fixture for the app-level INTEGRATION suites
// (tests/integration/orky-*.test.ts). NOT a test file — a builder the three suites import.
//
// The fixture is the integration phase's ground truth: THREE projects with real, producer-shaped
// Orky state (the shapes `gatekeeper.js` itself writes — gates with `passed`/`at`, escalations with
// the `addEscalation` field set, `active.json` with the heartbeat fields), each exercising a
// different corner of the read→decide→act loop:
//
//   alpha   — persisted-only membership, NO open pane (the pane-less needs-you case the roadmap's
//             integration summary item 1 mandates). One feature with an OPEN escalation (ESC-001).
//             `config.json` feedback DISABLED → the F7 resolveEscalation path falls through to the
//             REAL `gatekeeper resolve-escalation`, which mutates state.json on disk.
//   bravo   — pane + persisted membership ('both'). Feature 0001 awaits human-review (all 7
//             autonomous gates passed); feature 0002 carries an open escalation. `config.json`
//             feedback ENABLED (file mode) → submitWork lands in `.orky/feedback/inbox/` and
//             resolveEscalation rides the sanctioned `feedback emit` outbox path.
//   charlie — pane-ONLY membership, clean/idle (no needs-you entry): proves clean projects stay out
//             of the decision queue AND pins the F5↔F7 trust boundary (aggregate-visible but not in
//             `registry.roots()`, so every write is refused `root-not-allowed`).
//
// Timestamps are fixed so ranking is deterministic: alpha's newest gate (06-30) is NEWER than
// bravo's (06-29), so with equal reason rank ('escalation') alpha groups first (REQ-007 tiebreak).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The real Orky plugin install this machine carries. The act/osc suites skip (never fail) when it
 *  is absent — `npm test` stays deterministic on a machine without Orky, and the committed golden
 *  fixtures (tests/fixtures/orky-contract/) keep pinning the contract there. */
export const ORKY_PLUGIN_DIR = process.env.ORKY_PLUGIN_DIR ?? 'C:/dev/Orky/plugin'
export const hasOrkyPlugin =
  existsSync(join(ORKY_PLUGIN_DIR, 'gatekeeper', 'cli.js')) &&
  existsSync(join(ORKY_PLUGIN_DIR, 'feedback', 'cli.js'))

export const ALPHA_FEATURE = '0001-alpha-auth'
export const BRAVO_REVIEW_FEATURE = '0001-bravo-ui'
export const BRAVO_ESC_FEATURE = '0002-bravo-api'
export const CHARLIE_FEATURE = '0001-charlie-core'
export const ALPHA_ESCALATION_ID = 'ESC-001'
export const BRAVO_ESCALATION_ID = 'ESC-001'

export interface OrkyFixture {
  base: string
  alpha: string
  bravo: string
  charlie: string
  alphaFeatureDir: string
  bravoReviewFeatureDir: string
  bravoEscFeatureDir: string
  bravoNestedCwd: string   // deep inside bravo — exercises findOrkyRoot's upward walk (0004 seam)
  charlieNestedCwd: string
  dispose: () => void
}

type Gates = Record<string, { passed: boolean; at: string }>

function gatesFor(phases: string[], baseIso: string): Gates {
  const base = Date.parse(baseIso)
  const gates: Gates = {}
  phases.forEach((p, i) => {
    gates[p] = { passed: true, at: new Date(base + i * 60_000).toISOString() }
  })
  return gates
}

interface FeatureSeed {
  slug: string
  phase: string
  gates: Gates
  escalations?: unknown[]
  findings?: unknown[]
}

function seedProject(
  root: string,
  opts: { config: unknown; lastAction: string; features: FeatureSeed[] }
): void {
  const orky = join(root, '.orky')
  mkdirSync(join(orky, 'features'), { recursive: true })
  writeFileSync(join(orky, 'config.json'), JSON.stringify(opts.config, null, 2) + '\n', 'utf8')
  writeFileSync(
    join(orky, 'active.json'),
    JSON.stringify(
      {
        feature: null,
        projectRoot: root.replace(/\\/g, '/'),
        phase: null,
        lastTickAt: '2026-06-30T12:00:00Z',
        lastAction: opts.lastAction,
        runs: {}
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
  for (const f of opts.features) {
    const fdir = join(orky, 'features', f.slug)
    mkdirSync(fdir, { recursive: true })
    writeFileSync(
      join(fdir, 'state.json'),
      JSON.stringify(
        {
          feature: f.slug,
          phase: f.phase,
          gates: f.gates,
          iterations: {},
          escalations: f.escalations ?? [],
          concerns: []
        },
        null,
        2
      ) + '\n',
      'utf8'
    )
    writeFileSync(join(fdir, 'findings.json'), JSON.stringify(f.findings ?? [], null, 2) + '\n', 'utf8')
  }
}

/** Build the three-project fixture in a fresh temp dir. Caller owns `dispose()`. */
export function seedMultiProjectFixture(prefix: string): OrkyFixture {
  const base = mkdtempSync(join(tmpdir(), prefix))
  const alpha = join(base, 'alpha')
  const bravo = join(base, 'bravo')
  const charlie = join(base, 'charlie')

  // alpha: open escalation, feedback DISABLED (the gatekeeper-fallback answer path).
  seedProject(alpha, {
    config: { feedback: { enabled: false } },
    lastAction: 'review blocked on ESC-001',
    features: [
      {
        slug: ALPHA_FEATURE,
        phase: 'review',
        // 5 of 8 gates passed -> gate frontier 'review', gateN 5.
        gates: gatesFor(['brainstorm', 'spec', 'plan', 'tests', 'implement'], '2026-06-30T10:00:00Z'),
        escalations: [
          {
            id: ALPHA_ESCALATION_ID,
            phase: 'review',
            reason: 'session-storage design needs a human decision',
            kind: 'judgment',
            finding: null,
            status: 'open',
            at: '2026-06-30T12:30:00Z'
          }
        ]
      }
    ]
  })

  // bravo: feedback ENABLED file-mode (the sanctioned inbox/outbox write paths).
  seedProject(bravo, {
    config: { feedback: { enabled: true, mode: 'file' } },
    lastAction: 'doc-sync complete; awaiting human review',
    features: [
      {
        slug: BRAVO_REVIEW_FEATURE,
        phase: 'doc-sync',
        // all 7 autonomous gates passed, human-review absent -> awaiting-human (gate-based, REQ-005).
        gates: gatesFor(
          ['brainstorm', 'spec', 'plan', 'tests', 'implement', 'review', 'doc-sync'],
          '2026-06-29T08:00:00Z'
        )
      },
      {
        slug: BRAVO_ESC_FEATURE,
        phase: 'implement',
        gates: gatesFor(['brainstorm', 'spec', 'plan', 'tests'], '2026-06-29T06:00:00Z'),
        escalations: [
          {
            id: BRAVO_ESCALATION_ID,
            phase: 'implement',
            reason: 'API contract ambiguity: pick a pagination scheme',
            kind: 'judgment',
            finding: null,
            status: 'open',
            at: '2026-06-29T07:00:00Z'
          }
        ]
      }
    ]
  })

  // charlie: mid-pipeline, nothing needs a human -> idle, never queued.
  seedProject(charlie, {
    config: {},
    lastAction: 'idle between runs',
    features: [
      {
        slug: CHARLIE_FEATURE,
        phase: 'plan',
        gates: gatesFor(['brainstorm', 'spec'], '2026-06-28T09:00:00Z')
      }
    ]
  })

  const bravoNestedCwd = join(bravo, 'src', 'app', 'components')
  const charlieNestedCwd = join(charlie, 'src')
  mkdirSync(bravoNestedCwd, { recursive: true })
  mkdirSync(charlieNestedCwd, { recursive: true })

  return {
    base,
    alpha,
    bravo,
    charlie,
    alphaFeatureDir: join(alpha, '.orky', 'features', ALPHA_FEATURE),
    bravoReviewFeatureDir: join(bravo, '.orky', 'features', BRAVO_REVIEW_FEATURE),
    bravoEscFeatureDir: join(bravo, '.orky', 'features', BRAVO_ESC_FEATURE),
    bravoNestedCwd,
    charlieNestedCwd,
    dispose: () => rmSync(base, { recursive: true, force: true })
  }
}

// ── Read/write-boundary tree hashing ──────────────────────────────────────────────────────────────

/** Content-hash every file under `dir` (recursive): relPath (forward slashes) -> sha256(content).
 *  Content hashes (not mtimes) so watcher/read-induced atime churn can never false-positive. */
export function hashTree(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string, rel: string): void => {
    for (const entry of readdirSync(d).sort()) {
      const abs = join(d, entry)
      const r = rel ? `${rel}/${entry}` : entry
      if (statSync(abs).isDirectory()) walk(abs, r)
      else out.set(r, createHash('sha256').update(readFileSync(abs)).digest('hex'))
    }
  }
  walk(dir, '')
  return out
}

export interface TreeDiff { added: string[]; removed: string[]; changed: string[] }

export function diffTrees(before: Map<string, string>, after: Map<string, string>): TreeDiff {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const [path, hash] of after) {
    if (!before.has(path)) added.push(path)
    else if (before.get(path) !== hash) changed.push(path)
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push(path)
  }
  added.sort(); removed.sort(); changed.sort()
  return { added, removed, changed }
}

// ── Async polling helper (watcher-settling waits) ─────────────────────────────────────────────────

/** Poll `probe` until it returns a truthy value; reject with `label` after `timeoutMs`. */
export async function waitFor<T>(
  probe: () => T | null | undefined | false,
  label: string,
  timeoutMs = 10_000,
  intervalMs = 100
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = probe()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`waitFor timed out (${timeoutMs}ms): ${label}`)
    await new Promise<void>(r => setTimeout(r, intervalMs))
  }
}
