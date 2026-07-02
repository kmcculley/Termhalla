// FROZEN loopback suite — feature 0009-native-orky-pane (phase 4, ESC-001 tests loopback).
// Pins the AMENDED display/interaction contracts (spec amended 2026-07-02):
//   REQ-009 — the gates display set is EXHAUSTIVE per gate (the per-gate `at` must be exposed) and
//             the header carries the payload's stall wording (FINDING-024);
//   REQ-012/REQ-007 — rows, disclosure state and data-feature key on the payload's UNIQUE dir slug,
//             never the collidable status.feature (FINDING-021);
//   REQ-010/REQ-009 — the rendered payload is gated on binding identity (FINDING-029's root guard);
//   REQ-004 (decision #4c) — the compass's disabled orky button distinguishes loading from
//             genuinely-empty in its accessible name (FINDING-027);
//   REQ-004/REQ-018 — the picker's container-level key handler target-guards activation keys so
//             Enter on a Tab-focused nested control activates THAT control (FINDING-023).
//
// Node-env harness (no jsdom): pinned the repo's established source-scan way over LITERAL greppable
// source text; the rendered keyboard behavior is additionally pinned end-to-end in
// tests/e2e/orky-pane.spec.ts (TEST-464/465).
//
// Runs RED today (2026-07-02, against the shipped F9 implementation): OrkyPane never references
// the gate's carried `at`, never renders stall wording in the header, keys rows/disclosure on
// status.feature, and never root-guards the held payload; SplitMenu folds loading into the empty
// accessible name; OrkyRootPicker's Enter branch is not target-guarded.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const pane = () => read('src/renderer/components/OrkyPane.tsx')
const picker = () => read('src/renderer/components/OrkyRootPicker.tsx')

describe('gates display set is exhaustive; header carries the stall wording (REQ-009 / FINDING-024)', () => {
  it('TEST-451 REQ-009 an expanded feature\'s gate records expose the carried `at` — the component consumes the OrkyGateDetail.at epoch (formatted main-side or via a pure formatter, never a renderer clock)', () => {
    const src = pane()
    // The MUST-listed per-gate display set is pass/fail/unrecorded + `at` + external marker.
    // The shipped component renders 2-of-3 and never references the carried `.at` field.
    expect(src, 'the gate rendering must consume the carried at (OrkyGateDetail.at)').toMatch(/\.at\b/)
    // the renderer-clock ban stays in force (TEST-430 pins no Date.now()/new Date( in this file);
    // re-asserted here so this test is self-contained about HOW `at` may be exposed
    expect(src).not.toMatch(/Date\.now\(|new Date\(/)
  })

  it('TEST-452 REQ-009 the header renders the payload\'s carried stall wording when the comparator-top feature\'s reason is stalled — a stalled project\'s header must be distinguishable from an awaiting-review one', () => {
    const src = pane()
    // The header today renders only needs-you/failed accents; the carried stall wording
    // (reason 'stalled' / detail 'slug: stalled Xm — no heartbeat') never reaches it, so the
    // component cannot contain the carried-reason discrimination the amended REQ-009 pins.
    expect(src, 'the header must surface the carried stall wording (reason/detail verbatim) for a stalled comparator-top feature').toMatch(/'stalled'|"stalled"/)
  })
})

describe('per-feature identity keys on the UNIQUE dir slug (REQ-012 / REQ-007 / FINDING-021)', () => {
  it('TEST-453 REQ-012 REQ-009 rows, React keys, disclosure state and data-feature all key on the payload slug — never on the collidable status.feature', () => {
    const src = pane()
    // the payload's slug field is consumed at all…
    expect(src, 'the component must consume the payload\'s unique dir slug').toMatch(/\.slug\b/)
    // …and the collidable feature field no longer keys identity, render keys, or disclosure:
    // a copied feature dir (same `feature` value) must never produce duplicate React keys, a
    // shared disclosure entry, or duplicate data-feature identities (REQ-012's F10 contract).
    expect(src, 'data-feature must be the slug, not status.feature').not.toMatch(/data-feature=\{s\.feature\}/)
    expect(src, 'the row render key must be the slug, not status.feature').not.toMatch(/key=\{s\.feature\}/)
    expect(src, 'disclosure state must not be keyed on status.feature').not.toMatch(/\[s\.feature\]/)
  })
})

describe('the rendered payload is gated on binding identity (REQ-010 / REQ-009 / FINDING-029)', () => {
  it('TEST-454 REQ-010 REQ-009 the held detail renders ONLY when its carried root sameProjectRoot-matches the pane\'s binding — the payload carries its root precisely for this guard', () => {
    const src = pane()
    // the shipped component derives okDetail from detailEntry.detail with NO root guard, so a
    // re-bound pane renders the PREVIOUS root's rows under the new root's identity until (and
    // indefinitely after a failed) settle. The guard needs a second sameProjectRoot call site
    // (the first matches the aggregate entry) applied to the held payload's own root.
    const guardSites = src.match(/sameProjectRoot\(/g) ?? []
    expect(guardSites.length, 'a binding-identity guard on the held payload is required alongside the membership match').toBeGreaterThanOrEqual(2)
    expect(src, 'the guard must read the held payload\'s carried root').toMatch(/(okDetail|detail)\.root/)
  })
})

describe('compass disabled-name distinguishes loading from empty (REQ-004 decision #4c / FINDING-027)', () => {
  it('TEST-455 REQ-004 SplitMenu\'s orky kind button carries TWO distinct explanatory names: loading wording while the snapshot has not settled (registrySnapshot === null && no error), the genuinely-empty wording only for a held []', () => {
    const src = read('src/renderer/components/SplitMenu.tsx')
    // the derived-loading rule must be distinguished — the shipped code folds null and [] together
    // (registrySnapshot?.length), telling a user WITH tracked projects that none exist at startup
    expect(src, 'the loading state must key on the slice\'s derived rule (registrySnapshot === null)').toMatch(/registrySnapshot\s*===\s*null/)
    expect(src, 'a loading-class accessible name must exist ("tracked projects loading…" wording)').toMatch(/load|wait/i)
    // the genuinely-empty wording survives, scoped to a HELD empty snapshot
    expect(src).toMatch(/no tracked Orky project yet/)
  })
})

describe('picker container-level key handling is target-guarded (REQ-004 / REQ-018 / FINDING-023)', () => {
  it('TEST-456 REQ-004 REQ-018 the dialog-level Enter/Arrow branches act only when the listbox itself holds focus — Enter on a Tab-focused nested control (Cancel, an option button) is never swallowed or redirected', () => {
    const src = picker()
    // REQ-018: "any row-level key handling MUST target-guard so nested controls' keys are never
    // swallowed". The shipped handler preventDefaults Enter from ANY nested control and commits
    // memberRoots[sel] — Enter on the Cancel button commits a pane. The guard must consult the
    // event target before the selection keys (Escape stays dialog-wide).
    expect(src, 'the activation-key branches must be guarded on the event target').toMatch(/e\.target/)
    expect(src).toContain('Escape') // cancel remains dialog-wide
  })
})
