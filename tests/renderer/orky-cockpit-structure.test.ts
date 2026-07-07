// FROZEN structural suite — feature 0011-orky-workspace-template (phase 4 / TASK-003..010 —
// REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007).
//
// The vitest harness is node-env with no jsdom (vitest.config.ts) and e2e cannot spy the bundled
// api closure (the 0010 FINDING-002 determination), so — per CONV-033's sanctioned split — the
// wiring/discipline halves are pinned here as ANCHORED source scans (CONV-032: every scan is
// scoped to an extracted F11 region or keyed on an F11-specific symbol per CONV-037, never a
// whole-file bare literal that can collide with pre-F11 code such as store.ts's legitimate
// registryDetail composition at the orky-pane-slice injection). Rendered behavior lives in
// tests/e2e/orky-cockpit.spec.ts; store behavior in orky-cockpit-action.test.ts.
//
// Frozen pins this feature RELIES ON, required byte-unchanged (not re-pinned here):
//   TEST-461 tests/shared/orky-pane-template-coercion.test.ts:39 — the coerced seam itself
//            (REQ-002's coercion half: structural only-instantiation-is-the-seam pin + TEST-461).
//   TEST-420 tests/renderer/orky-pane-slice.test.ts:67 — exactly ONE detail request per bind
//            (REQ-005's count half).
//   TEST-619 (the F8 entry-actions loopback suite, lines 149-163 — cited by TEST id; the file
//            path is deliberately not spelled here so feature 0010's TEST-645 mechanical guard
//            inventory stays exact) — commitPane present in SliceDeps, absent from State
//            (REQ-007: the additive reportAssignment member must keep BOTH clauses green).
//
// Runs RED today (2026-07-02): src/shared/orky-cockpit.ts does not exist; store.ts has no
// newOrkyWorkspace; quick.ts has no 'new-orky-workspace'; no tpl-orky-cockpit row, no
// decision-queue-open-cockpit button, no F11 picker mount, and SliceDeps has no reportAssignment.
//
// AMENDED 2026-07-07 (quality audit Group C #8): the raw reportAssignment SliceDeps dep and the
// per-site set+autosave+report copies were superseded by the ONE shared registration ritual
// (store/workspace-registration.ts, threaded as SliceDeps.registerWorkspace). TEST-664/TEST-670
// now pin the same intent at that seam; the autosave+report-exactly-once ordering itself is pinned
// by tests/renderer/workspace-registration.test.ts and the amended TEST-663 harness.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { buildCommandItems, filterPaletteItems } from '../../src/shared/quick'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')

/** Anchored region extraction (CONV-032): from the marker to its brace-balanced close. */
function block(src: string, markerRe: RegExp, label: string): string {
  const at = src.search(markerRe)
  expect(at, `${label} must exist in the file`).toBeGreaterThanOrEqual(0)
  const open = src.indexOf('{', at)
  expect(open, `${label}: an opening brace must follow the marker`).toBeGreaterThan(at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1) }
  }
  return src.slice(at)
}

/** Anchored ± window around a literal (the repo's `around` pattern). */
function around(src: string, marker: string, before: number, after: number, label = marker): string {
  const at = src.indexOf(marker)
  expect(at, `${label} must exist`).toBeGreaterThanOrEqual(0)
  return src.slice(Math.max(0, at - before), Math.min(src.length, at + marker.length + after))
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

// The F11-specific surfaces every absence/scope guard below keys on (CONV-037; REQ-007 names them).
const F11_SYMBOLS = ['orkyCockpit', 'newOrkyWorkspace', 'new-orky-workspace', 'tpl-orky-cockpit', 'decision-queue-open-cockpit']

describe('newOrkyWorkspace rides the ONE coerced seam — structural half of REQ-002 (+ REQ-004/005/006 body discipline)', () => {
  it('TEST-664 REQ-002 REQ-004 REQ-005 REQ-006 the action body contains workspaceFromTemplate + orkyCockpitTemplate + reportAssignment() + scheduleAutosave() + sameProjectRoot + defaultShellId, and NO hand-assembly (createWorkspace/addFirstPane/splitPane/commitPane), NO fetch trigger (fetchOrkyDetail/registryDetail/notifyOrkyRootChanged), NO quick-save, NO launch/resumeAi/broadcast/PTY write, NO process read', () => {
    const store = read('src/renderer/store.ts')
    const body = block(store, /newOrkyWorkspace\s*[:=]/, 'newOrkyWorkspace')

    // instantiation ONLY through the seam that remaps ids AND applies normalizeOrkyBindings
    // (workspace-model.ts:300 — the CONV-026 pin; with frozen TEST-461 byte-unchanged this PAIR
    // is REQ-002's coercion proof, FINDING-004)
    expect(body).toContain('workspaceFromTemplate(')
    expect(body).toContain('orkyCockpitTemplate')
    for (const banned of ['createWorkspace(', 'addFirstPane', 'splitPane', 'commitPane']) {
      expect(body, `newOrkyWorkspace must never hand-assemble via ${banned}`).not.toContain(banned)
    }
    // registration matches newWorkspace IN FULL — via the ONE shared ritual, which owns the
    // load-bearing autosave + arrangement report (Group C #8 amendment)
    expect(body).toContain('registerWorkspace(')
    // membership via the fold-injected shared equality; shell via the shipped chain
    expect(body).toContain('sameProjectRoot')
    expect(body).toContain('defaultShellId')
    expect(body).not.toMatch(/\bprocess\s*[.[]/)
    // the property that makes an extra-fetch class impossible (REQ-005, CONV-033's structural
    // half): the cockpit path adds NO fetch trigger of its own — scoped to THIS body, because
    // store.ts legitimately composes registryDetail into the orky-pane slice elsewhere
    for (const banned of ['fetchOrkyDetail', 'registryDetail', 'notifyOrkyRootChanged']) {
      expect(body, `the cockpit action must not reference ${banned}`).not.toContain(banned)
    }
    // no silent template persistence (REQ-006), no write-surface leak (REQ-005)
    expect(body).not.toContain('scheduleQuickSave')
    for (const banned of ['resumeAi', 'encodeBroadcast', 'ptyWrite', 'ptySpawn', 'launchTerminalAt', 'launchCommand']) {
      expect(body, `the cockpit action must not reference ${banned}`).not.toContain(banned)
    }
    expect(body).not.toMatch(/\blaunch\s*:/) // never an SSH-style launch override on the terminal
  })

  it('TEST-665 REQ-005 REQ-001 the generator module owns NO fetch trigger, store reach, api reach, or write surface — the D4 composition boundary: it builds a WorkspaceTemplate VALUE and nothing else', () => {
    const src = read('src/shared/orky-cockpit.ts') // throws (RED) until the module exists
    for (const banned of [
      'fetchOrkyDetail', 'registryDetail', 'notifyOrkyRootChanged',   // no fetch trigger (FINDING-002)
      'scheduleQuickSave', 'scheduleAutosave',                        // no persistence reach
      'api.', 'zustand', 'useStore',                                  // no store/bridge reach
      'ptySpawn', 'ptyWrite', 'encodeBroadcast', 'resumeAi',          // no write/broadcast surface
      'runCommands', 'envId'                                          // no auto-run / env injection keys
    ]) {
      expect(src, `orky-cockpit.ts must not reference ${banned}`).not.toContain(banned)
    }
    expect(src).not.toMatch(/\blaunch\b/i) // the no-auto-run confirmation, at the source level
  })
})

describe('palette entry — appended, searchable, handled below the activeId guard (REQ-003)', () => {
  it('TEST-666 REQ-003 buildCommandItems() carries the new-orky-workspace action ("New Orky project workspace…", search covering orky/project/workspace/cockpit, filterable); CommandPalette handles it BELOW the activeId guard (the new-workspace precedent) and dispatches newOrkyWorkspace()', () => {
    const items = buildCommandItems()
    const entry = items.find(i => i.kind === 'action' && (i as { action?: string }).action === 'new-orky-workspace')
    expect(entry, 'buildCommandItems must offer new-orky-workspace').toBeDefined()
    expect((entry as { label: string }).label).toMatch(/new orky project workspace/i)
    for (const term of ['orky', 'project', 'workspace', 'cockpit']) {
      expect((entry as { search: string }).search).toContain(term)
    }
    const hit = filterPaletteItems(items, 'cockpit')
    expect(hit.some(i => (i as { action?: string }).action === 'new-orky-workspace')).toBe(true)

    // the union member exists (typecheck-independent source pin)
    expect(read('src/shared/quick.ts')).toContain("'new-orky-workspace'")

    const cp = read('src/renderer/components/CommandPalette.tsx')
    const guard = cp.indexOf('if (!activeId) return')
    expect(guard).toBeGreaterThanOrEqual(0)
    const handler = cp.indexOf("'new-orky-workspace'")
    expect(handler, 'CommandPalette must handle new-orky-workspace').toBeGreaterThanOrEqual(0)
    expect(handler, 'handled BELOW the activeId guard — with no active workspace it silently no-ops exactly like new-workspace').toBeGreaterThan(guard)
    expect(around(cp, "'new-orky-workspace'", 0, 220)).toContain('newOrkyWorkspace(')
  })
})

describe('templates-menu built-in row (REQ-003)', () => {
  it('TEST-667 REQ-003 tpl-orky-cockpit is a native, never-deletable button ("Orky project cockpit…") rendered in EVERY templates state (above/outside the saved-templates map), dispatching newOrkyWorkspace() and closing the menu on pick; the "No templates yet." saved-templates copy stays byte-present', () => {
    const src = read('src/renderer/components/TemplatesMenu.tsx')
    const region = around(src, 'tpl-orky-cockpit', 400, 400)
    expect(region).toContain('<button')
    expect(region).toMatch(/Orky project cockpit/)
    expect(region).toContain('newOrkyWorkspace')
    expect(region).toContain('onClose')                    // the menu closes on pick like shipped rows
    expect(region).not.toContain('deleteTemplate')         // never deletable
    expect(region).not.toContain('tpl-del')                // no delete affordance rides the row
    // rendered in every state: the built-in row precedes (is not inside) the saved-templates map
    expect(src.indexOf('tpl-orky-cockpit')).toBeLessThan(src.indexOf('templates.map'))
    // the SAVED-templates empties/rows are unchanged and may co-render
    expect(src).toContain('No templates yet.')
    expect(src).toContain('templates.length === 0')
    // the row never touches quick.templates
    expect(region).not.toContain('saveTemplate')
  })
})

describe('the F11-owned picker mount — shared component, cockpit relabel, no fork (REQ-003)', () => {
  it('TEST-668 REQ-003 App.tsx mounts a DEDICATED OrkyRootPicker instance driven by orkyCockpitPickOpen (the OrkyCaptureModal one-shot pattern), passing a coherent ariaLabel + heading pair matching /cockpit|workspace/i and never /bind/i, resolving through resolveOrkyCockpitPick; OrkyRootPicker.tsx itself is REUSED, not forked or edited (no F11 symbol enters it)', () => {
    const app = read('src/renderer/App.tsx')
    expect(app).toContain('orkyCockpitPickOpen') // RED until the F11 mount exists
    const region = around(app, 'orkyCockpitPickOpen && (', 100, 800) // the MOUNT site, not the subscription
    expect(region).toContain('OrkyRootPicker')              // the SHARED component identity
    expect(region).toContain('resolveOrkyCockpitPick')
    expect(region).toContain('ariaLabel')
    expect(region).toContain('heading')
    expect(region).toMatch(/cockpit|workspace/i)            // the gesture-coherent relabel pair
    expect(region).not.toMatch(/bind/i)                     // never the F9 default wording
    // the F9 default-labelled mount survives untouched beside it (three existing callers)
    expect(app).toContain('orkyRootPickOpen')
    expect(around(app, 'orkyRootPickOpen && (', 0, 400)).toContain('resolveOrkyRootPick')
    // component reuse, never a fork/edit: no F11 surface enters the shared picker file
    const picker = read('src/renderer/components/OrkyRootPicker.tsx')
    for (const sym of F11_SYMBOLS) {
      expect(picker, `OrkyRootPicker.tsx must stay byte-unchanged — found F11 symbol ${sym}`).not.toContain(sym)
    }
  })
})

describe('decision-queue group-header caller (REQ-004)', () => {
  it('TEST-669 REQ-004 decision-queue-open-cockpit is a native button on the group header carrying data-project-root and an accessible name, calling newOrkyWorkspace(<group root>) with its activation propagation-stopped (CONV-030/CONV-041); the panel-wide :focus-visible allow-list rule that covers panel buttons survives (CONV-007)', () => {
    const src = read('src/renderer/components/DecisionQueuePanel.tsx')
    const region = around(src, 'decision-queue-open-cockpit', 500, 500)
    expect(region).toContain('<button')
    expect(region).toContain('data-project-root')
    expect(region).toMatch(/title=|aria-label=/)            // an accessible name
    expect(region).toContain('newOrkyWorkspace(')
    expect(region).toContain('stopPropagation')             // no container gesture co-fires
    // the existing shipped affordance is untouched (additive composition)
    expect(src).toContain('decision-queue-open-terminal')
    // CONV-007: the panel's allow-list rule covers every panel <button>, incl. this one
    const css = read('src/renderer/index.css')
    expect(css).toContain('[data-testid="decision-queue-panel"] :is(button, .dq-row):focus-visible')
  })
})

describe('the decision-9 wiring — SliceDeps carries the registration ritual, State does not (REQ-006 / REQ-007)', () => {
  it('TEST-670 REQ-006 REQ-007 SliceDeps carries registerWorkspace (the shared set+autosave+report ritual — the Group C #8 successor of the raw reportAssignment dep) while the State region has NEITHER (the FINDING-008/TEST-619 discipline); State gains newOrkyWorkspace/orkyCockpitPickOpen/resolveOrkyCockpitPick; the deps object threads the store-root ritual; quick-slice destructures it and calls it EXACTLY once — before return ws.id, with no quick-save added', () => {
    const types = read('src/renderer/store/types.ts')
    const stateStart = types.indexOf('export interface State')
    const depsStart = types.indexOf('export interface SliceDeps')
    expect(stateStart).toBeGreaterThanOrEqual(0)
    expect(depsStart).toBeGreaterThan(stateStart)
    const stateRegion = types.slice(stateStart, depsStart)
    const depsRegion = types.slice(depsStart)
    expect(
      stateRegion,
      'registration wiring stays OFF the public State surface — it is internal wiring, not a public action (FINDING-008; frozen TEST-619 must stay green)'
    ).not.toContain('reportAssignment')
    expect(stateRegion).not.toContain('registerWorkspace')
    expect(depsRegion).toMatch(/registerWorkspace:\s*\(ws: Workspace\)\s*=>\s*void/)
    // the F11 public surface (spec "Public interface")
    expect(stateRegion).toMatch(/newOrkyWorkspace:\s*\(root\?:\s*string\)\s*=>\s*Promise<string \| null>/)
    expect(stateRegion).toContain('orkyCockpitPickOpen')
    expect(stateRegion).toContain('resolveOrkyCockpitPick')

    // store.ts: the store-root ritual enters the deps object literal
    const store = read('src/renderer/store.ts')
    expect(store).toMatch(/const deps: SliceDeps = \{[^}]*registerWorkspace[^}]*\}/)

    // quick-slice.ts: destructured from deps; ONE call, positioned on the success path
    const qs = read('src/renderer/store/quick-slice.ts')
    expect(qs).toMatch(/createQuickSlice\(\{[^)]*registerWorkspace[^)]*\}\s*:\s*SliceDeps\)/)
    const calls = qs.match(/registerWorkspace\(ws\)/g) ?? []
    expect(calls, 'exactly ONE registerWorkspace(ws) call site in quick-slice.ts (the success path)').toHaveLength(1)
    const body = block(qs, /newWorkspaceFromTemplate\s*:/, 'newWorkspaceFromTemplate')
    const iReg = body.indexOf('registerWorkspace(ws)')
    const iRet = body.indexOf('return ws.id')
    expect(iReg, 'the call lives INSIDE newWorkspaceFromTemplate').toBeGreaterThanOrEqual(0)
    expect(iRet).toBeGreaterThan(iReg)
    expect(body).not.toContain('scheduleQuickSave') // the diff adds no quick-save anywhere in the body
  })
})

describe('composition-only scope guard (REQ-007)', () => {
  // CONV-022 note: the two literal pins below (SCHEMA_VERSION, the PaneKind union line) are the
  // spec's OWN acceptance ("stays 8", "byte-unchanged") for the FINAL roadmap feature. Sanctioned
  // amendment path: a future feature that legitimately bumps either amends THIS test atomically at
  // ITS tests phase (the 0009 REQ-003 six-guard precedent, CONV-019).
  it('TEST-671 REQ-007 no new kind/schema/IPC/write path: SCHEMA_VERSION (9 since 0022 REQ-002) and the PaneKind union are byte-unchanged; the banned-string sweep over the F11 file set finds zero hits; no F11 symbol enters ipc-contract.ts, src/preload/**, or any of the five F9 files', () => {
    // schema + kind surface unchanged (no new pane kind, no bump — F9's 8 stands)
    // (re-pinned 8→9 by 0022 REQ-002 — the sanctioned amendment path this comment block names)
    expect(read('src/shared/types.ts')).toContain('export const SCHEMA_VERSION = 9')
    expect(read('src/renderer/store/pane-ops.ts'))
      .toContain("export type PaneKind = 'terminal' | 'editor' | 'explorer' | 'orky'")

    // the TEST-433 ban list applied to F11's own file set (incl. the two decision-9 files)
    const BANNED = ['registryAddRoot', 'registryRemoveRoot', 'registryRoots(', 'RegistryMutationResult',
      'orkyAction', 'child_process', 'execFile', 'orkyWatch', 'orkyUnwatch']
    const F11_FILES = [
      'src/shared/orky-cockpit.ts',              // throws (RED) until it exists
      'src/renderer/store/quick-slice.ts',
      'src/renderer/store/types.ts',
      'src/renderer/components/TemplatesMenu.tsx'
    ]
    for (const rel of F11_FILES) {
      const src = read(rel)
      for (const banned of BANNED) {
        expect(src, `${rel} must not reference ${banned}`).not.toContain(banned)
      }
    }
    // the F11 regions of the shared wiring files (scoped — these files predate F11)
    const store = read('src/renderer/store.ts')
    const regions = [
      ['store.ts newOrkyWorkspace', block(store, /newOrkyWorkspace\s*[:=]/, 'newOrkyWorkspace')],
      ['App.tsx cockpit mount', around(read('src/renderer/App.tsx'), 'orkyCockpitPickOpen && (', 100, 800)],
      ['DecisionQueuePanel cockpit button', around(read('src/renderer/components/DecisionQueuePanel.tsx'), 'decision-queue-open-cockpit', 500, 500)]
    ] as const
    for (const [label, region] of regions) {
      for (const banned of BANNED) {
        expect(region, `${label} must not reference ${banned}`).not.toContain(banned)
      }
    }

    // no new IPC surface / preload method: no F11 symbol reaches the contract or the bridge
    const contract = read('src/shared/ipc-contract.ts')
    const preloadFiles = walk(resolve(process.cwd(), 'src/preload')).map(f => readFileSync(f, 'utf8')).join('\n')
    for (const sym of F11_SYMBOLS) {
      expect(contract, `ipc-contract.ts must not gain F11 surface ${sym}`).not.toContain(sym)
      expect(preloadFiles, `src/preload/** must not gain F11 surface ${sym}`).not.toContain(sym)
    }

    // the five F9 files stay byte-unchanged — pinned the CONV-037 way (keyed on F11 symbols,
    // never a content hash a legitimate F9-owner refactor would false-trip, CONV-012)
    const F9_FILES = [
      'src/shared/orky-pane.ts',
      'src/renderer/components/OrkyPane.tsx',
      'src/renderer/components/OrkyRootPicker.tsx',
      'src/renderer/store/orky-pane-slice.ts',
      'src/main/orky/orky-root-detail.ts'
    ]
    for (const rel of F9_FILES) {
      const src = read(rel)
      for (const sym of F11_SYMBOLS) {
        expect(src, `${rel} must stay untouched by F11 — found ${sym}`).not.toContain(sym)
      }
    }
  })
})
