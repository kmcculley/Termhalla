// NEW loopback suite — feature 0013-os-needs-you-notifications (review -> tests, ESC-001, 2026-07-02).
// Pins the two renderer-side review blockers on the click-to-reveal path, RED against the shipped code
// and frozen once this gate passes (ADR-009):
//   FINDING-006 — the MRU-pick + focus-dispatch TAIL (selectMruPane + setActive/setFocusedPane/
//                 requestPaneFocus) must be ONE shared helper (`focusMruPaneMatch`, exported from
//                 pane-reveal.ts) called by BOTH pane-reveal.focusProjectPane AND
//                 DecisionQueuePanel.focusProject — not two hand-kept-in-sync copies. The panel keeps
//                 its OWN selectPaneCandidates walk (frozen TEST-370 pins that call site inside the
//                 panel); only the tail is extracted, so this does not fight TEST-370.
//   FINDING-010 — revealQueueGroup must survive the closed->open mount: DecisionQueuePanel mounts
//                 AFTER setQueueOpen(true), so a single requestAnimationFrame can query before the
//                 target group exists and silently no-op. The reveal must RETRY across frames until the
//                 group element appears, then scroll it into view.
//
// The FINDING-006 half is a structural source scan (the shared-helper wiring cannot be mounted in the
// node-env gate). The FINDING-010 half is behavioral: revealQueueGroup is driven with a fake
// requestAnimationFrame + a document whose target group only appears after a couple of frames.
//
// Runs RED today: pane-reveal.ts has no exported shared tail (focusProjectPane inlines it and the panel
// keeps its own copy), and revealQueueGroup schedules a SINGLE rAF that gives up when the group is
// absent.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { revealQueueGroup } from '../../src/renderer/components/pane-reveal'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const PANE_REVEAL = 'src/renderer/components/pane-reveal.ts'
const PANEL = 'src/renderer/components/DecisionQueuePanel.tsx'

describe('shared MRU + focus-dispatch tail — one helper, two callers (REQ-006, FINDING-006)', () => {
  it('TEST-582 REQ-006 pane-reveal.ts exports focusMruPaneMatch (the shared tail) and DecisionQueuePanel imports+calls it — no forked MRU/dispatch copy; the panel keeps its own selectPaneCandidates walk (TEST-370)', () => {
    const reveal = read(PANE_REVEAL)
    const panel = read(PANEL)

    // (1) the shared tail is a real exported helper in pane-reveal.ts...
    expect(reveal).toMatch(/export\s+function\s+focusMruPaneMatch/)
    // ...and pane-reveal's own focusProjectPane routes THROUGH it (declaration + at least one call).
    expect((reveal.match(/focusMruPaneMatch/g) ?? []).length).toBeGreaterThanOrEqual(2)

    // (2) DecisionQueuePanel imports the shared tail from pane-reveal and calls it — no second copy.
    expect(panel).toMatch(/import\s*\{[^}]*focusMruPaneMatch[^}]*\}\s*from\s*['"]\.\/pane-reveal['"]/)
    expect(panel).toMatch(/focusMruPaneMatch\s*\(/)

    // (3) the panel STILL owns its per-render selectPaneCandidates walk (frozen TEST-370) — the tail
    // extraction must not remove that call site.
    expect(panel).toContain('selectPaneCandidates(')
  })
})

describe('drawer reveal survives the closed->open mount (REQ-007, FINDING-010)', () => {
  const realRaf = globalThis.requestAnimationFrame
  const realDoc = (globalThis as { document?: unknown }).document

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf
    ;(globalThis as { document?: unknown }).document = realDoc
  })

  it('TEST-583 REQ-007 revealQueueGroup retries across frames and scrolls the target group into view even when the group mounts AFTER the drawer opens (not a single give-up rAF)', () => {
    const queue: Array<() => void> = []
    globalThis.requestAnimationFrame = ((fn: () => void) => { queue.push(fn); return queue.length }) as never

    const scrolled: string[] = []
    const group = {
      dataset: { projectRoot: '/proj/late' },
      scrollIntoView: () => { scrolled.push('/proj/late') }
    }
    // The group is NOT in the DOM for the first two queries (the panel is still mounting after
    // setQueueOpen(true)); it appears on the third.
    let queries = 0
    ;(globalThis as { document?: unknown }).document = {
      querySelectorAll: () => { queries++; return queries >= 3 ? [group] : [] }
    }

    revealQueueGroup('/proj/late')
    // Drain the rAF queue — a robust reveal re-schedules across frames until the group exists.
    for (let i = 0; i < 60 && queue.length > 0; i++) { (queue.shift() as () => void)() }

    expect(scrolled).toEqual(['/proj/late'])   // the correct group was scrolled exactly once
    expect(queries).toBeGreaterThanOrEqual(3)  // it kept trying past the empty frames
  })
})
