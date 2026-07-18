// FROZEN test suite — feature 0026-phone-web-remote (phase 4, v2 loopback — ESC-001;
// FINDING-011/017/022/027/038). REQ-011 (v2): the inventory carries REAL workspace ids/names and
// HUMAN-READABLE pane titles — the single-synthetic-workspace stub is rejected. The composition
// half (real workspace names + titles through the production wiring) is pinned by the mandated
// e2e (TEST-2729); this file pins the pure-builder half and the production-composition
// structural half.
//
// Contract amendment for the implementer — src/main/phone-remote/inventory.ts:
//   buildInventory(list) must produce a human-readable `title` for every pane: when the fed
//   record's title is missing/blank OR equals the raw pane id, it falls back to a
//   kind-plus-index label (e.g. "terminal 1") — the raw internal pane id is NEVER shown.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildInventory } from '../../src/main/phone-remote/inventory'

const pane = (paneId: string, title: string, ws = 'ws1'): Record<string, unknown> => ({
  paneId, workspaceId: ws, workspaceName: `Workspace ${ws}`, title, kind: 'terminal',
  cols: 80, rows: 24, status: 'idle'
})

describe('TEST-2726 REQ-011 human-readable titles: never the raw internal pane id', () => {
  it('falls back to a kind+index label for a blank title', () => {
    const inv = buildInventory([pane('550e8400-e29b-41d4-a716-446655440000', '')] as never)
    const p = inv.workspaces[0].panes[0]
    expect(p.title, 'a blank title must fall back to a human-readable label').toBeTruthy()
    expect(p.title).not.toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(p.title).toMatch(/terminal/i)
  })

  it('never surfaces a title equal to the raw pane id; untitled siblings get distinct labels', () => {
    const inv = buildInventory([
      pane('uuid-a', 'uuid-a'),
      pane('uuid-b', '')
    ] as never)
    const titles = inv.workspaces[0].panes.map((p) => p.title)
    expect(titles).not.toContain('uuid-a')
    expect(titles).not.toContain('uuid-b')
    expect(new Set(titles).size, 'untitled siblings must be distinguishable').toBe(2)
  })

  it('a real title passes through untouched', () => {
    const inv = buildInventory([pane('p1', 'claude — ~/dev/Termhalla')] as never)
    expect(inv.workspaces[0].panes[0].title).toBe('claude — ~/dev/Termhalla')
  })
})

describe('TEST-2726 REQ-011 the production composition threads REAL workspace metadata (structural)', () => {
  it('register.ts no longer mints the rejected single-synthetic-workspace stub', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/main/ipc/register.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(src, "the hard-coded workspaceId: 'local' stub is rejected (ESC-001)").not.toMatch(/workspaceId:\s*['"]local['"]/)
    expect(src, "the hard-coded workspaceName: 'Termhalla' stub is rejected (ESC-001)").not.toMatch(/workspaceName:\s*['"]Termhalla['"]/)
    expect(src, 'the raw pane id must not be used as the pane title').not.toMatch(/title:\s*paneId\b/)
  })
})
