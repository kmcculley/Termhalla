// 0002 ledger FINDING-SEC-001 (deferred, fixed 2026-07-07): SplitMenu anchors itself via
// `document.querySelector('[data-testid="split-<paneId>"]')` — the same selector-interpolation
// class OrkyPopover fixed under 0004 FINDING-SEC-005. A pane id containing a CSS-reserved
// character would throw a DOMException out of the positioning effect and blank the popover; the
// id MUST be escaped with `CSS.escape(...)`, never interpolated raw (no reliance on the
// undocumented pane-ids-are-UUIDs invariant).
//
// Structural source pin (the orky-popover-escape.test.ts pattern — node env, no jsdom).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = readFileSync(resolve(process.cwd(), 'src/renderer/components/SplitMenu.tsx'), 'utf8')

describe('SplitMenu selector escaping (0002 FINDING-SEC-001)', () => {
  it('interpolates the pane id into the querySelector via CSS.escape, never raw', () => {
    expect(SRC).toMatch(/CSS\.escape\(\s*paneId\s*\)/)
    expect(SRC).not.toMatch(/split-\$\{\s*paneId\s*\}/)
  })
})
