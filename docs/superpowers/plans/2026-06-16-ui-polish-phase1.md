# UI Polish Phase 1 — Design-token Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every hardcoded design literal in the renderer through a single derived-token layer, adding modal/popover depth, ellipsis, themed explorer scrollbar, and a tab focus ring — no behavior change.

**Architecture:** New static/derived CSS tokens live in `:root` in `index.css` (derived from existing user tokens via `color-mix()`, so they track the theme without touching the persisted `Theme` type). JS-numeric tokens that CSS can't express live in a new tiny `src/renderer/ui-tokens.ts`. Per-component inline styles are repointed at the tokens. A unit guard test asserts the banned literals are gone; e2e re-confirms the Monaco-layout gotcha.

**Tech Stack:** React + inline styles + CSS custom properties; vitest (unit), Playwright-for-Electron (e2e).

---

## File Structure

- `src/renderer/index.css` — add `:root` token block, `@keyframes ui-pop-in`, `.ui-pop-in` class, `.mosaic-window-title` ellipsis, explorer scrollbar entry, tab focus-ring. (bulk of CSS)
- `src/renderer/ui-tokens.ts` — **new** — JS-numeric tokens (`INDENT_PX`).
- `src/renderer/components/Modal.tsx` — shadows on `CARD_BASE`/`SURFACE`; pop-in.
- `src/renderer/components/CommandPalette.tsx` — `--sel-bg`, drop inline shadow.
- `src/renderer/components/EditorPane.tsx` — `--fg-dim` / `--warn-bg` / `--warn-fg`.
- `src/renderer/components/StatusBar.tsx` — `--fg-dim`, `--mono`.
- `src/renderer/components/{ProcessPopover,BroadcastDialog,ScheduleDialog,ExplorerPane,EnvManager}.tsx` — `--mono`, dim-text, `INDENT_PX`.
- `tests/ui-no-hardcoded-literals.test.ts` — **new** — guard.
- `tests/ui-tokens.test.ts` — **new** — `INDENT_PX` unit.
- `tests/e2e/ui-polish.spec.ts` — **new** — computed-style + Monaco regression.

---

### Task 1: Derived-token layer + JS-numeric tokens

**Files:**
- Modify: `src/renderer/index.css:1` (insert `:root` block at top)
- Create: `src/renderer/ui-tokens.ts`
- Test: `tests/ui-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui-tokens.test.ts
import { describe, it, expect } from 'vitest'
import { INDENT_PX } from '../src/renderer/ui-tokens'

describe('ui-tokens', () => {
  it('exports a numeric indent step', () => {
    expect(typeof INDENT_PX).toBe('number')
    expect(INDENT_PX).toBe(14)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ui-tokens`
Expected: FAIL — cannot find module `../src/renderer/ui-tokens`.

- [ ] **Step 3: Create the tokens module**

```ts
// src/renderer/ui-tokens.ts
/** JS-numeric design tokens for values CSS custom properties can't express
 *  (computed `paddingLeft` etc.). Visual/paint tokens live in index.css :root. */

/** Per-depth indentation step for tree views (process tree, explorer). */
export const INDENT_PX = 14
```

- [ ] **Step 4: Add the `:root` token block at the very top of `index.css`**

Insert before line 1 (`html, body, #root …`):

```css
/* Derived/static design tokens. Not user-editable (those live in the Theme type);
   these are computed once here and tracked off the user tokens via color-mix so they
   restyle with the theme. Each carries the legacy literal as a fallback. */
:root {
  --mono: 'Consolas', 'Cascadia Mono', monospace;
  --radius: 4px;
  --radius-lg: 6px;
  --shadow-pop: 0 4px 16px rgba(0, 0, 0, 0.4);
  --shadow-modal: 0 8px 32px rgba(0, 0, 0, 0.5);
  --sel-bg: color-mix(in srgb, var(--accent, #1e88e5) 32%, transparent);
  --warn-bg: color-mix(in srgb, var(--status-needs, #ff8f00) 30%, var(--elevated, #252526));
  --warn-fg: var(--fg, #eee);
  --dim: 0.7;
  --dimmer: 0.5;
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm test -- ui-tokens && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui-tokens.ts tests/ui-tokens.test.ts src/renderer/index.css
git commit -m "feat(renderer): derived design-token layer (:root tokens + ui-tokens.ts)"
```

---

### Task 2: Replace banned color/font literals (guard-test anchored)

**Files:**
- Test: `tests/ui-no-hardcoded-literals.test.ts` (create)
- Modify: `src/renderer/components/CommandPalette.tsx:64,83`
- Modify: `src/renderer/components/EditorPane.tsx:23,25`
- Modify: `src/renderer/components/StatusBar.tsx:22,35`
- Modify: `src/renderer/components/ProcessPopover.tsx:33`
- Modify: `src/renderer/components/BroadcastDialog.tsx:35`
- Modify: `src/renderer/components/ScheduleDialog.tsx:43,75`
- Modify: `src/renderer/components/ExplorerPane.tsx:78`
- Modify: `src/renderer/components/EnvManager.tsx:16,115`

- [ ] **Step 1: Write the failing guard test**

```ts
// tests/ui-no-hardcoded-literals.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, '../src/renderer/components')
const BANNED = ["#094771", "#5a4a00", "#bbb", "'Consolas, monospace'", '"Consolas, monospace"']

describe('no hardcoded design literals in renderer components', () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.tsx'))
  for (const f of files) {
    it(`${f} uses tokens, not banned literals`, () => {
      const src = readFileSync(join(DIR, f), 'utf8')
      for (const lit of BANNED) expect(src, `${f} contains ${lit}`).not.toContain(lit)
    })
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ui-no-hardcoded-literals`
Expected: FAIL — `CommandPalette.tsx contains #094771`, plus the EditorPane/StatusBar/Consolas hits.

- [ ] **Step 3: CommandPalette — `--sel-bg` + drop inline modal shadow**

In `src/renderer/components/CommandPalette.tsx`, line 64 change
`card={{ width: 560, maxHeight: '60vh', gap: 0, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>`
to:

```tsx
      card={{ width: 560, maxHeight: '60vh', gap: 0 }}>
```

Line 83 change `background: i === clampedSel ? '#094771' : 'transparent' }}>` to:

```tsx
                  cursor: 'pointer', background: i === clampedSel ? 'var(--sel-bg)' : 'transparent' }}>
```

- [ ] **Step 4: EditorPane — `--fg-dim` + warn tokens**

In `src/renderer/components/EditorPane.tsx`, line 23 change `style={{ color: '#bbb', padding: 8 }}` to:

```tsx
      {activeTab?.tooLarge && <div data-testid="editor-toolarge" style={{ color: 'var(--fg-dim, #aaa)', padding: 8 }}>File too large to open.</div>}
```

Line 25 change `style={{ background: '#5a4a00', color: '#fff', padding: '2px 8px', display: 'flex', gap: 8 }}>` to:

```tsx
        <div data-testid="editor-reloadbar" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)', padding: '2px 8px', display: 'flex', gap: 8 }}>
```

- [ ] **Step 5: StatusBar — `--fg-dim` + `--mono`**

In `src/renderer/components/StatusBar.tsx`, line 22 change `color: '#bbb', minHeight: 22` to `color: 'var(--fg-dim, #aaa)', minHeight: 22`. Line 35 change `fontFamily: 'Consolas, monospace'` to `fontFamily: 'var(--mono)'`.

- [ ] **Step 6: Remaining `'Consolas, monospace'` → `var(--mono)`**

Replace `fontFamily: 'Consolas, monospace'` with `fontFamily: 'var(--mono)'` in:
`ProcessPopover.tsx:33`, `BroadcastDialog.tsx:35`, `ScheduleDialog.tsx:43`, `ScheduleDialog.tsx:75`, `ExplorerPane.tsx:78`.
Replace `fontFamily: 'monospace'` with `fontFamily: 'var(--mono)'` in `EnvManager.tsx:16` and `EnvManager.tsx:115`.

- [ ] **Step 7: Run guard test + typecheck**

Run: `npm test -- ui-no-hardcoded-literals && npm run typecheck`
Expected: PASS for every component file; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add tests/ui-no-hardcoded-literals.test.ts src/renderer/components/
git commit -m "refactor(renderer): replace hardcoded color/font literals with design tokens"
```

---

### Task 3: Dim-text → `--fg-dim`, indent constant

**Files:**
- Modify: `src/renderer/components/ProcessPopover.tsx:38,43,46,47,48`
- Modify: `src/renderer/components/ExplorerPane.tsx` (tree indent)
- Modify: `src/renderer/components/{TemplatesMenu,BroadcastDialog,CommandPalette,SshConnectionForm,StatusBar}.tsx` (pure-text dim spans)

- [ ] **Step 1: ProcessPopover — indent constant + dim text**

In `src/renderer/components/ProcessPopover.tsx`, add to the imports at top:

```tsx
import { INDENT_PX } from '../ui-tokens'
```

Line 46 change `paddingLeft: n.depth * 14` to `paddingLeft: n.depth * INDENT_PX`.
Line 38 `style={{ opacity: 0.7 }}` and line 47 `style={{ opacity: 0.7 }}` → `style={{ color: 'var(--fg-dim, #aaa)' }}`.
Line 43 `style={{ opacity: 0.6 }}` → `style={{ color: 'var(--fg-dim, #aaa)' }}`.
Line 48 (command layered after name) keep as opacity but tokenize: `style={{ opacity: 'var(--dimmer)' }}`.

- [ ] **Step 2: ExplorerPane — indent constant**

In `src/renderer/components/ExplorerPane.tsx`, add `import { INDENT_PX } from '../ui-tokens'` and replace the tree row's `paddingLeft` magic indent (the `depth * <n>` expression) with `depth * INDENT_PX`. (Search the file for `paddingLeft`/`depth *`; if it currently uses a different multiplier, standardize to `INDENT_PX`.)

- [ ] **Step 3: Pure-text dim spans → `--fg-dim`**

Convert these pure secondary-text spans from `opacity:` to `color: 'var(--fg-dim, #aaa)'`:
`TemplatesMenu.tsx:22`, `BroadcastDialog.tsx:37,54`, `CommandPalette.tsx:71,85`, `SshConnectionForm.tsx:52`, `StatusBar.tsx:23,38,42`.
(Leave any span that layers opacity over already-colored content; those stay `opacity: 'var(--dim)'`.)

- [ ] **Step 4: Run typecheck + unit suite**

Run: `npm run typecheck && npm test`
Expected: PASS — including `ui-tokens` and `ui-no-hardcoded-literals`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ src/renderer/ui-tokens.ts
git commit -m "refactor(renderer): tokenize dim text and tree indentation"
```

---

### Task 4: Modal/popover depth + pop-in transition

**Files:**
- Modify: `src/renderer/components/Modal.tsx:20-29` (SURFACE / CARD_BASE)
- Modify: `src/renderer/index.css` (append keyframes + `.ui-pop-in`)

- [ ] **Step 1: Add shadows to SURFACE and CARD_BASE**

In `src/renderer/components/Modal.tsx`, change `SURFACE` (lines 20-23) to include the popover shadow:

```tsx
export const SURFACE: CSSProperties = {
  background: 'var(--elevated, #252526)', color: 'var(--fg, #eee)',
  border: '1px solid var(--border, #444)', borderRadius: 4,
  boxShadow: 'var(--shadow-pop)'
}
```

Change `CARD_BASE` (lines 26-29) to include the modal shadow:

```tsx
const CARD_BASE: CSSProperties = {
  ...SURFACE, borderRadius: 6, boxShadow: 'var(--shadow-modal)',
  display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--font-size, 13px)'
}
```

- [ ] **Step 2: Apply the pop-in class to the modal card**

In `Modal.tsx`, the card `<div>` (line 57) — add `className="ui-pop-in"`:

```tsx
      <div data-testid={cardTestId} className="ui-pop-in" onClick={e => e.stopPropagation()} {...cardProps} style={{ ...CARD_BASE, ...card }}>
```

- [ ] **Step 3: Append keyframes + class to `index.css`**

At the end of `src/renderer/index.css`:

```css
/* Subtle entrance for modal cards / popovers. Reduced-motion users get opacity only. */
@keyframes ui-pop-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ui-pop-in { animation: ui-pop-in 120ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .ui-pop-in { animation: none; }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Modal.tsx src/renderer/index.css
git commit -m "feat(renderer): modal/popover drop-shadows + reduced-motion-safe pop-in"
```

---

### Task 5: index.css — title ellipsis, explorer scrollbar, tab focus ring

**Files:**
- Modify: `src/renderer/index.css` (mosaic title; scrollbar `:is(...)` lists at 172-179; new tab focus-ring selector)

- [ ] **Step 1: Ellipsis on mosaic window titles**

After the idle-title rule (around line 52) add:

```css
/* Long pane titles truncate instead of shoving toolbar buttons off the bar. */
.mosaic-blueprint-theme .mosaic-window-title {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
```

- [ ] **Step 2: Add explorer to the themed-scrollbar lists**

In `index.css` lines 172-178, add `[data-testid^="explorer-"]` to each of the two `:is(…)` lists (the `::-webkit-scrollbar` width rule and the `-thumb` rule). Resulting lists read:

```css
:is([data-testid="env-manager"], [data-testid="theme-editor"], [data-testid="proc-menu"],
   [data-testid="command-palette-backdrop"], [data-testid="templates-menu"], [data-testid^="explorer-"])::-webkit-scrollbar,
```

(apply the same `, [data-testid^="explorer-"]` addition to all three `:is(...)` occurrences in that block).

- [ ] **Step 3: Tab focus ring (visual only — no nav logic)**

Append:

```css
/* Visual keyboard focus ring on workspace tabs (movement logic is a later phase). */
[data-testid="workspace-tabs"] [data-testid^="tab-"]:focus-visible {
  outline: 2px solid var(--accent, #1e88e5); outline-offset: -2px;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.css
git commit -m "feat(renderer): pane-title ellipsis, explorer scrollbar, tab focus ring"
```

---

### Task 6: e2e — computed-style assertions + Monaco regression

**Files:**
- Create: `tests/e2e/ui-polish.spec.ts`

- [ ] **Step 1: Build (e2e runs against `out/`)**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 2: Write the e2e spec**

Model the launch/boilerplate on the nearest existing spec (`tests/e2e/editor.spec.ts`) — reuse its app-launch helper and selectors. The three assertions:

```ts
import { test, expect } from '@playwright/test'
// reuse the launch helper pattern from editor.spec.ts (electron.launch on out/…)

test('command palette card has a drop shadow', async () => {
  // open palette (Ctrl+K), then:
  const card = page.getByTestId('command-palette')
  const shadow = await card.evaluate(el => getComputedStyle(el).boxShadow)
  expect(shadow).not.toBe('none')
})

test('palette selected item background tracks the accent, not #094771', async () => {
  // type a query that yields >=1 item; first item is selected by default
  const item = page.getByTestId('palette-item-0')
  const bg = await item.evaluate(el => getComputedStyle(el).backgroundColor)
  // old literal #094771 == rgb(9, 71, 113). Accent-derived must differ.
  expect(bg).not.toBe('rgb(9, 71, 113)')
  expect(bg).not.toBe('rgba(0, 0, 0, 0)') // and it IS highlighted
})

test('editor renders the correct file after a model switch (Monaco-layout regression)', async () => {
  // open two files in an editor pane, switch tabs, assert .view-lines shows
  // the second file's content (guards the .mosaic-window-title ellipsis change).
})
```

Fill the launch helper + open-file/open-palette steps by copying the established
patterns in `editor.spec.ts`; do not invent new helpers.

- [ ] **Step 3: Run the e2e spec**

Run: `npm run e2e -- ui-polish`
Expected: 3 passing.

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npm test && npm run build && npm run e2e`
Expected: all green. If `editor.spec.ts` fails, the `.mosaic-window-title` rule perturbed Monaco — revert Step 1 of Task 5 and reconsider.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ui-polish.spec.ts
git commit -m "test(e2e): UI-polish computed-style + Monaco-layout regression"
```

---

### Task 7: Docs

**Files:**
- Modify: `CHANGELOG.md` (Unreleased → Changed)
- Modify: `docs/superpowers/specs/2026-06-16-ui-polish-phase1-design.md` (mark Status: Implemented)

- [ ] **Step 1: Changelog entry**

Under `## [Unreleased]` → `### Changed`, add:

```markdown
- **UI polish (phase 1) — design-token foundation.** Hardcoded colors/fonts
  (`#094771` palette selection, `#5a4a00`/`#bbb` editor bars, 8× `Consolas`
  literals) now route through derived `:root` tokens (`--mono`, `--sel-bg`,
  `--warn-bg`, `--shadow-*`) that track the active theme. Modals/popovers gain
  drop-shadows and a reduced-motion-safe pop-in; long pane titles ellipsize; the
  file explorer gets themed scrollbars; workspace tabs show a keyboard focus ring.
  No behavior change.
```

- [ ] **Step 2: Mark spec implemented**

Change the spec's `**Status:** Design — pending review` to `**Status:** Implemented`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-06-16-ui-polish-phase1-design.md
git commit -m "docs: changelog + spec status for UI polish phase 1"
```

---

## Self-Review

**Spec coverage:** sel-bg ✓(T2), warn bars ✓(T2), `--mono` ✓(T2), dim-text ✓(T3),
`--fg-dim` ✓(T2/T3), shadows ✓(T4), pop-in + reduced-motion ✓(T4), ellipsis ✓(T5),
explorer scrollbar ✓(T5), tab focus ring ✓(T5), `INDENT_PX`/`ui-tokens.ts` ✓(T1/T3),
guard test ✓(T2), e2e + Monaco regression ✓(T6), no `Theme`/persistence change ✓
(none touched), `color-mix` fallbacks ✓(T1 literals in fallback position). All
covered.

**Placeholder scan:** Task 6 references `editor.spec.ts` patterns rather than
inlining the full Electron launch boilerplate — this is a "match the nearest test"
instruction, not a TODO; the three assertions are spelled out. Acceptable.

**Type consistency:** `INDENT_PX` (number) imported in T3 from the module created in
T1; `--sel-bg`/`--warn-bg`/`--warn-fg`/`--mono`/`--shadow-pop`/`--shadow-modal`/`--dim`/
`--dimmer` all defined in T1 and only referenced afterward. `.ui-pop-in` class
defined in T4 CSS and applied in T4 Modal.tsx. Consistent.
