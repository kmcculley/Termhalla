// 2026-07-06 quality audit, Group C #10: six hand-rolled popover chromes (WorkspaceTabs ws-menu,
// TemplatesMenu, ExplorerPane context menu, PaneContextMenu, SplitMenu, OrkyPopover) had drifted
// semantics — Escape-dismiss existed in only 2 of 6, right-click-dismiss in 4 of 6, and each
// re-inlined the full-viewport click-catcher + SURFACE box. This suite pins the ONE shared
// MenuSurface chrome (click-catcher, right-click dismiss, Escape dismiss, optional portal) and
// that every popover site renders through it — a new popover copy-pasting a hand-rolled backdrop
// regresses this suite.
//
// Structural source-scan (the repo's node-env idiom — no jsdom); rendered behavior lives in the
// e2e suites (pane-actions.spec.ts, split-compass.spec.ts guard the portal/click semantics).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')

const SITES = [
  { rel: 'src/renderer/components/WorkspaceTabs.tsx', portalled: false },
  { rel: 'src/renderer/components/TemplatesMenu.tsx', portalled: false },
  { rel: 'src/renderer/components/ExplorerPane.tsx', portalled: true },   // inside a mosaic tile
  { rel: 'src/renderer/components/PaneContextMenu.tsx', portalled: true },
  { rel: 'src/renderer/components/SplitMenu.tsx', portalled: true },
  { rel: 'src/renderer/components/OrkyPopover.tsx', portalled: true }
]

describe('MenuSurface — the one shared popover chrome (Group C #10)', () => {
  it('MenuSurface.tsx owns the click-catcher, right-click dismiss, Escape dismiss, and the portal opt-in', () => {
    const src = read('src/renderer/components/MenuSurface.tsx')
    expect(src, 'the full-viewport click-catcher').toMatch(/position:\s*'fixed',\s*inset:\s*0/)
    expect(src, 'right-click on the backdrop dismisses (no browser menu)').toContain('onContextMenu')
    expect(src, 'Escape dismisses every menu (the audit gap: 2 of 6 had it)').toContain("'Escape'")
    expect(src, 'portal opt-in for tile-hosted menus (the CLAUDE.md containing-block gotcha)').toContain('createPortal')
    expect(src, 'the shared surface box').toContain('SURFACE')
  })

  it('all six popover sites render through <MenuSurface> and none keeps a hand-rolled backdrop', () => {
    for (const { rel } of SITES) {
      const src = read(rel)
      expect(src, `${rel} must render its menu through the shared MenuSurface`).toContain('<MenuSurface')
      expect(src, `${rel} must not keep a hand-rolled full-viewport click-catcher`)
        .not.toMatch(/position:\s*'fixed',\s*inset:\s*0/)
    }
  })

  it('the tile-hosted menus portal to <body> (the react-mosaic containing-block gotcha)', () => {
    for (const { rel, portalled } of SITES) {
      if (!portalled) continue
      expect(read(rel), `${rel} opens from inside a mosaic tile — its MenuSurface must portal`)
        .toMatch(/<MenuSurface[^>]*portal/)
    }
  })
})
