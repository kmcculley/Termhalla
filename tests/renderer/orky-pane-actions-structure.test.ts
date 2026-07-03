// FROZEN structural suite — feature 0010-orky-pane-inline-actions (phase 4).
// The vitest harness is node-env with no jsdom (vitest.config.ts), so the pane-side COMPOSITION
// contract is pinned the repo's established way (0004/0006/0008/0009 precedent; 03-plan.md
// "Testability constraint"): source-scan tests over LITERAL, greppable source text. Full rendered
// behavior is asserted end-to-end in tests/e2e/orky-pane-actions.spec.ts (TEST-632..637).
//
// F10 is a REUSE/COMPOSITION feature: this suite pins the WIRING (the mount, the target
// construction, the id sourcing, the inject affordance, the scope guard) and deliberately does NOT
// re-pin F8's action logic — that stays frozen where it lives:
//   - the supplied-id zero-pull / one-verify-pull counts: TEST-588/TEST-591
//     (orky-entry-actions-core.test.ts:191,:274) — byte-unchanged is a REQUIREMENT (REQ-002);
//   - the cross-instance single-flight dedupe + continuation fan-out: TEST-585/TEST-615
//     (orky-entry-actions-core.test.ts:126, orky-entry-actions-loopback.test.ts:78) and the e2e
//     disabled-while-pending TEST-608 (orky-queue-actions.spec.ts:211-213) — byte-unchanged (REQ-005);
//   - the one-renderer-owner sweep TEST-607 and the queue mount's no-escalationId pin TEST-602
//     (orky-entry-actions-structure.test.ts) — byte-unchanged (REQ-001).
//
// Runs RED today: src/renderer/components/OrkyPane.tsx exists (F9) but contains no
// OrkyEntryActions import, no mount in the reserved orky-pane-row-actions slot, no escalationId
// sourcing expression, and no orky-pane-inject affordance — every test below anchors on one of
// those F10 markers before applying its guards, so the whole file fails until F10 is implemented.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const PANE = 'src/renderer/components/OrkyPane.tsx'
const pane = () => read(PANE)

/** Balanced-paren spans of every useEffect(...) call (the 0012 TEST-489 technique). */
function useEffectSpans(src: string): string[] {
  const spans: string[] = []
  let i = src.indexOf('useEffect(')
  while (i !== -1) {
    let depth = 0
    let j = i + 'useEffect'.length
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++
      else if (src[j] === ')') { depth--; if (depth === 0) break }
    }
    spans.push(src.slice(i, j + 1))
    i = src.indexOf('useEffect(', j)
  }
  return spans
}

/** A window of source text around the first occurrence of `needle`. */
function around(src: string, needle: string, before = 400, after = 400): string {
  const at = src.indexOf(needle)
  expect(at, `${needle} must exist`).toBeGreaterThanOrEqual(0)
  return src.slice(Math.max(0, at - before), at + needle.length + after)
}

describe('the mount — F8\'s shared region in F9\'s reserved slot, keyed on the pane\'s own row identity (REQ-001 / REQ-008)', () => {
  it('TEST-624 REQ-001 REQ-008 OrkyPane imports OrkyEntryActions from ./orky-entry-actions and mounts it INSIDE the reserved orky-pane-row-actions span with the decision-#2 target (projectRoot: root, featureSlug: f.slug, reason: f.status.reason, conditional escalationId) — and the file contains no api.orky reference and no fork of any answer/preview/resume logic', () => {
    const src = pane()
    // the import (the F10 marker — RED until the mount lands); the TEST-602 regex, applied here
    expect(src).toMatch(/import\s*(type\s*)?\{[^}]*OrkyEntryActions[^}]*\}\s*from\s*['"]\.\/orky-entry-actions['"]/)
    // the mount sits INSIDE the element carrying the reserved slot testid (F9 REQ-012 — the slot
    // literal and row position survive, now populated)
    const slotAt = src.indexOf('data-testid="orky-pane-row-actions"')
    expect(slotAt, 'the reserved slot literal must survive (REQ-008)').toBeGreaterThanOrEqual(0)
    expect(src.slice(slotAt, slotAt + 800), 'the mount must live inside the reserved slot element')
      .toContain('<OrkyEntryActions')
    // target construction mirrors the aggregate byte-for-byte (resolved decision #2 / 03-plan
    // TASK-002): the pane's bound root verbatim, the UNIQUE dir slug, the carried reason
    const mount = around(src, '<OrkyEntryActions', 0, 500)
    expect(mount).toMatch(/projectRoot:\s*root\b/)
    expect(mount).toMatch(/featureSlug:\s*f\.slug/)
    expect(mount).toMatch(/reason:\s*f\.status\.reason/)
    // escalationId is CONDITIONALLY supplied (spread) — never hard-set to null/undefined, so the
    // omitted-id rows genuinely OMIT the key and follow the shared honest-refusal bind path
    expect(mount).toContain('escalationId')
    expect(mount).toMatch(/\.\.\.\(/)
    expect(mount).not.toMatch(/escalationId:\s*(null|undefined)/)
    // no fork, no wrap-with-dispatch (REQ-001): the pane file itself never touches an action
    // bridge — orky-entry-actions.tsx stays the single renderer owner (frozen TEST-607)
    expect(src, 'OrkyPane must contain no api.orky reference of its own').not.toContain('api.orky')
    // no pane-side re-derivation of "actionable": the shared component's own mode routing decides
    // per-row affordances — the pane never imports/reimplements the mode router
    expect(src).not.toContain('answerModeFor')
    expect(src).not.toContain('withSingleFlight')
    expect(src).not.toContain('useOrkyEntryActions')
  })
})

describe('escalation-id sourcing — the ALREADY-HELD detail, never a pull, never free text (REQ-002, the structural CONV-033 half)', () => {
  // The COUNT halves of REQ-002 stay where they are frozen: TEST-588 (a supplied escalationId
  // binds AS-IS with ZERO pulls; the structural id beats status.detail free text) and TEST-591
  // (the F10-style target makes exactly ONE pull — the submit-time verification, which is F8
  // REQ-003's race guard and MUST NOT be optimized away). Both MUST pass byte-unchanged.
  it('TEST-625 REQ-002 OrkyPane makes no registryDetail call (and imports no api at all): the escalationId expression selects the FIRST status===\'open\' escalation from the row\'s held f.escalations, filtered to a non-empty string — never fetched, never read from status.detail free text, never fabricated', () => {
    const src = pane()
    // the selection expression (the F10 marker — RED today): array-order first OPEN, off the SAME
    // held array the row already renders (OrkyPane.tsx:201-212), mirroring the shared bind path's
    // own rule (orky-entry-actions-core.ts:155-162 / orky-status.ts:219)
    expect(src).toMatch(/\.escalations\.find\([^)]*status\s*===\s*'open'[^)]*\)/)
    // supplied iff the id is a NON-EMPTY STRING (otherwise omitted — the shared honest-refusal path)
    const sel = around(src, ".status === 'open'", 300, 300)
    expect(sel, 'the id must be filtered to a non-empty string before it may be supplied')
      .toMatch(/typeof\s|!==\s*''|\.length/)
    // zero display-time pulls of the pane's own (REQ-002): no registryDetail, no api import at all —
    // the id comes from orkyPaneDetail[paneId], the detail F9 already fetched
    expect(src, 'OrkyPane must never pull detail for the id — it is already held').not.toContain('registryDetail')
    expect(src, 'OrkyPane needs no api import — every read rides the existing slice').not.toMatch(/from\s*['"](\.\.\/)+api['"]|from\s*['"]\.\.\/api['"]/)
    // never sourced from free text, never guessed: no id extraction over the detail string and no
    // hard-coded escalation id literal
    expect(src).not.toMatch(/detail\.(match|replace|split|indexOf)\(/)
    expect(src).not.toMatch(/ESC-\d/)
  })
})

describe('the inject affordance — F12\'s rooted capture opener, pane-scoped, gesture-tied (REQ-003)', () => {
  it('TEST-626 REQ-003 a native <button data-testid="orky-pane-inject"> in the pane calls openOrkyCapture(root) — the bound root BYTE-VERBATIM — from a gesture handler; honest capture/inject copy (never submitted/saved/written); no capture logic duplicated; the testid trips no frozen TEST-282 locator', () => {
    const src = pane()
    // the affordance exists (the F10 marker — RED today) and is a NATIVE button (the F6
    // FINDING-008 lesson; TEST-606's technique)
    const at = src.indexOf('"orky-pane-inject"')
    expect(at, 'the inject affordance must exist').toBeGreaterThanOrEqual(0)
    expect(src.slice(Math.max(0, at - 300), at), 'orky-pane-inject must be a native <button>').toContain('<button')
    // the gesture calls the store\'s opener with the pane\'s root, bare — byte-verbatim, no
    // re-casing/re-slashing/normalizing (membership validation stays the dispatcher\'s job)
    expect(src).toContain('openOrkyCapture(root)')
    const call = around(src, 'openOrkyCapture(root)', 200, 100)
    expect(call, 'the root must pass through unrewritten').not.toMatch(/toLowerCase|toUpperCase|\.replace\(|normalize\(/)
    // gesture-tied: inline onClick, or a named handler the button references (the useEffect ban is
    // TEST-627\'s half of this pin)
    const gestureTied =
      /onClick=\{[^}]*openOrkyCapture\(root\)/.test(src) ||
      (() => {
        const region = around(src, '"orky-pane-inject"', 400, 400)
        const m = region.match(/onClick=\{\s*(\w+)\s*\}/)
        return m !== null && new RegExp(`${m[1]}\\s*=[^=][\\s\\S]{0,300}?openOrkyCapture\\(root\\)`).test(src)
      })()
    expect(gestureTied, 'openOrkyCapture(root) must be called from the inject gesture handler').toBe(true)
    // honest affordance copy: captures/injects work FOR this project — never a claim that anything
    // was submitted or written by the gesture
    const region = around(src, '"orky-pane-inject"', 100, 500)
    expect(region).toMatch(/capture|inject|work/i)
    expect(region).not.toMatch(/submitted|saved|written/i)
    // zero capture logic duplicated (REQ-003): the modal stays app-hosted; the form/submit flow is
    // OrkyCaptureModal\'s alone — and no client-side guard is added around the slice\'s shipped
    // reference-stable reopen no-op
    expect(src).not.toContain('OrkyCaptureModal')
    expect(src).not.toContain('orkySubmitWork')
    expect(src).not.toContain('orkyCaptureRequest')
    // frozen TEST-282 safety: no F10 testid in this file contains the banned substrings
    for (const m of src.matchAll(/data-testid=\{?["'`]([^"'`]+)["'`]/g)) {
      expect(m[1].toLowerCase()).not.toContain('orky-action')
      expect(m[1].toLowerCase()).not.toContain('orkyaction')
    }
  })
})

describe('scope — composition and wiring ONLY: no new surface, every action gesture-tied (REQ-004)', () => {
  it('TEST-627 REQ-004 the composed OrkyPane adds no write surface of its own (no orkyAction/orkySubmitWork/registry-mutation/CLI/ipcRenderer/commitPane literal), the orkyAction:* channel set stays exactly 0007\'s four, and NO useEffect span references api.orky / openOrkyCapture( / launchTerminalAt( / commitPane — merely mounting dispatches nothing, opens nothing, commits nothing', () => {
    const src = pane()
    // anchor on the F10 composed surface (keeps this guard RED until the composition exists)
    expect(src).toContain('OrkyEntryActions')
    expect(src).toContain('openOrkyCapture(')
    // the literal bans (frozen TEST-433\'s set stays green by construction; these are the
    // F10-specific additions on top of it)
    for (const banned of ['orkyAction', 'orkySubmitWork', 'child_process', 'execFile', 'ipcRenderer',
      'registryAddRoot', 'registryRemoveRoot', 'RegistryMutationResult', 'commitPane', "from 'electron", "from 'node:"]) {
      expect(src, `OrkyPane.tsx must not reference ${banned}`).not.toContain(banned)
    }
    // F10 adds NO IPC surface: the orkyAction:* channel set is still exactly 0007\'s four
    expect((read('src/shared/ipc-contract.ts').match(/'orkyAction:\w+'/g) ?? []).length).toBe(4)
    // gesture-tying (the TEST-599 technique applied to the pane): no effect body may dispatch,
    // open capture, launch a terminal, or commit a pane
    const spans = useEffectSpans(src)
    expect(spans.length, 'the pane still has its one T1/T3 boundary effect').toBeGreaterThanOrEqual(1)
    for (const span of spans) {
      for (const banned of ['api.orky', 'openOrkyCapture(', 'launchTerminalAt(', 'commitPane']) {
        expect(span, `a useEffect body must never reach ${banned} — every write is gesture-tied`).not.toContain(banned)
      }
    }
  })
})

describe('the F9 read contract survives the composition (REQ-008)', () => {
  it('TEST-628 REQ-008 with the actions mounted, the pane adds NO new fetch trigger (exactly one fetchOrkyDetail call site) and no clock/poll (no Date.now/new Date(/setInterval in OrkyPane.tsx or orky-pane-slice.ts); rows still key/identify on the unique dir slug and the slot literal survives', () => {
    const src = pane()
    // anchor on the F10 mount (RED until it exists)
    expect(src).toContain('<OrkyEntryActions')
    // T1/T2/T3 discipline unchanged: the ONE existing bind-boundary fetch call site, and no
    // clock/poll sneaks in with the composition (the frozen TEST-430 bans, re-held over the
    // post-F10 file so a violating diff fails HERE, not only at the frozen guard)
    expect(src.split('fetchOrkyDetail(').length - 1, 'exactly one fetch call site — F10 adds no trigger').toBe(1)
    for (const rel of [PANE, 'src/renderer/store/orky-pane-slice.ts']) {
      const s = read(rel)
      expect(s, `${rel} must not read a clock`).not.toMatch(/Date\.now\(|new Date\(/)
      expect(s, `${rel} must not poll`).not.toMatch(/setInterval/)
    }
    // row identity/keying is untouched (F9 REQ-012): render key and data-feature still the dir slug
    expect(src).toMatch(/key=\{f\.slug\}/)
    expect(src).toContain('data-feature={f.slug}')
    expect(src).toContain('data-project-root={root}')
    expect(src).toContain('orky-pane-row-actions')
    expect(src).toContain('data-escalation-id')
  })
})

describe('tile-context UX — no drawer assumption, isolation intact, visible focus (REQ-007)', () => {
  it('TEST-629 REQ-007 the populated slot region carries no fixed pixel width (the tile is not the 340px drawer); the feature-row element gains no unguarded pointer handler (CONV-041 rides the shared stopPropagation boundary, which survives); the orky-pane :focus-visible rule still covers every button — the inject affordance included by construction — and never outline:none', () => {
    const src = pane()
    // anchor on the populated slot (RED until the mount exists)
    const slotRegion = around(src, 'data-testid="orky-pane-row-actions"', 100, 600)
    expect(slotRegion).toContain('<OrkyEntryActions')
    // no fixed-width/drawer-specific assumption introduced on the slot/region (case-sensitive
    // `width:` deliberately misses the pre-existing minWidth: 0 flex guards)
    expect(slotRegion).not.toMatch(/width:\s*['"]?\d+/)
    expect(slotRegion).not.toContain('340')
    // the feature-row element itself carries no pointer-activation handler — an action click can
    // never double as a host gesture (CONV-041; the shared region\'s own boundary is pinned below)
    const rowAt = src.indexOf('data-testid="orky-pane-feature"')
    expect(rowAt).toBeGreaterThanOrEqual(0)
    const rowTag = src.slice(src.lastIndexOf('<', rowAt), src.indexOf('>', rowAt))
    expect(rowTag, 'the feature row must not gain an unguarded row-level pointer handler').not.toMatch(/onClick|onPointerDown|onMouseDown/)
    // the shared region\'s stopPropagation boundary survives — F10 must not strip it
    const shared = read('src/renderer/components/orky-entry-actions.tsx')
    expect(shared, 'the CONV-041 boundary lives in the shared region and must survive').toContain('stopPropagation')
    // CONV-007: the orky-pane-scoped :focus-visible rule (TEST-438\'s) still exists, covers
    // buttons (the inject button and the mounted dq-action controls ride it by construction),
    // and never outline:none
    const css = read('src/renderer/index.css')
    const blocks = css.split('}').filter(b => b.includes(':focus-visible') && b.includes('orky-pane'))
    expect(blocks.length, 'a :focus-visible rule must cover the orky-pane chrome').toBeGreaterThan(0)
    expect(blocks.some(b => b.includes('button')), 'the rule must cover buttons (the inject affordance rides it)').toBe(true)
    for (const b of blocks) {
      expect(b).toMatch(/outline/)
      expect(b).not.toMatch(/outline:\s*none/)
    }
  })
})
