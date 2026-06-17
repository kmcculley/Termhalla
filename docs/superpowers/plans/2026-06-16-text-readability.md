# Text Readability — Contrast Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring text to WCAG AA on every surface — fix white-on-orange alert text (2.29:1) via luminance-adaptive bar text, and clear the marginal recording/error reds — locked in by a contrast guard test.

**Architecture:** A pure `@shared/contrast.ts` (`relativeLuminance`/`contrastRatio`/`readableOn`) backs everything. `themeCssVars`/`themeCssVarsPartial` emit `--on-busy`/`--on-needs` derived text colors at every theme scope (no component wiring needed — ThemeProvider and the override sites already iterate those). `index.css` points the alert-bar titles at the vars; two hardcoded reds move to clear-AA values.

**Tech Stack:** TS + CSS custom properties; vitest (unit), Playwright-for-Electron (e2e).

---

## File Structure

- `src/shared/contrast.ts` — **new** — pure luminance/ratio/readable-text helpers.
- `src/shared/theme.ts` — emit `--on-busy`/`--on-needs` from `themeCssVars` + `themeCssVarsPartial`.
- `src/renderer/index.css` — alert-bar titles use the adaptive vars (drop dark text-shadow).
- `src/renderer/components/PaneToolbar.tsx` — recording red → `#ff6b6b`.
- `src/renderer/components/EnvSettings.tsx` — error red → `#ff6b6b` (drop the bogus var).
- Tests: `tests/contrast.test.ts`, `tests/theme-contrast.test.ts` (new), `tests/e2e/status.spec.ts` (extend).

---

### Task 1: Pure contrast module

**Files:**
- Create: `src/shared/contrast.ts`
- Test: `tests/contrast.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/contrast.test.ts
import { describe, it, expect } from 'vitest'
import { relativeLuminance, contrastRatio, readableOn } from '../src/shared/contrast'

describe('contrast', () => {
  it('relativeLuminance: black 0, white 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
  it('contrastRatio: white/black is 21, symmetric', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })
  it('parses 3-digit hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1)
  })
  it('readableOn: dark text on bright bars, light text on dark bg', () => {
    expect(readableOn('#ff8f00')).toBe('#182026') // orange → dark
    expect(readableOn('#1e88e5')).toBe('#182026') // busy blue → dark
    expect(readableOn('#1e1e1e')).toBe('#ffffff') // near-black → white
  })
  it('readableOn honors custom dark/light tokens', () => {
    expect(readableOn('#ffffff', 'D', 'L')).toBe('D')
    expect(readableOn('#000000', 'D', 'L')).toBe('L')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- contrast`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/shared/contrast.ts
/** WCAG contrast helpers (sRGB). Pure — used to derive readable text colors and to guard
 *  the default theme against contrast regressions. */

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

const toLinear = (c: number): number => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a hex color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b)
  const hi = Math.max(la, lb), lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** Black-or-white (or custom dark/light) text for a background, by the WCAG luminance
 *  crossover (L > 0.179 → dark gives more contrast). */
export function readableOn(bgHex: string, dark = '#182026', light = '#ffffff'): string {
  return relativeLuminance(bgHex) > 0.179 ? dark : light
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- contrast && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/contrast.ts tests/contrast.test.ts
git commit -m "feat(shared): pure WCAG contrast + readable-text helpers"
```

---

### Task 2: Emit adaptive `--on-busy`/`--on-needs` vars

**Files:**
- Modify: `src/shared/theme.ts`
- Test: `tests/theme-contrast.test.ts`

- [ ] **Step 1: Write the failing guard test**

```ts
// tests/theme-contrast.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, themeCssVars, themeCssVarsPartial } from '../src/shared/theme'
import { contrastRatio, readableOn } from '../src/shared/contrast'

const t = DEFAULT_THEME

describe('default theme readability (WCAG AA)', () => {
  it('body + dim text clear 4.5:1 on both backgrounds', () => {
    for (const bg of [t.windowBg, t.elevatedBg]) {
      expect(contrastRatio(t.text, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(t.textDim, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('adaptive alert-bar text is readable (needs 4.5, busy 3.0 bold-title)', () => {
    expect(contrastRatio(readableOn(t.statusNeedsInput), t.statusNeedsInput)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(readableOn(t.statusBusy), t.statusBusy)).toBeGreaterThanOrEqual(3.0)
  })
  it('themeCssVars exposes the derived on-colors', () => {
    const v = themeCssVars(t)
    expect(v['--on-busy']).toBe(readableOn(t.statusBusy))
    expect(v['--on-needs']).toBe(readableOn(t.statusNeedsInput))
  })
  it('themeCssVarsPartial emits an on-color only when its status color is overridden', () => {
    expect(themeCssVarsPartial({ statusNeedsInput: '#ffffff' })['--on-needs']).toBe('#182026')
    expect('--on-needs' in themeCssVarsPartial({ accent: '#123456' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- theme-contrast`
Expected: FAIL — `--on-busy`/`--on-needs` undefined.

- [ ] **Step 3: Emit the vars in `themeCssVars`**

In `src/shared/theme.ts`, add the import and extend `themeCssVars`:

```ts
import { readableOn } from './contrast'
```

In the object returned by `themeCssVars(t)`, after `'--status-needs': t.statusNeedsInput,` add:

```ts
    '--on-busy': readableOn(t.statusBusy),
    '--on-needs': readableOn(t.statusNeedsInput),
```

- [ ] **Step 4: Emit them in `themeCssVarsPartial`**

In `themeCssVarsPartial`, after the `for` loop that fills `out`, before `return out`:

```ts
  if (partial.statusBusy !== undefined) out['--on-busy'] = readableOn(partial.statusBusy)
  if (partial.statusNeedsInput !== undefined) out['--on-needs'] = readableOn(partial.statusNeedsInput)
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- theme-contrast && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/theme.ts tests/theme-contrast.test.ts
git commit -m "feat(theme): derive readable --on-busy/--on-needs alert-text vars at every scope"
```

---

### Task 3: Alert-bar titles use the adaptive vars

**Files:**
- Modify: `src/renderer/index.css`

- [ ] **Step 1: Split the busy/needs title rule**

In `src/renderer/index.css`, replace the combined rule:

```css
.mosaic-blueprint-theme .mosaic-window.term-busy .mosaic-window-title,
.mosaic-blueprint-theme .mosaic-window.term-needs-input .mosaic-window-title {
  color: #fff !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
```

with (per-state adaptive color; the dark text-shadow is dropped since the text is now
dark-on-bright):

```css
.mosaic-blueprint-theme .mosaic-window.term-busy .mosaic-window-title {
  color: var(--on-busy, #fff) !important;
}
.mosaic-blueprint-theme .mosaic-window.term-needs-input .mosaic-window-title {
  color: var(--on-needs, #fff) !important;
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.css
git commit -m "feat(renderer): readable adaptive text on busy/needs-input alert bars"
```

---

### Task 4: Clear-AA recording + error reds

**Files:**
- Modify: `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/EnvSettings.tsx`

- [ ] **Step 1: Recording red**

In `PaneToolbar.tsx`, the recording button:

```tsx
            style={{ color: recording ? '#ff6b6b' : undefined }}
```

(was `'#e53935'`.)

- [ ] **Step 2: Env error red (and drop the bogus var)**

In `EnvSettings.tsx`, the unlock-error line:

```tsx
            {error && <div data-testid="env-error" style={{ color: '#ff6b6b' }}>Incorrect passphrase</div>}
```

(was `color: 'var(--status-needs-input, #e55)'` — a var name that doesn't exist.)

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/renderer/components/PaneToolbar.tsx src/renderer/components/EnvSettings.tsx
git commit -m "fix(renderer): clear-AA recording + env-error reds"
```

---

### Task 5: e2e — needs-input title is dark, not white

**Files:**
- Modify: `tests/e2e/status.spec.ts`

- [ ] **Step 1: Inspect the existing needs-input test**

`status.spec.ts` already has a test that drives a y/N prompt and asserts
`[data-status="needs-input"]` appears with a tab badge. Add a color assertion to it (or a
sibling assertion right after the needs-input state is detected): the active window's
`.mosaic-window.term-needs-input .mosaic-window-title` computed `color` must be the dark
adaptive color (rgb(24, 32, 38) = `#182026`), not white.

```ts
  const titleColor = await win.locator('.mosaic-window.term-needs-input .mosaic-window-title')
    .first()
    .evaluate(el => {
      const g = globalThis as unknown as { getComputedStyle(e: unknown): { color: string } }
      return g.getComputedStyle(el).color
    })
  expect(titleColor).toBe('rgb(24, 32, 38)') // #182026, the readable dark — NOT white
```

Place this after the existing `await expect(win.locator('[data-status="needs-input"]'))…`
assertion so the needs-input state is already on screen.

- [ ] **Step 2: Build + run**

Run: `npm run build && npm run e2e -- status.spec.ts`
Expected: pass (terminal-spawn specs may flake under load and recover on retry — the
config carries that).

- [ ] **Step 3: Full verification (read exit codes directly)**

Run: `npm run typecheck`
Then: `npm test`
Then: `npm run build && npm run e2e -- status.spec.ts`
Expected: typecheck exit 0; all unit pass (incl. `contrast`, `theme-contrast`); status
spec green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/status.spec.ts
git commit -m "test(e2e): needs-input alert-bar title uses the readable dark color"
```

---

### Task 6: Docs

**Files:**
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-06-16-text-readability-design.md`, `docs/features/theming.md`

- [ ] **Step 1: Changelog**

Under `## [Unreleased]` → `### Fixed`:

```markdown
- **Text readability (WCAG AA).** The needs-input (orange) and busy (blue) alert bars now
  pick black-or-white title text from the bar colour's luminance instead of forcing white
  — fixing white-on-orange (2.29:1 → 7.2:1) and keeping it correct for any custom alert
  colour (a derived `--on-busy`/`--on-needs` var computed at every theme scope). The
  recording and env-error reds were brightened to clear 4.5:1, and a `--status-needs-input`
  typo in the env-error colour (a non-existent var) was fixed. A unit guard pins the
  default theme's text/background pairs to AA so future token edits can't regress them.
```

- [ ] **Step 2: Mark spec implemented**

Change the spec's `**Status:** Design — pending review` to `**Status:** Implemented`.

- [ ] **Step 3: Feature-doc note**

In `docs/features/theming.md`, add a sentence under the relevant section: alert-bar title
text is derived (`readableOn` in `@shared/contrast.ts` → `--on-busy`/`--on-needs`) rather
than fixed white, so readability holds for any user-chosen `statusBusy`/`statusNeedsInput`.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/
git commit -m "docs: changelog + spec status + theming note for the readability pass"
```

---

## Self-Review

**Spec coverage:** contrast module ✓(T1), adaptive `--on-*` at app + override scope ✓(T2),
alert-bar CSS ✓(T3), recording-red + env-error (and the bogus-var fix) ✓(T4), e2e
needs-input dark title ✓(T5), contrast guard test ✓(T2), docs ✓(T6). Accent left unchanged
by design (guard covers real usage). All covered.

**Placeholder scan:** every code step shows full code; the e2e step gives the exact
selector + expected `rgb(24, 32, 38)`. No TODO/vague gaps.

**Type consistency:** `readableOn`/`contrastRatio`/`relativeLuminance` defined T1, imported
in T2 (theme) + the guard test. `--on-busy`/`--on-needs` produced T2, consumed in CSS T3.
`#ff6b6b` used consistently for both reds T4 and asserted ≥4.5 in the T2 guard. `#182026`
(readableOn default dark) matches the e2e `rgb(24, 32, 38)` assertion T5. Consistent.
