// A maximized pane's TILE GEOMETRY must not depend on whether its workspace is the active one.
//
// The fill (`inset/width/height: !important`, which overrides react-mosaic's inline percentage
// geometry) once lived in the same rule as the `visibility: visible` punch-through, and that rule is
// scoped to `[data-active="true"]`. So switching workspaces dropped the fill and the maximized tile
// snapped back to its original small tile box. That is a real box change on a still-mounted terminal:
// the ResizeObserver refits xterm, `syncGrid` resizes the PTY, and the resulting full-screen ConPTY
// repaint throws the viewport to the top of the scrollback (and can evict the status tail — see the
// needs-input gotcha in CLAUDE.md). Switching back does it all again in reverse.
//
// The split this suite pins: geometry unscoped, paint scoped. Keep-mounted means keep-sized — the
// same reason inactive workspaces use `visibility: hidden` rather than `display: none`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/index.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')   // strip comments — they legitimately discuss these properties

/** Properties that change the tile's box (as opposed to how it is painted). */
const GEOMETRY_PROPS = ['inset', 'width', 'height', 'top', 'right', 'bottom', 'left']

/** Every `selector { decls }` rule that targets the maximized tile itself. */
function maximizedTileRules(): Array<{ selector: string; decls: string; props: string[] }> {
  const out: Array<{ selector: string; decls: string; props: string[] }> = []
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim()
    if (!selector.includes('[data-max="1"]')) continue
    const props = m[2].split(';').map(d => d.split(':')[0].trim().toLowerCase()).filter(Boolean)
    out.push({ selector, decls: m[2], props })
  }
  return out
}

const isActiveScoped = (selector: string): boolean => selector.includes('data-active')

describe('maximized pane geometry is independent of workspace activity', () => {
  it('finds the maximized-tile rules it is meant to guard', () => {
    expect(maximizedTileRules().length).toBeGreaterThan(0)
  })

  it('no active-scoped rule declares tile geometry', () => {
    const offenders = maximizedTileRules()
      .filter(r => isActiveScoped(r.selector))
      .flatMap(r => r.props.filter(p => GEOMETRY_PROPS.includes(p)).map(p => `${r.selector} { ${p} }`))
    expect(offenders, 'move geometry to the unscoped `.ws-max .mosaic-tile[data-max="1"]` rule — scoping it resizes the terminal on every workspace switch').toEqual([])
  })

  it('the fill itself is declared, unscoped, and beats react-mosaic\'s inline geometry', () => {
    const fill = maximizedTileRules().find(r => !isActiveScoped(r.selector) && r.props.includes('width'))
    expect(fill, 'the maximized tile must still fill its workspace').toBeDefined()
    for (const prop of ['inset', 'width', 'height']) {
      const decl = fill!.decls.split(';').find(d => d.split(':')[0].trim() === prop) ?? ''
      expect(decl, `${prop} must be !important to override react-mosaic's inline style`).toContain('!important')
    }
  })

  it('the visibility punch-through stays scoped to the active workspace host', () => {
    // Unscoped, a descendant's `visible` overrides `hidden` on ANY ancestor, so an inactive
    // workspace's maximized pane bleeds through a transparent active one.
    const visRules = maximizedTileRules().filter(r => r.props.includes('visibility'))
    expect(visRules.length).toBeGreaterThan(0)
    for (const r of visRules) {
      expect(isActiveScoped(r.selector), `${r.selector} must be scoped to [data-active="true"]`).toBe(true)
      expect(r.selector).toContain('workspace-host')
    }
  })
})
