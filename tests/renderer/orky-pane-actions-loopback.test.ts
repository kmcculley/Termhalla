// FROZEN structural suite — feature 0010-orky-pane-inline-actions, ESC-001 tests LOOPBACK
// (review → tests, 2026-07-02). The 7-lens review found the tile-context layout structurally
// defeated and a delivery gap the pane's keep-mounted-hidden hosts create; per the ESC-001
// decision these fixes are pinned HERE (new file — the frozen phase-4 suites stay byte-unchanged
// except the supersessions logged in 04-tests.md) so the implement phase makes them pass without
// editing tests (ADR-009).
//
//   TEST-638 (FINDING-007, REQ-007) — the orky-pane-row-actions slot must be able to SHRINK so the
//     shared region's own flexWrap rows can engage inside a narrow mosaic tile: no flex:'none'
//     (flex-basis max-content, unshrinkable), and minWidth: 0 so the flex default min-width:auto
//     cannot re-rigidify it. Rendered half: e2e TEST-646 (tile-relative, per the FINDING-007
//     lesson — never window.innerWidth).
//   TEST-639 (FINDING-008, REQ-003) — the pane header hosting orky-pane-inject must WRAP: the
//     header is a no-wrap flex row of mostly rigid nowrap spans with inject LAST, so in a
//     realistic split tile the inject affordance is pushed clean off the tile with no scroll
//     access. Rendered half: e2e TEST-646.
//   TEST-640 (FINDING-018, REQ-005) — hidden-at-settle outcome delivery: deliver() uses
//     mount-aliveness (aliveRef) as its user-visibility proxy, but the pane mount lives inside
//     keep-mounted-HIDDEN hosts (inactive workspace / maximized-over — PaneTile hidden prop), so
//     an outcome settling while the owning surface is hidden renders into an invisible surface:
//     no toast, no signal, inviting the exact blind duplicate re-dispatch CONV-015/CONV-034
//     exist to prevent. The pane threads its OWN hidden prop (F9's existing signal) into the
//     shared region, and deliver() treats hidden-at-settle like detached-at-settle (the store
//     toast chokepoint). Rendered half: e2e TEST-648.
//
// Runs RED today: the shipped slot span carries flex:'none' (no minWidth: 0), the header declares
// no flexWrap, OrkyPane passes no visibility signal into the mount, and deliver() consults only
// aliveRef.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const PANE = 'src/renderer/components/OrkyPane.tsx'
const ACTIONS = 'src/renderer/components/orky-entry-actions.tsx'

/** A window of source text around the first occurrence of `needle`. */
function around(src: string, needle: string, before = 400, after = 400): string {
  const at = src.indexOf(needle)
  expect(at, `${needle} must exist`).toBeGreaterThanOrEqual(0)
  return src.slice(Math.max(0, at - before), at + needle.length + after)
}

/** The balanced-brace body of the arrow/function assigned at `anchor` (e.g. "const deliver"). */
function bodyOf(src: string, anchor: string): string {
  const at = src.indexOf(anchor)
  expect(at, `${anchor} must exist`).toBeGreaterThanOrEqual(0)
  const open = src.indexOf('{', at)
  expect(open, `${anchor} must open a body`).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1) }
  }
  throw new Error(`${anchor}: unbalanced body`)
}

describe('tile-context layout — the region and the inject affordance stay reachable in a NARROW tile (FINDING-007/FINDING-008)', () => {
  it('TEST-638 REQ-007 (FINDING-007) the orky-pane-row-actions slot is SHRINKABLE: no flex:\'none\' on the slot span, and minWidth: 0 so the shared region\'s own flexWrap rows engage instead of forcing the features list into overflow-scroll', () => {
    const src = read(PANE)
    // anchor on the populated slot (the F10 marker TEST-629 also anchors on)
    const slot = around(src, 'data-testid="orky-pane-row-actions"', 0, 250)
    expect(slot).toContain('<OrkyEntryActions')
    // the defeat: flex 0 0 auto pins the flex base size at the region's max-content width — the
    // internal flexWrap rows (orky-entry-actions.tsx :219/:266/:361) then never engage in a tile
    // narrower than that intrinsic width, and the whole features list overflow-scrolls instead
    expect(slot, 'the slot must not be flex:none — it can never shrink below max-content')
      .not.toMatch(/flex:\s*['"]none['"]/)
    // flex min-width:auto would re-rigidify a shrinkable slot: minWidth: 0 is load-bearing
    expect(slot, 'the slot needs minWidth: 0 so it can genuinely shrink (flex min-width:auto otherwise floors it at content size)')
      .toMatch(/minWidth:\s*0/)
  })

  it('TEST-639 REQ-003 (FINDING-008) the pane header row hosting orky-pane-inject WRAPS (flexWrap: \'wrap\'): the inject affordance can move to a second header line instead of being pushed off the tile with no scroll access', () => {
    const src = read(PANE)
    const injectAt = src.indexOf('"orky-pane-inject"')
    expect(injectAt, 'the inject affordance must exist').toBeGreaterThanOrEqual(0)
    // the nearest flex container opened BEFORE the inject button is the pane header row (the
    // informational spans between them declare no display of their own)
    const headerFlexAt = src.lastIndexOf("display: 'flex'", injectAt)
    expect(headerFlexAt, 'the inject button must sit inside a flex header row').toBeGreaterThanOrEqual(0)
    const headerStyle = src.slice(headerFlexAt, Math.min(headerFlexAt + 300, injectAt))
    expect(headerStyle,
      'the header row must declare flexWrap: \'wrap\' — its rigid nowrap spans (source, needs you, failed, active: <slug>) otherwise push the LAST flex item (inject) clean off a narrow tile, and the header has no scroll container'
    ).toMatch(/flexWrap:\s*['"]wrap['"]/)
  })
})

describe('hidden-at-settle outcome delivery — the pane\'s keep-mounted-hidden hosts (FINDING-018, REQ-005)', () => {
  it('TEST-640 REQ-005 (FINDING-018) OrkyPane threads its OWN hidden prop (F9\'s host-hidden signal) into the shared region mount, and deliver() treats an effectively-HIDDEN owning surface like a detached one — the outcome routes through the store toast chokepoint, never only into an invisible surface', () => {
    const pane = read(PANE)
    // the pane mount passes the visibility signal it already holds (the same `hidden` prop both
    // keep-mounted-hidden hosts drive — PaneTile\'s wsInactive/maximizedOver and the minimized host)
    const mount = around(pane, '<OrkyEntryActions', 0, 600)
    expect(mount, 'the pane mount must thread the pane\'s hidden prop into the shared region')
      .toMatch(/\bhidden\b/)

    const actions = read(ACTIONS)
    // the shared surface accepts a host-visibility signal (an optional prop/argument — the queue
    // mount, whose drawer unmounts on close, need not supply it)
    expect(actions, 'the shared region/hook must accept a host-hidden signal')
      .toMatch(/hostHidden|paneHidden|hiddenRef|\bhidden\b/)
    // deliver() consults it NEXT TO mount-aliveness: hidden-at-settle routes through pushToast
    // exactly like detached-at-settle (CONV-034 — no outcome is ever rendered ONLY into an
    // invisible surface)
    const deliver = bodyOf(actions, 'const deliver')
    expect(deliver, 'deliver must still consult mount-aliveness').toContain('aliveRef')
    expect(deliver, 'deliver must ALSO consult the host-hidden signal — hidden-at-settle is detached-at-settle')
      .toMatch(/[hH]idden/)
    expect(deliver, 'the hidden/detached branch reports through the store toast chokepoint').toContain('pushToast')
  })
})
