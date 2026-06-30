// FROZEN unit suite — feature 0004-orky-status-awareness (phase 4 / REQ-006 RENDERED failure treatment).
// A halted gate failure maps to `kind:'idle'` (it is not needs-human), so the pane carries the classes
// `term-status term-idle term-failure`. REQ-006 requires the red failure accent to actually RENDER for
// this failed-AND-idle pane — but the idle toolbar background rule
// `.mosaic-window:not(.term-busy):not(.term-needs-input) .mosaic-window-toolbar { background: var(--panel) !important }`
// matches the same pane and wins via `!important` unless the failure rule is made to win (corrects the
// HIGH contract violation FINDING-UX-001, where the failure border rendered NOWHERE for the canonical
// failed case). Failure MUST also carry a NON-COLOR affordance (WCAG 1.4.1 / FINDING-UX-002).
//
// The unit harness has no jsdom/CSS engine to compute the cascade, so this pins the precedence at the
// stylesheet source: the `.term-failure` toolbar background MUST win over the idle `!important` rule —
// either by being `!important` itself OR by the idle rule EXCLUDING `.term-failure`. The full computed
// `background-color === var(--status-failure)` render is also asserted in tests/e2e/orky-status.spec.ts.
// Runs RED against the prior pass: the shipped failure rule is NOT `!important` and the idle rule does
// NOT exclude `.term-failure`, and no CSS targets `[data-failed]`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/index.css'), 'utf8')

describe('Orky failed-pane rendering precedence + non-color affordance (REQ-006)', () => {
  it('TEST-051 REQ-006 the term-failure toolbar background wins over the idle !important background', () => {
    // (path A) the failure rule itself carries !important on its background
    const failureIsImportant =
      /\.term-failure[^{}]*\.mosaic-window-toolbar\s*\{[^}]*background-color[^;}]*!important/is.test(CSS)
    // (path B) the idle background !important rule EXCLUDES .term-failure from its selector
    const idleRule = CSS.match(/([^{}]*:not\(\.term-busy\):not\(\.term-needs-input\)[^{}]*\.mosaic-window-toolbar)\s*\{[^}]*background[^}]*!important/i)
    const idleExcludesFailure = !!idleRule && /:not\(\.term-failure\)/.test(idleRule[1])

    expect(failureIsImportant || idleExcludesFailure).toBe(true)
  })

  it('TEST-051 REQ-006 failure carries a non-color affordance (a styled [data-failed] treatment, not color alone)', () => {
    // FINDING-UX-002: failure is signalled by the red toolbar color alone; a colorblind user cannot
    // distinguish a failed pane. The chip's `data-failed` attribute MUST receive a visible non-color
    // treatment (glyph / outline / text), so some CSS rule must target `[data-failed]`.
    expect(CSS).toMatch(/\[data-failed\]/)
  })
})
