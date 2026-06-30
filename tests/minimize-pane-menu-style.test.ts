// FROZEN unit suite (Loop-back 2 / from review) — feature 0003-pane-minimize-restore.
// FINDING-UX-001 (contract): the context-menu Minimize item — one of REQ-001's THREE mandated entry
// points — lives in the portalled `pane-menu`, which was ABSENT from the focus-visible AND hover
// styling allow-lists in `src/renderer/index.css` (unlike ws-menu/proc-menu/cwd-menu/split-menu and
// the tray chips). It therefore had no accent focus ring and no hover affordance, violating REQ-014 /
// CONV-007 ("any tray/menu chrome portalled to <body> MUST carry visible paint-only focus and hover
// styling, or be added to the focus-visible/hover allow-lists").
//
// There is no existing runtime CONV-007 test to mirror (the only computed-style e2e is ui-polish's
// boxShadow probe, and `:focus-visible` needs real keyboard focus → flaky). So, mirroring the
// source-file approach of the TEST-023 docs guard, this pins TASK-015 deterministically by asserting
// `[data-testid="pane-menu"]` is a member of BOTH the hover and the focus-visible selector groups.
// Runs RED today: pane-menu is not yet in those groups.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/renderer/index.css'), 'utf8')

/** Slice out the `:is( …allow-list… ) <anchor>` selector group that precedes a given pseudo-class
 *  anchor, so we assert membership in THAT specific rule and not merely anywhere in the file. */
function groupBefore(anchor: string): string {
  const end = css.indexOf(anchor)
  expect(end, `index.css must contain the chrome rule anchored at "${anchor}"`).toBeGreaterThanOrEqual(0)
  // The anchor itself begins with ':is(' (e.g. ':is(button, select):hover…'), so we must search
  // backwards from `end - 1` to skip the anchor's own ':is(' and land on the PRECEDING allow-list
  // group's ':is(' — searching from `end` would match the anchor and slice an empty string.
  const start = css.lastIndexOf(':is(', end - 1)
  expect(start).toBeGreaterThanOrEqual(0)
  return css.slice(start, end)
}

describe('TEST-042 REQ-014 portalled pane-menu carries focus-visible + hover styling (CONV-007)', () => {
  it('pane-menu is in the focus-visible allow-list group', () => {
    const focusGroup = groupBefore(':is(button, select, input, textarea):focus-visible')
    expect(focusGroup).toContain('[data-testid="pane-menu"]')
  })

  it('pane-menu is in the hover allow-list group', () => {
    const hoverGroup = groupBefore(':is(button, select):hover:not(:disabled)')
    expect(hoverGroup).toContain('[data-testid="pane-menu"]')
  })
})
