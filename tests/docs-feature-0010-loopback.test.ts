// FROZEN doc-pin suite — feature 0010-orky-pane-inline-actions, ESC-001 tests LOOPBACK
// (review → tests, 2026-07-02).
//
//   TEST-644 (FINDING-015, REQ-009) — CONV-008 residue INSIDE the REQ-009 pattern-(2) sweep's own
//     scope: two claims about the decision-queue DRAWER that F8's composition falsified (and that
//     F10's own CHANGELOG entry now directly contradicts) escaped the sweep as "F6-scoped prose":
//     CLAUDE.md's drawer row still says `read-only "what needs me now" queue`, and
//     docs/features/decision-queue.md still opens a bullet `**Read-only, chrome-only.** The
//     feature never writes … never invokes an Orky CLI or orkyAction:* method` — but the drawer
//     rows have mounted the write-capable OrkyEntryActions region since F8. Both are corrected
//     the same way the orky-pane row/header were: the surface COMPOSES the shared write-capable
//     region while F6's own files still own no dispatch of their own. NOTE for the implementer:
//     docs-feature-0006.test.ts:29 requires /read-only|read only/ to survive SOMEWHERE in
//     decision-queue.md — keep a true read-only phrase (e.g. the read-only next-action preview).
//   TEST-645 (FINDING-012, REQ-009) — the REQ-009 inventory acceptance ("exactly the 14 files …
//     and no other") was mechanically unsatisfiable once the tests phase landed: the feature's
//     OWN suites unavoidably contain the surface literals they pin. This test makes the corrected
//     inventory MECHANICAL: the stated (narrowed, CONV-037-keyed) pattern over tests/** must hit
//     exactly the enumerated, dispositioned set — the 14 pre-existing files the frozen spec
//     dispositions, the 4 suites F10's phase 4 added, and the 4 pattern-hit files this ESC-001
//     loopback added (each named in 04-tests.md). A NEW hit file is a NEW, un-dispositioned frozen
//     guard: stop and disposition it (the spec's own rule), then extend this list in the same
//     change.
//
// TEST-644 runs RED today (both stale claims verified present, 2026-07-02); TEST-645 is the
// corrected-count pin (GREEN against the loopback tree by construction — its value is failing on
// the NEXT un-dispositioned hit).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('FINDING-015 — the decision-queue drawer docs stop claiming strict read-only (REQ-009 / CONV-008 pattern-2)', () => {
  it('TEST-644 REQ-009 (FINDING-015) CLAUDE.md\'s drawer row and docs/features/decision-queue.md describe the COMPOSED write surface: the drawer mounts F8\'s write-capable OrkyEntryActions region (F6\'s own files still own no dispatch) — neither claims a read-only/never-invokes-CLI drawer any more', () => {
    // ── CLAUDE.md "Where things live": the drawer row must no longer be a "read-only … queue"
    const claude = read('CLAUDE.md')
    const rowAt = claude.indexOf('decision-queue drawer')
    expect(rowAt, 'the drawer row must exist in CLAUDE.md').toBeGreaterThanOrEqual(0)
    const row = claude.slice(claude.lastIndexOf('\n', rowAt) + 1, claude.indexOf('\n', rowAt))
    expect(row, 'the drawer row must not call the drawer read-only — its rows compose the write-capable F8 actions region')
      .not.toMatch(/read-?only/i)
    expect(row, 'the drawer row must name the composed write capability (the shared/entry-actions region, write-capable via F7)')
      .toMatch(/OrkyEntryActions|entry-actions|write-capable|composes/i)

    // ── docs/features/decision-queue.md: the blanket read-only bullet is corrected
    const doc = read('docs/features/decision-queue.md')
    expect(doc, 'the "Read-only, chrome-only" blanket bullet must be re-expressed to the composed scope')
      .not.toMatch(/read-?only, chrome-?only/i)
    expect(doc, 'the blanket "never invokes an Orky CLI or orkyAction" claim is false since F8 — scope it to F6\'s OWN files')
      .not.toMatch(/feature never writes under any [^\n]*never invokes an Orky/i)
    expect(doc, 'the doc must name the composed write-capable region (OrkyEntryActions / the shared F8 action layer)')
      .toMatch(/OrkyEntryActions|entry-actions/i)
  })
})

describe('FINDING-012 — the REQ-009 frozen-guard inventory is mechanical (REQ-009)', () => {
  it('TEST-645 REQ-009 (FINDING-012) the stated CONV-037-keyed pattern over tests/** hits EXACTLY the dispositioned set: 14 pre-existing (the frozen spec\'s list) + 4 F10 phase-4 suites + 4 ESC-001-loopback files — a new hit is a new, un-dispositioned frozen guard: stop, disposition it (04-tests.md), and extend this list atomically', () => {
    // the REQ-009 stated pattern (narrowed per FINDING-005 to the F9/F10 surface literals)
    const pattern = /orky-pane-row-actions|OrkyEntryActions|openOrkyCapture|orky-entry-actions|F10/i

    const testsRoot = resolve(process.cwd(), 'tests')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const p = join(dir, name)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
    const hits = walk(testsRoot)
      .filter(p => /\.(test|spec)\.ts$/.test(p) || p.endsWith('.ts'))
      .filter(p => pattern.test(readFileSync(p, 'utf8')))
      .map(p => relative(testsRoot, p).replace(/\\/g, '/'))
      .sort()

    const dispositioned = [
      // ── the 14 pre-existing files the frozen spec REQ-009 dispositions by name
      'docs-feature-0008.test.ts',
      'docs-feature-0012.test.ts',
      'e2e/orky-pane.spec.ts',
      'e2e/orky-queue-actions.spec.ts',
      'renderer/decision-queue-panel-structure.test.ts',
      'renderer/orky-capture-slice.test.ts',
      'renderer/orky-capture-structure.test.ts',
      'renderer/orky-entry-actions-core.test.ts',
      'renderer/orky-entry-actions-loopback.test.ts',
      'renderer/orky-entry-actions-structure.test.ts',
      'renderer/orky-pane-display-contract.test.ts',
      'renderer/orky-pane-structure.test.ts',
      'shared/keybindings-capture-orky-work.test.ts',
      'shared/orky-action-validate-projectroot-flaglike.test.ts',
      // ── the 4 suites F10's own phase 4 added (self-hits — FINDING-012's correction)
      'docs-feature-0010.test.ts',
      'e2e/orky-pane-actions.spec.ts',
      'renderer/orky-entry-actions-modeflip.test.ts',
      'renderer/orky-pane-actions-structure.test.ts',
      // ── the 4 ESC-001-loopback files (each dispositioned in 04-tests.md; the FINDING-016
      //    amendment to e2e/orky-queue-actions-loopback.spec.ts deliberately contains NO pattern
      //    token — it stays a non-hit, exactly like the pre-existing file it amends)
      'docs-feature-0010-loopback.test.ts',
      'e2e/orky-pane-actions-loopback.spec.ts',
      'renderer/orky-entry-actions-modeflip-loopback.test.ts',
      'renderer/orky-pane-actions-loopback.test.ts',
      // ── the 1 app-level INTEGRATION file (dispositioned per this test's own rule — the
      //    read→decide→act e2e suite REALLY drives orky-entry-actions-core (bind/verify/build/
      //    settle) through F7 against the real CLIs, so the pattern hit is the point, not an
      //    un-dispositioned frozen guard; see tests/integration/README.md)
      'integration/orky-act-loop.test.ts'
    ].sort()

    expect(hits).toEqual(dispositioned)
  })
})
