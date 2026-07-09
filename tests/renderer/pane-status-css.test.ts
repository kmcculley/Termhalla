// The busy<->idle oscillation loop on ssh/agent panes. The idle-only toolbar rule declared a
// `border-bottom: 1px solid`, which the busy and needs-input rules did not. react-mosaic scopes
// `box-sizing: border-box` to `.mosaic, .mosaic > *` only — that never reaches the nested
// `.mosaic-window-toolbar`, which is content-box with a fixed `height: 30px`. So the idle bar stood
// 31px tall against the busy bar's 30px: every status flip resized the terminal host by 1px, refit
// xterm, resized the PTY, and provoked a full-screen repaint — which re-marked a marker-less pane
// busy, which removed the border, which resized again, forever.
//
// The invariant (already stated in CLAUDE.md for the editor tab strip, and in index.css's own
// `.term-failure` comment: "Paint-only: a red toolbar accent, never a box change"): a pane's status
// may change how the toolbar is PAINTED, never the size of its box. This suite pins it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/index.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')   // strip comments — they legitimately discuss `border`

/** Properties that change an element's box. `border-radius` is paint-only, so it is not one. */
const LAYOUT_PROPS = [
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-width',
  'padding', 'margin', 'height', 'min-height', 'max-height', 'width', 'box-sizing',
  'font-size', 'line-height'
]

/** Every `selector { decls }` block whose selector targets the toolbar ELEMENT (not a descendant
 *  such as a button) and is keyed on a `term-*` status class. */
function statusToolbarRules(): Array<{ selector: string; decls: string }> {
  const out: Array<{ selector: string; decls: string }> = []
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim()
    if (!selector.includes('term-')) continue
    // Each comma-separated selector must land ON the toolbar element itself.
    if (!selector.split(',').every(s => s.trim().endsWith('.mosaic-window-toolbar'))) continue
    out.push({ selector, decls: m[2] })
  }
  return out
}

function declaredProps(decls: string): string[] {
  return decls.split(';').map(d => d.split(':')[0].trim().toLowerCase()).filter(Boolean)
}

describe('pane status chrome is paint-only (busy<->idle oscillation guard)', () => {
  it('finds the status-keyed toolbar rules it is meant to guard', () => {
    const rules = statusToolbarRules()
    expect(rules.length, 'expected the term-busy / term-needs-input / idle toolbar rules').toBeGreaterThanOrEqual(3)
    const all = rules.map(r => r.selector).join('\n')
    expect(all).toMatch(/term-busy/)
    expect(all).toMatch(/term-needs-input/)
  })

  it('no status-keyed toolbar rule declares a property that changes the toolbar box', () => {
    for (const { selector, decls } of statusToolbarRules()) {
      for (const prop of declaredProps(decls)) {
        expect(
          LAYOUT_PROPS,
          `"${prop}" in \`${selector}\` changes the toolbar's box. A pane's status must be ` +
          `paint-only — a 1px height delta between busy and idle refits xterm, resizes the PTY, ` +
          `and oscillates a marker-less (ssh/agent) pane between busy and idle forever. ` +
          `Use an inset box-shadow for a hairline.`
        ).not.toContain(prop)
      }
    }
  })

  it('the idle toolbar still paints its bottom hairline — as an inset shadow, not a border', () => {
    const idle = statusToolbarRules().find(r => r.selector.includes(':not(.term-busy)'))
    expect(idle, 'the idle toolbar rule').toBeDefined()
    expect(idle!.decls).toMatch(/box-shadow:\s*inset\s+0\s+-1px\s+0/)
  })
})
