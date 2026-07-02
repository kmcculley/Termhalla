// FROZEN structural suite — feature 0006-decision-queue-panel (phase 4).
// The vitest harness is node-env with no jsdom (vitest.config.ts: environment 'node', include
// tests/**/*.test.ts), so DecisionQueuePanel's DOM contract is pinned the way this repo pins other
// renderer chrome (03-plan.md "Testability constraint" / 0004 precedent): source-scan tests over the
// component's own literal, greppable source text — testids, aria attributes, theme variables, the
// exact shared-selector call sites — plus repo-level scope greps. The full rendered behavior is
// asserted end-to-end in tests/e2e/decision-queue.spec.ts.
// Runs RED: src/renderer/components/DecisionQueuePanel.tsx and src/shared/decision-queue.ts do not
// exist yet (every read here requires them).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCHEMA_VERSION } from '@shared/types'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const panel = () => read('src/renderer/components/DecisionQueuePanel.tsx')

describe('DecisionQueuePanel — drawer, not a pane kind (REQ-001)', () => {
  it('TEST-344 REQ-001 REQ-017 the panel testid exists; no PaneKind/PaneConfig variant is added; SCHEMA_VERSION is unchanged', () => {
    expect(panel()).toContain('data-testid="decision-queue-panel"')
    // NOT a workspace-mosaic pane kind: the pane machinery never learns about the queue.
    expect(read('src/renderer/store/pane-ops.ts')).not.toMatch(/decision-?queue/i)
    expect(read('src/renderer/components/WorkspaceView.tsx')).not.toContain('DecisionQueuePanel')
    expect(read('src/renderer/components/PaneTile.tsx')).not.toContain('DecisionQueuePanel')
    // The persisted model is untouched: same three pane kinds, same schema version.
    expect(read('src/shared/types.ts')).toMatch(/export type PaneConfig = TerminalConfig \| EditorConfig \| ExplorerConfig/)
    expect(SCHEMA_VERSION).toBe(7)
  })
})

describe('DecisionQueuePanel — explicit loading / empty / error states (REQ-011/REQ-012/REQ-013)', () => {
  it('TEST-345 REQ-011 REQ-012 REQ-013 all three state testids exist; empty copy is healthy; the error renders the store\'s specific message', () => {
    const src = panel()
    expect(src).toContain('decision-queue-loading')
    expect(src).toContain('decision-queue-empty')
    expect(src).toContain('decision-queue-error')
    // The empty state is "nothing needs you" — a healthy state, not failure wording (REQ-012).
    expect(src).toMatch(/nothing needs you/i)
    // The error state surfaces the slice's SPECIFIC registryError text (CONV-001), not a bare literal.
    expect(src).toContain('registryError')
  })
})

describe('DecisionQueuePanel — group/item identity contract (REQ-005/REQ-015)', () => {
  it('TEST-346 REQ-005 REQ-015 groups carry the templated testid + data-project-root; items carry decision-queue-item + the (root, feature) identity', () => {
    const src = panel()
    expect(src).toContain('decision-queue-group-')     // template: decision-queue-group-<root>
    expect(src).toContain('decision-queue-item')
    expect(src).toContain('data-project-root')
    expect(src).toContain('data-feature')
  })

  it('TEST-347 REQ-015 rows render the CARRIED fields (detail/reason/phase/gateN/gateM) verbatim — no gate recomputation, no literal "null" phase', () => {
    const src = panel()
    for (const field of ['detail', 'reason', 'gateN', 'gateM', 'phase']) expect(src).toContain(field)
    // A null phase must not render the string "null" — the codebase's `phase ?? …` guard (FINDING-DA-007).
    expect(src).toMatch(/phase\s*\?\?/)
    // No re-derivation of status semantics: neither the panel nor the pure queue module imports or
    // re-implements the 0004 gate/escalation/stall machinery (REQ-004's code assertion rides here too).
    const dq = read('src/shared/decision-queue.ts')
    for (const banned of ['gateFrontier', 'openBlockingCount', 'isStalled', 'ORKY_AUTONOMOUS_PHASES', 'inPopover', 'orkyFeatureStatus(']) {
      expect(src, `panel must not reference ${banned}`).not.toContain(banned)
      expect(dq, `decision-queue.ts must not reference ${banned}`).not.toContain(banned)
    }
  })
})

describe('DecisionQueuePanel — accessibility + notes-drawer coexistence (REQ-014)', () => {
  it('TEST-348 REQ-014 landmark role + label + keyboard-operable close; the panel never reads or writes notesOpen', () => {
    const src = panel()
    expect(src).toContain('role="complementary"')
    expect(src).toContain('aria-label')
    expect(src).toMatch(/close/i)
    expect(src).toContain('setQueueOpen(false)')
    // Coexistence by construction: toggling the queue cannot change the notes drawer (no cross-slice write).
    expect(src).not.toContain('notesOpen')
    expect(src).not.toContain('setNotesOpen')
  })

  it('TEST-349 REQ-014 the queue chrome carries VISIBLE :focus-visible styling (CONV-007 allow-list rule), never outline: none', () => {
    const css = read('src/renderer/index.css')
    const focusBlocks = css.split('}').filter(b => b.includes(':focus-visible') && b.includes('decision-queue'))
    expect(focusBlocks.length, 'a :focus-visible rule (allow-list extension or dedicated) must cover the decision-queue chrome').toBeGreaterThan(0)
    for (const block of focusBlocks) {
      expect(block).toMatch(/outline/)
      expect(block).not.toMatch(/outline:\s*none/)
    }
  })
})

describe('DecisionQueuePanel — theme-aware presentation (REQ-016)', () => {
  it('TEST-350 REQ-016 styling uses the theme variable family; any hex literal appears only as a var() fallback', () => {
    const src = panel()
    expect(src).toContain('var(--panel')
    expect(src).toContain('var(--fg-dim')
    expect(src).toContain('var(--border')
    // Strip the sanctioned `var(--x, #hex)` fallback form, then no raw hex color may remain.
    const stripped = src.replace(/var\(--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}\)/g, '')
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('DecisionQueuePanel — pane-less "open terminal here" fallback (REQ-010)', () => {
  it('TEST-351 REQ-010 the fallback affordance exists with its root identity and reuses the existing pane-spawn path (no deep-link)', () => {
    const src = panel()
    expect(src).toContain('decision-queue-open-terminal')
    expect(src).toContain('data-project-root')
    // Reuses the launchDir-equivalent commitPane spawn — no new capability (Resolved spec-time decision #4).
    expect(src).toMatch(/launchDir|commitPane/)
    // Read-only w.r.t. Orky: no editor/file deep-link into .orky trees (D4 — no F6 deep-linking).
    expect(src).not.toContain('openFileInEditor')
  })
})

describe('fold-mode call path — the test-green/runtime-broken trap (REQ-009 / FINDING-003)', () => {
  it('TEST-352 REQ-009 no `process` reference in the matcher module or its renderer call path; the fold mode comes from navigator.platform', () => {
    const dq = read('src/shared/decision-queue.ts')
    const src = panel()
    // `process` is undefined in the contextIsolated renderer main world (though defined under vitest).
    expect(dq).not.toMatch(/\bprocess\s*[.[]/)
    expect(src).not.toMatch(/\bprocess\s*[.[]/)
    // The ONE sanctioned platform signal: a pure derivation over navigator.platform.
    expect(src).toContain('caseFoldFromPlatform(navigator.platform)')
    // The pure module stays pure: no node builtins, no Electron, no ../api.
    expect(dq).not.toMatch(/from 'node:/)
    expect(dq).not.toMatch(/require\(/)
    expect(dq).not.toMatch(/from ['"]electron/)
    expect(dq).not.toMatch(/\.\.\/api/)
  })
})

describe('scope guard — strictly read-only, chrome-only, nothing persisted (REQ-017/REQ-003)', () => {
  it('TEST-353 REQ-017 REQ-003 the feature\'s own files exist and contain no mutation call, no CLI, no child_process, no persistence hook', () => {
    const files = [
      'src/shared/decision-queue.ts',
      'src/renderer/store/registry-slice.ts',
      'src/renderer/components/DecisionQueuePanel.tsx'
    ]
    const sources = files.map(f => ({ f, src: read(f) }))   // throws (RED) until all three exist
    for (const { f, src } of sources) {
      for (const banned of ['registryAddRoot', 'registryRemoveRoot', 'registryRoots(', 'orkyAction', 'child_process', 'execFile']) {
        expect(src, `${f} must not reference ${banned}`).not.toContain(banned)
      }
    }
    // Nothing persisted: neither the slice nor the panel schedules any save (session-scoped only).
    for (const f of ['src/renderer/store/registry-slice.ts', 'src/renderer/components/DecisionQueuePanel.tsx']) {
      expect(read(f), `${f} must not persist`).not.toContain('scheduleQuickSave')
      expect(read(f), `${f} must not persist`).not.toContain('scheduleAutosave')
    }
  })
})
