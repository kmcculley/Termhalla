// FROZEN loopback suite — feature 0009-native-orky-pane (phase 4, ESC-001 tests loopback).
// REQ-020 (amended 2026-07-02, FINDING-032) — the malformed-binding coercion MUST hold on EVERY
// instantiation path of the persisted shape, including workspace TEMPLATES: templates persist in
// quick.json, whose loader validates them only as Array.isArray(v.templates) (no per-template
// shape check), and workspaceFromTemplate/remapPaneIds clone configs opaquely — so a hand-edited
// template carrying { kind:'orky', root: 42 } is exactly the hostile input the REQ exists for.
// It MUST instantiate an UNBOUND pane (root coerced to ''), never a throw, never a dropped pane.
// (The workspace-FILE load path's coercion is already pinned by TEST-381/382 in
// tests/shared/orky-pane-migration.test.ts; this suite pins the SECOND path the shipped
// implementation misses.)
//
// Runs RED today (2026-07-02, against the shipped F9 implementation): workspaceFromTemplate clones
// the non-string binding through verbatim (root stays 42), so OrkyPane's unguarded
// basenameOf(root).split(...) would throw at render time.
import { describe, it, expect } from 'vitest'
import { workspaceFromTemplate } from '@shared/workspace-model'
import type { WorkspaceTemplate } from '@shared/types'

const rootOf = (cfg: unknown): unknown => (cfg as { root?: unknown }).root

function template(panes: Record<string, { config: Record<string, unknown> }>): WorkspaceTemplate {
  const ids = Object.keys(panes)
  const layout = ids.length === 1
    ? ids[0]
    : ids.slice(1).reduce<unknown>((acc, id) => ({ direction: 'row', first: acc, second: id }), ids[0])
  return {
    id: 'tpl-1', name: 'hostile',
    layout,
    panes: Object.fromEntries(ids.map(id => [id, { paneId: id, config: panes[id].config }]))
  } as unknown as WorkspaceTemplate
}

function seqUuid(): () => string {
  let n = 0
  return () => `new-${++n}`
}

describe('template instantiation coerces a malformed orky binding (REQ-020 / FINDING-032)', () => {
  it('TEST-461 REQ-020 a quick.json template with { kind:"orky", root: 42 } (and one with root ABSENT) instantiates without throwing, keeps the pane, and coerces root to \'\' (the unbound state) — a well-formed sibling binding passes through VERBATIM', () => {
    const tpl = template({
      p1: { config: { kind: 'orky', root: 42 } },                       // hostile: non-string binding
      p2: { config: { kind: 'orky' } },                                 // hostile: binding absent
      p3: { config: { kind: 'orky', root: 'C:\\Dev\\MixedCase\\Proj' } }, // well-formed, verbatim
      p4: { config: { kind: 'terminal', cwd: 'C:\\x' } }                // non-orky panes untouched
    })
    let ws!: ReturnType<typeof workspaceFromTemplate>
    expect(() => { ws = workspaceFromTemplate(tpl, 'ws-1', 'W', seqUuid()) }).not.toThrow()

    const configs = Object.values(ws.panes).map(p => p.config as { kind: string })
    expect(configs).toHaveLength(4) // no pane dropped (CONV-002)

    const orkyRoots = configs.filter(c => c.kind === 'orky').map(rootOf).sort()
    // downstream code never sees a non-string binding on ANY instantiation path:
    // both hostile panes land unbound (''), the well-formed one byte-verbatim
    expect(orkyRoots).toEqual(['', '', 'C:\\Dev\\MixedCase\\Proj'])
    for (const r of orkyRoots) expect(typeof r).toBe('string')

    // the terminal pane's config is untouched by the coercion seam
    const term = configs.find(c => c.kind === 'terminal') as { cwd?: string }
    expect(term.cwd).toBe('C:\\x')
  })
})
