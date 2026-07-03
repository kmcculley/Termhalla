// FROZEN structural suite — feature 0009-native-orky-pane (phase 4 / TASK-009 + TASK-012…TASK-017).
// The vitest harness is node-env with no jsdom (vitest.config.ts), so the OrkyPane / OrkyRootPicker
// DOM contract is pinned the repo's established way (0004/0006 precedent; 03-plan.md "Testability
// constraint"): source-scan tests over LITERAL, greppable source text — testids, aria attributes,
// theme variables, shared-import call sites — plus repo-level scope greps. Full rendered behavior
// is asserted end-to-end in tests/e2e/orky-pane.spec.ts.
//
// Runs RED today: src/renderer/components/OrkyPane.tsx, OrkyRootPicker.tsx,
// src/renderer/store/orky-pane-slice.ts and src/shared/orky-pane.ts do not exist yet.
//
// [AMENDED at feature 0010-orky-pane-inline-actions' tests phase, 2026-07-02 — CONV-019
// supersession, per 0010 REQ-009/TASK-005 (the TEST-353 precedent)]: TEST-433's describe-level
// READ-ONLY intent is superseded (see its supersession note below) and TEST-429's slot comment is
// updated to name F10's population. EVERY assertion in this file is byte-unchanged.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const pane = () => read('src/renderer/components/OrkyPane.tsx')
const picker = () => read('src/renderer/components/OrkyRootPicker.tsx')

// The feature's own renderer/main files (the REQ-013 scope-guard sweep set).
const F9_FILES = [
  'src/shared/orky-pane.ts',
  'src/renderer/components/OrkyPane.tsx',
  'src/renderer/components/OrkyRootPicker.tsx',
  'src/renderer/store/orky-pane-slice.ts',
  'src/main/orky/orky-root-detail.ts'
]

describe('OrkyPane — explicit pane states (REQ-009 / REQ-011)', () => {
  it('TEST-428 REQ-009 REQ-011 all five state testids exist; the pane body carries data-root; unbound copy names the persisted root with a native re-bind button; unreadable wording is distinct from unbound', () => {
    const src = pane()
    expect(src).toContain('data-testid="orky-pane"')
    expect(src).toContain('data-root')
    expect(src).toContain('orky-pane-loading')
    expect(src).toContain('orky-pane-unbound')
    expect(src).toContain('orky-pane-unreadable')
    expect(src).toContain('orky-pane-error')
    // the resolved spec-time unbound copy (decision #6): names the root, offers the two ways forward
    expect(src).toMatch(/not currently tracked/i)
    expect(src).toMatch(/bind this pane to another tracked project/i)
    // re-bind is a REAL native button opening the SAME picker as creation
    expect(src).toMatch(/<button[^<]*data-testid="orky-pane-rebind"|data-testid="orky-pane-rebind"[^<]*<\/button>|<button[^>]*data-testid="orky-pane-rebind"/)
    expect(src).toContain('OrkyRootPicker')
    // unreadable is a DIFFERENT message (the root is still tracked; .orky/ is missing/unreadable)
    expect(src).toMatch(/missing or unreadable|\.orky/)
  })

  it('TEST-429 REQ-009 REQ-012 row identity + reserved actions slot + gate/finding/escalation structure — the exact (projectRoot, feature) identity F10 attaches to', () => {
    const src = pane()
    expect(src).toContain('orky-pane-feature')            // feature rows
    expect(src).toContain('data-project-root')
    expect(src).toContain('data-feature')
    expect(src).toContain('orky-pane-feature-unreadable') // a skipped slug NEVER vanishes (FINDING-004)
    expect(src).toContain('orky-pane-row-actions')        // the reserved trailing slot (D4) — POPULATED by feature 0010's OrkyEntryActions mount
    expect(src).toContain('orky-pane-gates')
    expect(src).toContain('orky-pane-finding')
    expect(src).toContain('data-finding-id')
    expect(src).toContain('orky-pane-escalation')
    expect(src).toContain('data-escalation-id')           // F7's resolveEscalation identity
    expect(src).toContain('findingsUnreadable')           // the findings-unreadable note renders from the carried flag
  })
})

describe('no renderer clock, no timer, carried fields verbatim (REQ-007 / REQ-009 / REQ-010 / REQ-015)', () => {
  it('TEST-430 REQ-007 REQ-009 REQ-010 the component and slice never read a clock or poll: no Date.now()/new Date(/setInterval; a null LIVE phase renders via the ?? convention, never the literal "null"', () => {
    for (const rel of ['src/renderer/components/OrkyPane.tsx', 'src/renderer/store/orky-pane-slice.ts']) {
      const src = read(rel)
      expect(src, `${rel} must not read a clock`).not.toMatch(/Date\.now\(|new Date\(/)
      expect(src, `${rel} must not poll`).not.toMatch(/setInterval/)
    }
    expect(pane()).toMatch(/phase\s*\?\?/) // the established `phase ?? 'done'` guard
  })

  it('TEST-431 REQ-015 REQ-014 no status re-derivation in the RENDERER: the banned 0004 machinery never appears; compareOrkyFeatures is IMPORTED (single definition); no localeCompare in any ordering path', () => {
    const srcs = [
      ['src/renderer/components/OrkyPane.tsx', pane()],
      ['src/renderer/components/OrkyRootPicker.tsx', picker()],
      ['src/renderer/store/orky-pane-slice.ts', read('src/renderer/store/orky-pane-slice.ts')]
    ] as const
    for (const [rel, src] of srcs) {
      for (const banned of ['gateFrontier', 'isStalled', 'openBlockingCount', 'isBlockingFinding', 'ORKY_AUTONOMOUS_PHASES', 'inPopover', 'orkyFeatureStatus(']) {
        expect(src, `${rel} must not reference ${banned}`).not.toContain(banned)
      }
      expect(src, `${rel} must not localeCompare`).not.toContain('localeCompare')
    }
    // display order comes from the ONE shared comparator — imported, never redefined
    const p = pane()
    expect(p).toMatch(/import\s*(type\s*)?\{[^}]*compareOrkyFeatures[^}]*\}\s*from\s*'@shared\/orky-status'/)
    expect(p).not.toMatch(/function compareOrkyFeatures|const compareOrkyFeatures\s*=/)
  })
})

describe('fold-mode call path — the test-green/runtime-broken trap (REQ-005 / FINDING-003)', () => {
  it('TEST-432 REQ-005 the fold mode is derived ONCE from navigator.platform and injected; no `process` read anywhere on the F9 renderer path', () => {
    // the ONE sanctioned platform signal, at the composition/caller layer
    const callers = ['src/renderer/components/OrkyPane.tsx', 'src/renderer/store.ts', 'src/renderer/App.tsx']
      .map(rel => read(rel)).join('\n')
    expect(callers).toContain('caseFoldFromPlatform(navigator.platform)')
    // the pure module + component + slice never read `process` (undefined in the contextIsolated main world)
    for (const rel of ['src/shared/orky-pane.ts', 'src/renderer/components/OrkyPane.tsx', 'src/renderer/components/OrkyRootPicker.tsx', 'src/renderer/store/orky-pane-slice.ts']) {
      expect(read(rel), `${rel} must not read process`).not.toMatch(/\bprocess\s*[.[]/)
    }
  })
})

describe('scope guard — the F9 files own no raw CLI/mutation/dispatch call; the READ-ONLY intent is SUPERSEDED by feature 0010 (REQ-013; CONV-019)', () => {
  // SUPERSESSION NOTE (CONV-019 — a recorded retirement, executed by feature
  // 0010-orky-pane-inline-actions' TEST-DESIGNER at ITS tests phase, per 0010 REQ-009/TASK-005 —
  // the TEST-353 precedent, honoring the named handoff in orky-capture-structure.test.ts:264-265:
  // "its eventual supersession belongs to F10, not F12"):
  //   F9 shipped OrkyPane STRICTLY read-only and this guard's describe originally pinned that
  //   intent over every F9 file. Feature 0010 is the DESIGNED write-capable composition: OrkyPane
  //   now composes the shared <OrkyEntryActions> region (whose api.orky* dispatch lives in
  //   orky-entry-actions.tsx — never here) and F12's rooted capture opener openOrkyCapture(root).
  //   Still-true intent, re-expressed:
  //     - every F9 file below keeps EVERY original banned literal BYTE-UNCHANGED (neither
  //       OrkyEntryActions, orky-entry-actions, nor openOrkyCapture contains a banned substring —
  //       verified in 0010's spec): no registry-mutation surface, no orkyAction, no
  //       CLI/child_process, no pane-scoped orky watch — no raw write call OF ITS OWN;
  //     - nothing bypasses the existing persistence paths (the save-scheduling ban stays);
  //     - OrkyPane's composed write discipline (mount, id sourcing, inject, gesture-tying) is
  //       pinned by 0010's own suite, tests/renderer/orky-pane-actions-structure.test.ts
  //       (TEST-624…TEST-629).
  //   Every assertion below is byte-unchanged; only this describe/comment header was re-expressed.
  it('TEST-433 REQ-013 no F9 file references the registry mutation surface, orkyAction, a CLI/child_process, or a pane-scoped orky watch — and the slice/component persist nothing directly', () => {
    for (const rel of F9_FILES) {
      const src = read(rel) // throws (RED) until every F9 file exists
      for (const banned of ['registryAddRoot', 'registryRemoveRoot', 'registryRoots(', 'RegistryMutationResult', 'orkyAction', 'child_process', 'execFile', 'orkyWatch', 'orkyUnwatch']) {
        expect(src, `${rel} must not reference ${banned}`).not.toContain(banned)
      }
    }
    // nothing bypasses the existing persistence paths: the binding persists ONLY via
    // updatePaneConfig/commitPane's own autosave — no direct save scheduling in the F9 chrome
    for (const rel of ['src/renderer/components/OrkyPane.tsx', 'src/renderer/components/OrkyRootPicker.tsx']) {
      expect(read(rel), `${rel} must not schedule saves directly`).not.toMatch(/scheduleQuickSave|scheduleNotesSave/)
    }
  })
})

describe('OrkyRootPicker — four mutually-distinct states (REQ-004 / FINDING-009)', () => {
  it('TEST-434 REQ-004 the picker carries all four state testids, surfaces the held registryError verbatim, renders ACTIONABLE empty copy, handles Escape, and never calls the persisted-list pull', () => {
    const src = picker()
    expect(src).toContain('data-testid="orky-root-picker"')
    expect(src).toContain('orky-root-picker-loading')     // registrySnapshot === null && registryError === null
    expect(src).toContain('orky-root-picker-error')
    expect(src).toContain('orky-root-picker-empty')       // ONLY for a genuinely-held [] snapshot
    expect(src).toContain('registryError')                // the slice's SPECIFIC error text (CONV-001)
    expect(src).toContain('registrySnapshot')             // the ALREADY-subscribed F5 read surface
    expect(src).toMatch(/track/i)                         // empty copy says HOW roots become tracked
    expect(src).toContain('Escape')                       // cancel commits nothing
    expect(src).not.toContain('registryRoots(')           // persisted-only AND mutation-guard-forbidden
  })
})

describe('creation affordances — palette, add-pane select, split compass (REQ-004 / REQ-001)', () => {
  it('TEST-435 REQ-004 REQ-001 quick.ts offers new-orky, CommandPalette dispatches it, WorkspaceTabs offers the option, PaneKind + dispatchAddPane gain the orky branch', () => {
    const quick = read('src/shared/quick.ts')
    expect(quick).toContain("'new-orky'")
    expect(quick).toMatch(/New Orky pane/)
    expect(read('src/renderer/components/CommandPalette.tsx')).toContain("'new-orky'")
    expect(read('src/renderer/components/WorkspaceTabs.tsx')).toMatch(/<option value="orky"/)
    const ops = read('src/renderer/store/pane-ops.ts')
    expect(ops).toMatch(/export type PaneKind = [^\n]*'orky'/)
    expect(ops).toContain("'orky'") // the dispatchAddPane branch (behavior pinned in orky-pane-ops.test.ts)
  })

  it('TEST-436 REQ-004 the split compass gains the orky kind button (split-kind-orky-<paneId> via the existing kindButton template, aria-pressed parity) and routes through the same picker flow', () => {
    const src = read('src/renderer/components/SplitMenu.tsx')
    expect(src).toContain("kindButton('orky')")           // renders data-testid={`split-kind-orky-${paneId}`}
    expect(src).toMatch(/Kind = [^\n]*'orky'/)            // the Kind union gains 'orky'
    expect(src).toContain('aria-pressed')                 // parity with the existing three (pre-existing, kept)
    // disabled-without-a-member follows the explorer/cwd precedent: the disabled expression must
    // now consider the orky kind too (an explanatory accessible name rides KIND_LABEL/aria)
    expect(src).toMatch(/disabled=\{[^}]*orky|orky[^\n]*disabled/i)
  })

  it('TEST-437 REQ-001 the two kind-generic render switches mount OrkyPane (PaneTile visible, MinimizedPaneHost kept-mounted-but-hidden)', () => {
    expect(read('src/renderer/components/PaneTile.tsx')).toContain('OrkyPane')
    expect(read('src/renderer/components/MinimizedPaneHost.tsx')).toContain('OrkyPane')
  })
})

describe('accessibility + keyboard operability (REQ-018)', () => {
  it('TEST-438 REQ-018 labeled region, native-button disclosures with aria-expanded, NO role="button" wrapper, focusable scroll container, and :focus-visible coverage for the orky chrome', () => {
    const p = pane()
    expect(p).toContain('aria-label')                     // the region names the bound project
    expect(p).toContain('aria-expanded')                  // gates/findings/escalations disclosures
    expect(p).not.toContain('role="button"')              // Children-Presentational — the F6 FINDING-008 lesson
    expect(picker()).not.toContain('role="button"')
    expect(p).toContain('tabIndex={0}')                   // keyboard-scrollable container / reachable rows
    // CONV-007: visible focus for every focusable F9 surface — an orky-scoped :focus-visible rule exists
    const css = read('src/renderer/index.css')
    const blocks = css.split('}').filter(b => b.includes(':focus-visible') && /orky-(pane|root-picker)/.test(b))
    expect(blocks.length, 'a :focus-visible rule must cover the orky pane/picker chrome').toBeGreaterThan(0)
    for (const b of blocks) {
      expect(b).toMatch(/outline/)
      expect(b).not.toMatch(/outline:\s*none/)
    }
  })
})

describe('theme-aware presentation (REQ-019)', () => {
  it('TEST-439 REQ-019 pane + picker style via the theme variable family; raw hex appears only as var() fallbacks (the TEST-350 pattern)', () => {
    for (const [rel, src] of [['OrkyPane', pane()], ['OrkyRootPicker', picker()]] as const) {
      expect(src, `${rel} must use var(--panel`).toContain('var(--panel')
      expect(src, `${rel} must use var(--fg`).toContain('var(--fg')
      expect(src, `${rel} must use var(--border`).toContain('var(--border')
      const stripped = src.replace(/var\(--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}\)/g, '')
      expect(stripped, `${rel}: raw hex only as var() fallback`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })
})
