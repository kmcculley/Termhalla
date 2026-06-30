// FROZEN unit suite — feature 0004-orky-status-awareness (phase 4 / REQ-026 selector escaping).
// The popover builds a `document.querySelector('[data-testid="orky-chip-<paneId>"]')` to anchor itself
// under the source chip. A pane id containing a CSS-reserved character (`"`, `]`, `\`, …) would throw a
// `DOMException: SyntaxError` out of the positioning effect and blank the popover (FINDING-SEC-005). The
// id MUST be escaped with `CSS.escape(...)`, and the code MUST NOT depend on the undocumented invariant
// that pane ids are UUIDs.
//
// The unit harness runs under the `node` vitest environment (no jsdom / no DOM `CSS.escape` global and no
// `@testing-library/react`), so this pins the mitigation at the source: the selector is interpolated via
// `CSS.escape(paneId)`, never the raw id. Runs RED against the prior pass (raw `${paneId}` interpolation).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = readFileSync(resolve(process.cwd(), 'src/renderer/components/OrkyPopover.tsx'), 'utf8')

describe('OrkyPopover selector escaping (REQ-026)', () => {
  it('TEST-050 REQ-026 interpolates the pane id into the querySelector via CSS.escape, never raw', () => {
    // the escaped form must be present
    expect(SRC).toMatch(/CSS\.escape\(\s*paneId\s*\)/)
    // and the raw, unescaped interpolation inside a querySelector attribute selector must be gone
    expect(SRC).not.toMatch(/orky-chip-\$\{\s*paneId\s*\}/)
  })
})
