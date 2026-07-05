// FROZEN unit suite — feature 0009-native-orky-pane (phase 4 / TASK-003 + TASK-004).
// REQ-001 (kind-generic persistence citizenship) / REQ-002 (SCHEMA_VERSION 7→8, deterministic +
// idempotent migration, preserved v<8 behavior) / REQ-020 (malformed-`root` load tolerance) — plus
// REQ-003's residual grep guard (no remaining `SCHEMA_VERSION`-value pin in tests/**).
//
// Runs RED today: SCHEMA_VERSION is 7, so TEST-375 fails and every v8 fixture below trips the
// existing "newer than supported" guard until the implementer lands the bump + the v<8 migration
// step + the orky-root load coercion (TASK-003/TASK-004).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import {
  serializeWorkspace, deserializeWorkspace, templateFromWorkspace, workspaceFromTemplate,
  movePane, minimizePane, restorePane, createWorkspace, addFirstPane
} from '@shared/workspace-model'
import { migrateAppState } from '@shared/app-state-model'
import { SCHEMA_VERSION, type Workspace, type PaneNode, type WindowState } from '@shared/types'

const term = (id: string): PaneNode => ({ paneId: id, config: { kind: 'terminal', shellId: 'pwsh', cwd: '' } })
const editor = (id: string): PaneNode => ({ paneId: id, config: { kind: 'editor', files: ['C:\\a.ts'], activePath: 'C:\\a.ts' } })
const explorer = (id: string): PaneNode => ({ paneId: id, config: { kind: 'explorer', root: 'C:\\proj' } })
// The persisted binding is case-preserved and stored VERBATIM (REQ-005) — a mixed-case root is the vector.
const orky = (id: string, root: unknown = 'C:\\Dev\\MixedCase\\Proj'): PaneNode =>
  ({ paneId: id, config: { kind: 'orky', root } as never })
const fixture = (version: number, w: object): string => JSON.stringify({ schemaVersion: version, workspace: w })

const V6 = fixture(6, {
  id: 'w', name: 'W', layout: { direction: 'row', first: 'p1', second: { direction: 'column', first: 'p2', second: 'p3' } },
  panes: { p1: term('p1'), p2: editor('p2'), p3: explorer('p3') }
})
const V7 = fixture(7, {
  id: 'w', name: 'W', layout: { direction: 'row', first: 'p1', second: 'p2' },
  panes: { p1: term('p1'), p2: editor('p2') }, minimized: ['p2']
})
const V8_ORKY = fixture(8, {
  id: 'w', name: 'W', layout: 'p1', panes: { p1: orky('p1') }
})

describe('SCHEMA_VERSION bump + migration determinism (REQ-002)', () => {
  // SUPERSEDED point-in-time pin (CONV-019): re-pinned 8→9 by feature 0022-client-routing-
  // remote-workspace-ux (REQ-002, the persisted workspace home — see 0022's 04-tests.md).
  it('TEST-375 REQ-002 SCHEMA_VERSION is 9 (re-pinned by 0022 REQ-002)', () => {
    expect(SCHEMA_VERSION).toBe(9)
  })

  it('TEST-376 REQ-002 a v6 and a v7 fixture deserialize with ALL panes preserved (v6: empty view-state) — twice, deep-equal both times (determinism)', () => {
    const a6 = deserializeWorkspace(V6), b6 = deserializeWorkspace(V6)
    expect(a6).toEqual(b6) // same pre-migration bytes → same post-migration value
    for (const id of ['p1', 'p2', 'p3']) expect(a6.panes[id]).toBeDefined()
    expect(a6.minimized ?? []).toEqual([])
    expect(a6.maximized ?? null).toBeNull()

    const a7 = deserializeWorkspace(V7), b7 = deserializeWorkspace(V7)
    expect(a7).toEqual(b7)
    expect(a7.panes['p1']).toBeDefined()
    expect(a7.panes['p2']).toBeDefined()
    expect(a7.minimized).toEqual(['p2']) // existing v7 view-state behavior byte-for-byte preserved
  })

  it('TEST-377 REQ-002 REQ-001 a v8 workspace containing an orky pane round-trips serialize→deserialize BYTE-identically, binding case-preserved', () => {
    const parsed = deserializeWorkspace(V8_ORKY)
    expect((parsed.panes['p1'].config as { root?: unknown }).root).toBe('C:\\Dev\\MixedCase\\Proj') // verbatim, never re-cased
    const s1 = serializeWorkspace(parsed)
    expect(JSON.parse(s1).schemaVersion).toBe(9) // serialization stamps the CURRENT version (9 since 0022)
    const s2 = serializeWorkspace(deserializeWorkspace(s1))
    expect(s2).toBe(s1) // byte-identical fixpoint
  })

  it('TEST-378 REQ-002 migration is idempotent: deserialize(serialize(deserialize(x))) deep-equals deserialize(x) for the v6, v7 and v8 fixtures', () => {
    for (const f of [V6, V7, V8_ORKY]) {
      const once = deserializeWorkspace(f)
      expect(deserializeWorkspace(serializeWorkspace(once))).toEqual(once)
    }
  })

  // AMENDED by feature 0022 (tests phase, the CONV-019/CONV-022 path): 9 became the CURRENT
  // version (the persisted workspace home), so the newer-than-supported invariant re-pins at 10.
  // This vector was the CONV-059 assembled-needle case: the 8→9 sweep greps could not see a pin
  // spelled as a rejection-of-9 — the red run did.
  it('TEST-379 REQ-002 a schemaVersion 10 fixture still throws the existing "newer than supported" error (re-pinned by 0022 REQ-002)', () => {
    expect(() => deserializeWorkspace(fixture(10, { id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') } })))
      .toThrow(/newer than supported/)
  })

  it('TEST-380 REQ-002 a saved v7 app-state.json still loads under the current constant (its migration keys only on the version bound)', () => {
    const bounds: WindowState = { x: 0, y: 0, width: 900, height: 640, maximized: false } as never
    const out = migrateAppState({ schemaVersion: 7, windows: [{ workspaceIds: ['w'], activeId: 'w', bounds, isMain: true }] }, bounds)
    expect(out).not.toBeNull()
    expect(out!.windows[0].workspaceIds).toEqual(['w'])
    expect(out!.schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('malformed persisted orky config — load tolerance (REQ-020)', () => {
  it('TEST-381 REQ-020 a v8 orky pane with a numeric root and one with the field ABSENT both load without throwing, pane kept, root coerced to \'\'', () => {
    for (const bad of [orky('p1', 42), { paneId: 'p1', config: { kind: 'orky' } as never } satisfies PaneNode]) {
      const w = deserializeWorkspace(fixture(8, { id: 'w', name: 'W', layout: 'p1', panes: { p1: bad } }))
      expect(w.panes['p1']).toBeDefined() // never dropped
      expect((w.panes['p1'].config as { root?: unknown }).root).toBe('') // the tolerated unbound-on-load value
    }
  })

  it('TEST-382 REQ-020 a workspace mixing one malformed and one well-formed orky pane keeps BOTH (well-formed binding intact); the existing bad-shape rejection is unchanged', () => {
    const w = deserializeWorkspace(fixture(8, {
      id: 'w', name: 'W', layout: { direction: 'row', first: 'p1', second: { direction: 'row', first: 'p2', second: 'p3' } },
      panes: { p1: orky('p1', 42), p2: orky('p2', 'C:\\Proj\\Good'), p3: term('p3') }
    }))
    expect((w.panes['p1'].config as { root?: unknown }).root).toBe('')
    expect((w.panes['p2'].config as { root?: unknown }).root).toBe('C:\\Proj\\Good')
    expect(w.panes['p3'].config.kind).toBe('terminal')
    // CONV-002: tolerance is for the FIELD, not the file — a non-object panes map still rejects.
    expect(() => deserializeWorkspace(fixture(8, { id: 'w', name: 'W', layout: null, panes: 'garbage' })))
      .toThrow(/bad shape/)
  })
})

describe('kind-generic pane machinery treats the orky config as opaque data (REQ-001)', () => {
  it('TEST-383 REQ-001 template round-trip reproduces an orky pane bound to the SAME root under a fresh id; movePane and minimize/restore preserve the binding', () => {
    const ws = addFirstPane(createWorkspace('W', () => 'w1'), { kind: 'orky', root: 'C:\\Dev\\MixedCase\\Proj' } as never, () => 'p1').workspace
    // templateFromWorkspace → workspaceFromTemplate: fresh pane id, deep-equal config.
    const tpl = templateFromWorkspace(ws, 't1', 'T')
    let n = 0
    const inst = workspaceFromTemplate(tpl, 'w2', 'W2', () => `fresh-${n++}`)
    const ids = Object.keys(inst.panes)
    expect(ids).toHaveLength(1)
    expect(ids[0]).not.toBe('p1')
    expect(inst.panes[ids[0]].config).toEqual({ kind: 'orky', root: 'C:\\Dev\\MixedCase\\Proj' })
    // cross-workspace move preserves config.root
    const other = createWorkspace('O', () => 'wo')
    const moved = movePane(ws, other, 'p1')
    expect((moved.to.panes['p1'].config as { root?: unknown }).root).toBe('C:\\Dev\\MixedCase\\Proj')
    // minimize/restore keep the binding intact
    const min = minimizePane(ws, 'p1')
    expect(min.minimized).toEqual(['p1'])
    const rest = restorePane(min, 'p1')
    expect((rest.panes['p1'].config as { root?: unknown }).root).toBe('C:\\Dev\\MixedCase\\Proj')
  })
})

describe('REQ-003 residual guard — no SCHEMA_VERSION value pin survives in tests/**', () => {
  it('TEST-384 REQ-003 a repo-wide sweep of tests/** finds no remaining literal SCHEMA_VERSION pin beyond the two documented unrelated hits', () => {
    // The needle is assembled so THIS file never matches its own pattern.
    const NEEDLE = 'toBe(' + '7)'
    // The two documented, UNRELATED literal hits (0009 spec, Verified contract / FINDING-001):
    //   pane-focus-seq.test.ts:30 — a focus-sequence counter; orky-status.test.ts:99 — ORKY_AUTONOMOUS_PHASES.length.
    const ALLOWED = new Set(['tests/renderer/pane-focus-seq.test.ts', 'tests/shared/orky-status.test.ts'])
    const root = resolve(process.cwd(), 'tests')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(test|spec)\.ts$/.test(name)) files.push(p)
      }
    }
    walk(root)
    const offenders = files
      .filter(f => readFileSync(f, 'utf8').includes(NEEDLE))
      .map(f => relative(process.cwd(), f).replace(/\\/g, '/'))
      .filter(rel => !ALLOWED.has(rel))
    expect(offenders).toEqual([])
    // …and the two allowed hits still exist exactly where documented (keeps this allow-list honest).
    for (const rel of ALLOWED) {
      expect(readFileSync(resolve(process.cwd(), rel), 'utf8').includes(NEEDLE), `${rel} should still carry its unrelated literal`).toBe(true)
    }
  })
})
