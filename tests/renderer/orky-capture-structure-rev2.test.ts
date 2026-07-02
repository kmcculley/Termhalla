// FROZEN structural suite — feature 0012-quick-capture-inbox, REVISION 2 (ESC-001 review-gate
// loopback; phase 4 / TASK-012 + the FINDING-008/012/013/017/019/021 repairs). The vitest harness is
// node-env with no jsdom, so — exactly as the rev-1 sibling `orky-capture-structure.test.ts` (which
// stays byte-preserved) — the rev-2 DOM/behavior additions are pinned over LITERAL greppable source
// text. Full RENDER behavior (the per-kind error copy, the failure-clear-on-edit/root-change, the
// close-while-in-flight detached toast) is asserted end-to-end in the extended
// tests/e2e/orky-capture.spec.ts against the REAL (production) tree.
//
// New rev-2 requirements pinned here (all RED against the rev-1 implementation shipped in
// src/renderer/components/OrkyCaptureModal.tsx and src/renderer/components/CommandPalette.tsx):
//   - REQ-002/FINDING-012: the always-visible orky-capture-hint line (the EIGHTH non-error testid).
//   - REQ-002/FINDING-017: the detail textarea max-height bound + the error region overflow clamp.
//   - REQ-014/FINDING-019: the invoke-rejection catch synthesizes the renderer-scoped 'ipc-failure'
//     and assigns NO F7 errorKind literal; ipc-failure renders the INDETERMINATE copy class.
//   - REQ-009/FINDING-013: the detached-outcome path routes a FAILURE through pushToast as an
//     error-kind (never-suppressed) toast.
//   - REQ-001/FINDING-021: the reshaped CommandPalette currentCwd useMemo carries an in-code comment
//     naming TEST-495 / orky-capture-structure so a future revert cannot silently break the frozen
//     locator in another file.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const modal = () => read('src/renderer/components/OrkyCaptureModal.tsx')
const palette = () => read('src/renderer/components/CommandPalette.tsx')

/** The balanced-brace body of the first `catch (...) { … }` in a source string. */
function catchBody(src: string): string {
  const at = src.indexOf('catch')
  if (at === -1) return ''
  const open = src.indexOf('{', at)
  let depth = 0
  let j = open
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(open, j + 1)
}

// Every F7-mapped errorKind literal — a renderer-synthesized verdict must never be byte-identical to
// one of these (REQ-008's keyed-only-on-the-result discipline; REQ-014/FINDING-019).
const F7_ERROR_KINDS = [
  'cli-error', 'cli-timeout', 'cli-unparseable', 'feedback-disabled',
  'root-not-allowed', 'invalid-args', 'feature-not-found', 'orky-cli-not-found', 'unknown-sender'
]

describe('the always-visible keyboard hint (REQ-002, FINDING-012)', () => {
  it('TEST-519 REQ-002 orky-capture-hint is the EIGHTH non-error testid; its static copy is capture-oriented, names both Enter and the mod+Enter chord, and names Esc — discoverable before the first accidental submit', () => {
    const src = modal()
    expect(src, 'the hint line must exist (FINDING-012)').toContain('orky-capture-hint')
    // the eight non-error testids all present (the seven rev-1 + the new hint)
    for (const tid of [
      'orky-capture-title', 'orky-capture-detail', 'orky-capture-target', 'orky-capture-change-root',
      'orky-capture-submit', 'orky-capture-cancel', 'orky-capture-hint'
    ]) expect(src).toContain(tid)
    // the hint's own copy (a window around its testid — static, greppable)
    const at = src.indexOf('orky-capture-hint')
    const region = src.slice(at, at + 360)
    expect(region, 'hint copy must be capture-oriented').toMatch(/captur/i)
    expect(region, 'hint must name Enter').toMatch(/enter/i)
    expect(region, 'hint must name the mod+Enter chord').toMatch(/ctrl|cmd|⌘|meta|\bmod\b/i)
    expect(region, 'hint must name the discard key').toMatch(/esc/i)
  })
})

describe('overflow containment inside the 80vh card (REQ-002, FINDING-017)', () => {
  it('TEST-520 REQ-002 the detail textarea has a max-height bound (the shipped resize:vertical is unbounded) and the error region is scroll-contained (overflowY + a bounded height) so no drag or oversized CLI message pushes the Capture/Cancel row off the card', () => {
    const src = modal()
    // the detail textarea's style must cap its height (a CSS max-height, NOT a length cap — REQ-010)
    const detailAt = src.indexOf('orky-capture-detail')
    const detailStyle = src.slice(detailAt, src.indexOf('/>', detailAt) + 2)
    expect(detailStyle, 'detail textarea must bound its user resize with a max-height').toMatch(/maxHeight/)
    // the error region must scroll-contain a long verbatim CLI message
    const errAt = src.indexOf('orky-capture-error')
    const errRegion = src.slice(errAt, errAt + 500)
    expect(errRegion, 'error region must scroll-contain (overflowY)').toMatch(/overflowY/)
    expect(errRegion, 'error region must carry a bounded height').toMatch(/maxHeight|height/)
  })
})

describe('invoke-rejection is the renderer-scoped INDETERMINATE ipc-failure (REQ-014, FINDING-019)', () => {
  it('TEST-521 REQ-014 the api.orkySubmitWork catch block synthesizes errorKind:"ipc-failure" and assigns NO F7 errorKind literal (a synthesized verdict is never byte-identical to an F7-mapped one)', () => {
    const body = catchBody(modal())
    expect(body, 'the catch must synthesize the renderer-scoped ipc-failure kind').toContain('ipc-failure')
    for (const kind of F7_ERROR_KINDS) {
      expect(body, `the catch must NOT assign the F7 errorKind literal '${kind}'`).not.toContain(`'${kind}'`)
    }
  })

  it('TEST-522 REQ-009 REQ-014 ipc-failure renders the INDETERMINATE copy class — grouped with cli-timeout (may-or-may-not + duplicate warning), never the definite non-capture copy', () => {
    const src = modal()
    expect(src).toContain('ipc-failure')
    // the guard for the indeterminate wording must cover BOTH cli-timeout AND ipc-failure
    const copyAt = src.search(/may (or may not )?have been/i)
    expect(copyAt, 'the indeterminate copy must exist').toBeGreaterThanOrEqual(0)
    const guardWindow = src.slice(Math.max(0, copyAt - 600), copyAt)
    expect(guardWindow, 'the indeterminate branch must handle cli-timeout').toContain('cli-timeout')
    expect(guardWindow, 'ipc-failure must share the indeterminate branch (REQ-014)').toContain('ipc-failure')
    // and ipc-failure must not be routed to the definite copy
    expect(src).toMatch(/duplicate/i)
    expect(src).not.toMatch(/was not captured|failed to capture|did not go through/i)
  })
})

describe('detached in-flight outcome is never dropped (REQ-009, REQ-012, FINDING-013)', () => {
  it('TEST-523 REQ-009 a FAILURE outcome routes through pushToast as an error-kind (never-suppressed) toast — the aliveRef silent-drop is retired', () => {
    const src = modal()
    // the never-suppressed failure signal: pushToast called with the 'error' kind (toasts-slice.ts:20)
    expect(src, 'a detached FAILURE must enqueue an error-kind toast (FINDING-013)')
      .toMatch(/pushToast\([^)]*,\s*['"]error['"]/)
  })
})

describe('the CommandPalette locator-collision comment (REQ-001, FINDING-021)', () => {
  it('TEST-524 REQ-001 the reshaped currentCwd useMemo carries an in-code comment naming TEST-495 / orky-capture-structure so a revert to the early-return cannot silently break the frozen locator', () => {
    const src = palette()
    const memoAt = src.indexOf('const currentCwd = useMemo')
    expect(memoAt, 'the currentCwd useMemo must exist').toBeGreaterThanOrEqual(0)
    const region = src.slice(Math.max(0, memoAt - 400), memoAt + 300)
    expect(region, 'the reshaped useMemo must document the TEST-495 indexOf collision (FINDING-021)')
      .toMatch(/TEST-495|orky-capture-structure/)
  })
})
