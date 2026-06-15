# Scoped (Per-Entity) Theming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Theme the app, a workspace, or a pane independently (overrides resolved app→workspace→pane), make the window background visible, and stop the color-picker lag.

**Architecture:** Theme **overrides** (`Partial<Theme>`) at `quick.theme` / `Workspace.theme` / `PaneConfig.theme`; resolved via `resolveTheme`. Applied via CSS-variable cascade — full app vars on `:root` (ThemeProvider), workspace/pane override vars spread as inline `style` custom-properties on the host/tile elements — plus per-pane xterm/Monaco. The `🎨` editor gains a scope selector and previews live via direct `setProperty` on `input`, committing to the store on `change`.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-scoped-theming-design.md`

---

## Task 1: Pure resolution + partial vars + types

**Files:** Modify `src/shared/theme.ts`, `src/shared/types.ts`; Test `tests/shared/theme.test.ts` (append).

- [ ] **Step 1: Failing test** — append to `tests/shared/theme.test.ts`:
```ts
import { resolveTheme, themeCssVarsPartial } from '../../src/shared/theme'

describe('resolveTheme', () => {
  it('layers app < workspace < pane', () => {
    const r = resolveTheme({ windowBg: '#111111', panelBg: '#222222' }, { panelBg: '#333333' }, { termBg: '#444444' })
    expect(r.windowBg).toBe('#111111')
    expect(r.panelBg).toBe('#333333')   // workspace overrides app
    expect(r.termBg).toBe('#444444')    // pane overrides
    expect(r.text).toBe(DEFAULT_THEME.text) // unset → default
  })
  it('handles all-undefined', () => {
    expect(resolveTheme(undefined, undefined, undefined)).toEqual(DEFAULT_THEME)
  })
})

describe('themeCssVarsPartial', () => {
  it('maps only present tokens (px on sizes)', () => {
    const v = themeCssVarsPartial({ panelBg: '#abcdef', fontSize: 18 })
    expect(v).toEqual({ '--panel': '#abcdef', '--font-size': '18px' })
  })
})
```
(`DEFAULT_THEME` is already imported at the top of the file.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — append to `src/shared/theme.ts`:
```ts
/** Effective theme for a pane: app < workspace < pane overrides. */
export function resolveTheme(app: Partial<Theme> | undefined, ws: Partial<Theme> | undefined, pane: Partial<Theme> | undefined): Theme {
  return mergeTheme({ ...(app ?? {}), ...(ws ?? {}), ...(pane ?? {}) })
}

const VAR_OF: Record<keyof Theme, string> = {
  windowBg: '--bg', panelBg: '--panel', elevatedBg: '--elevated', border: '--border',
  text: '--fg', textDim: '--fg-dim', accent: '--accent', statusBusy: '--status-busy',
  statusNeedsInput: '--status-needs', fontFamily: '--font', fontSize: '--font-size',
  termBg: '--term-bg', termFg: '--term-fg', termFontFamily: '--term-font', termFontSize: '--term-font-size'
}
const SIZE_KEYS = new Set<keyof Theme>(['fontSize', 'termFontSize'])

/** CSS variables for only the tokens present in a partial theme (override layers). */
export function themeCssVarsPartial(partial: Partial<Theme>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(partial) as (keyof Theme)[]) {
    const v = partial[k]
    if (v === undefined) continue
    out[VAR_OF[k]] = SIZE_KEYS.has(k) ? `${v}px` : String(v)
  }
  return out
}
```
(Optional: refactor `themeCssVars` to use `VAR_OF` — not required.)

- [ ] **Step 4: Types** — in `src/shared/types.ts`: add `theme?: Partial<Theme>` to the `Workspace` interface, and `theme?: Partial<Theme>` to **each** of `TerminalConfig`, `EditorConfig`, `ExplorerConfig`.

- [ ] **Step 5: Run, verify pass; typecheck. Commit:**
```bash
git add src/shared/theme.ts src/shared/types.ts tests/shared/theme.test.ts
git commit -m "feat(theme): resolveTheme + themeCssVarsPartial + per-entity theme fields"
```

---

## Task 2: Store — scoped actions + selectors

**Files:** Modify `src/renderer/store.ts`.

- [ ] **Step 1: Imports** — add `resolveTheme` to the `@shared/theme` import.

- [ ] **Step 2: Types** — add near the State interface (module scope, exported):
```ts
export type ThemeScope = { kind: 'app' } | { kind: 'workspace'; wsId: string } | { kind: 'pane'; wsId: string; paneId: string }
```
State interface:
```ts
  setThemeScoped: (scope: ThemeScope, patch: Partial<Theme>) => void
  resetThemeScope: (scope: ThemeScope) => void
```

- [ ] **Step 3: Implement** — add:
```ts
    setThemeScoped: (scope, patch) => {
      if (scope.kind === 'app') { get().setTheme(patch); return }
      if (scope.kind === 'workspace') {
        set(s => { const ws = s.workspaces[scope.wsId]; if (!ws) return {}
          return { workspaces: { ...s.workspaces, [scope.wsId]: { ...ws, theme: { ...(ws.theme ?? {}), ...patch } } } } })
        scheduleAutosave(); return
      }
      set(s => { const ws = s.workspaces[scope.wsId]; const pane = ws?.panes[scope.paneId]; if (!ws || !pane) return {}
        const cfg = { ...pane.config, theme: { ...(pane.config.theme ?? {}), ...patch } }
        return { workspaces: { ...s.workspaces, [scope.wsId]: { ...ws, panes: { ...ws.panes, [scope.paneId]: { ...pane, config: cfg } } } } } })
      scheduleAutosave()
    },

    resetThemeScope: (scope) => {
      if (scope.kind === 'app') { get().resetTheme(); return }
      if (scope.kind === 'workspace') {
        set(s => { const ws = s.workspaces[scope.wsId]; if (!ws) return {}
          const { theme: _omit, ...rest } = ws; void _omit
          return { workspaces: { ...s.workspaces, [scope.wsId]: rest as typeof ws } } })
        scheduleAutosave(); return
      }
      set(s => { const ws = s.workspaces[scope.wsId]; const pane = ws?.panes[scope.paneId]; if (!ws || !pane) return {}
        const { theme: _omit, ...restCfg } = pane.config; void _omit
        return { workspaces: { ...s.workspaces, [scope.wsId]: { ...ws, panes: { ...ws.panes, [scope.paneId]: { ...pane, config: restCfg as typeof pane.config } } } } } })
      scheduleAutosave()
    },
```
(Note: the existing `setTheme`/`resetTheme` remain the app-scope implementation.)

- [ ] **Step 4: Selector helper** — export a module-level pure function:
```ts
export function resolvedPaneTheme(s: { quick: { theme?: Partial<Theme> }; workspaces: Record<string, Workspace> }, wsId: string, paneId: string): Theme {
  const ws = s.workspaces[wsId]
  return resolveTheme(s.quick.theme, ws?.theme, ws?.panes[paneId]?.config.theme)
}
```
(Import `Workspace`/`Theme` types as needed.)

- [ ] **Step 5: Typecheck. Commit:**
```bash
git add src/renderer/store.ts
git commit -m "feat(theme): scoped store actions (app/workspace/pane) + resolvedPaneTheme"
```

---

## Task 3: ThemeProvider (debounced Monaco) + visible window background

**Files:** Modify `src/renderer/components/ThemeProvider.tsx`, `src/renderer/index.css`, `src/renderer/App.tsx`.

- [ ] **Step 1: ThemeProvider** — keep the `:root` var application synchronous, but DEBOUNCE the Monaco define/set so dragging doesn't re-tokenize per tick. Replace the effect body with:
```tsx
  const quickTheme = useStore(s => s.quick.theme)
  useEffect(() => {
    const theme = mergeTheme(quickTheme)
    const root = document.documentElement
    for (const [k, v] of Object.entries(themeCssVars(theme))) root.style.setProperty(k, v)
    const id = setTimeout(() => {
      try {
        monaco.editor.defineTheme('termhalla', { base: 'vs-dark', inherit: true, rules: [],
          colors: { 'editor.background': theme.windowBg, 'editor.foreground': theme.text } })
        monaco.editor.setTheme('termhalla')
      } catch { /* invalid color / not ready */ }
    }, 150)
    return () => clearTimeout(id)
  }, [quickTheme])
```

- [ ] **Step 2: index.css** — make the window background visible: change the mosaic lines to include `background`:
```css
.mosaic, .mosaic-root { height: 100%; background: var(--bg, #1e1e1e); }
.mosaic-blueprint-theme .mosaic-split { background: var(--bg, #1e1e1e); }
```
(Keep the existing `body` rule from the previous theming work — bg/color/font-family, no font-size.)

- [ ] **Step 3: App.tsx root** — add `background: 'var(--bg, #1e1e1e)'` to the top-level wrapper `<div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>`.

- [ ] **Step 4: Typecheck + build. Commit:**
```bash
git add src/renderer/components/ThemeProvider.tsx src/renderer/index.css src/renderer/App.tsx
git commit -m "feat(theme): visible window background + debounced Monaco re-theme"
```

---

## Task 4: Apply workspace + pane override vars (CSS cascade)

**Files:** Modify `src/renderer/App.tsx`, `src/renderer/components/WorkspaceView.tsx`.

- [ ] **Step 1: Workspace host** — in `App.tsx`, the per-workspace host `<div>` (the keep-mounted host with `data-testid="workspace-host" data-ws={id}`). Spread the workspace's override vars into its inline style. Import `themeCssVarsPartial` from `@shared/theme`, and change the host style to include `...themeCssVarsPartial(ws.theme ?? {})`:
```tsx
              style={{ ...themeCssVarsPartial(ws.theme ?? {}), position: 'absolute', inset: 0, visibility: isActive ? 'visible' : 'hidden',
                pointerEvents: isActive ? 'auto' : 'none', zIndex: isActive ? 1 : 0 }}
```

- [ ] **Step 2: Pane tile** — in `WorkspaceView.tsx`, the tile `<div className="term-tile" data-testid={`tile-${paneId}`} …>`. Import `themeCssVarsPartial`, and spread the pane's override vars into its style:
```tsx
            <div className="term-tile" data-status={state}
              data-testid={`tile-${paneId}`} data-cwd={cwd}
              style={{ ...themeCssVarsPartial(pane?.config.theme ?? {}), position: 'relative', height: '100%' }}>
```
(React applies `--custom-property` keys in a style object as CSS variables; the cascade makes pane vars override workspace vars override `:root`.)

- [ ] **Step 3: Typecheck + build. Commit:**
```bash
git add src/renderer/App.tsx src/renderer/components/WorkspaceView.tsx
git commit -m "feat(theme): apply workspace + pane override vars via CSS-var cascade"
```

---

## Task 5: Per-pane terminal (and editor) theming

**Files:** Modify `src/renderer/components/WorkspaceView.tsx` (pass `wsId`), `TerminalPane.tsx`, `EditorPane.tsx`.

- [ ] **Step 1: Pass `wsId`** — `WorkspaceView` already has `ws.id`. Pass it to the panes: `<TerminalPane paneId={paneId} wsId={ws.id} config={termCfg} />` and confirm `EditorPane` already receives `wsId` (it does).

- [ ] **Step 2: TerminalPane resolved theme** — accept `wsId: string` in props. Replace the theme source: instead of `const quickTheme = useStore(s => s.quick.theme)`, subscribe to the three partials and resolve:
```ts
  const appTheme = useStore(s => s.quick.theme)
  const wsTheme = useStore(s => s.workspaces[wsId]?.theme)
  const paneTheme = config.theme
  // create-effect: read once at mount
  const t0 = resolveTheme(useStore.getState().quick.theme, useStore.getState().workspaces[wsId]?.theme, config.theme)
  // live-update effect deps:
  useEffect(() => {
    const term = termRef.current; if (!term) return
    const t = resolveTheme(appTheme, wsTheme, paneTheme)
    term.options.theme = { background: t.termBg, foreground: t.termFg }
    term.options.fontFamily = t.termFontFamily; term.options.fontSize = t.termFontSize
    fitRef.current?.fit()
  }, [appTheme, wsTheme, paneTheme])
```
Import `resolveTheme` from `@shared/theme`; keep the create-effect deps unchanged (no theme) so no PTY respawn.

- [ ] **Step 3: EditorPane per-pane Monaco** — define a per-pane theme name and apply it to this editor. After the editor is created (in the create effect), and in a theme effect, define+set `termhalla-<paneId>` from the resolved theme:
```ts
  const appTheme = useStore(s => s.quick.theme)
  const wsTheme = useStore(s => s.workspaces[wsId]?.theme)
  const paneTheme = config.theme
  useEffect(() => {
    const ed = edRef.current; if (!ed) return
    const t = resolveTheme(appTheme, wsTheme, paneTheme)
    const name = `termhalla-${paneId}`
    try {
      monaco.editor.defineTheme(name, { base: 'vs-dark', inherit: true, rules: [],
        colors: { 'editor.background': t.windowBg, 'editor.foreground': t.text } })
      ed.updateOptions({ theme: name })
    } catch { /* invalid color */ }
  }, [appTheme, wsTheme, paneTheme, paneId])
```
(`ed.updateOptions({ theme })` themes only this editor instance, avoiding the global-theme conflict. Import `resolveTheme`.)

- [ ] **Step 4: Typecheck + build. Commit:**
```bash
git add src/renderer/components/WorkspaceView.tsx src/renderer/components/TerminalPane.tsx src/renderer/components/EditorPane.tsx
git commit -m "feat(theme): per-pane terminal + editor theming from resolved theme"
```

---

## Task 6: ThemeEditor — scope selector + live-preview performance

**Files:** Modify `src/renderer/components/ThemeEditor.tsx`.

- [ ] **Step 1:** Rework `ThemeEditor` to a scoped editor. READ the current file. Changes:
  - Add a scope `<select data-testid="theme-scope">`: option `app` (`App`), `workspace` (`This workspace`),
    and one option per pane in the active workspace (value `pane:<paneId>`, label by kind/name). Build the
    list from `useStore(s => s.activeId)` + the active workspace's panes.
  - Compute the **resolved** theme to display for the selected scope:
    `app` → `mergeTheme(quick.theme)`; `workspace` → `resolveTheme(quick.theme, ws.theme, undefined)`;
    `pane` → `resolveTheme(quick.theme, ws.theme, pane.config.theme)`.
  - A helper `scopeTarget()` returning the DOM element to live-preview on:
    `app` → `document.documentElement`; `workspace` → `document.querySelector('[data-testid="workspace-host"][data-ws="' + activeId + '"]')`;
    `pane` → `document.querySelector('[data-testid="tile-' + paneId + '"]')`.
  - A `scopeOf(): ThemeScope` from the selection.
  - Each color picker: `onInput={e => scopeTarget()?.style.setProperty(VAR, e.target.value)}` for cheap live
    preview, and `onChange={e => setThemeScoped(scopeOf(), { [key]: e.target.value })}` to commit. (Map each
    token key to its CSS var; reuse a small local `VAR` map or `themeCssVarsPartial({ [key]: value })`.)
  - Font/size inputs: commit on `onChange` via `setThemeScoped`.
  - `Reset` → `resetThemeScope(scopeOf())`. Presets stay app-scoped (`saveThemePreset`/`applyThemePreset`
    operate on the app theme; keep them, label the section "App presets").
  - Keep the portal + the existing color rows; just route reads/writes through the scope.

- [ ] **Step 2: Typecheck + build. Commit:**
```bash
git add src/renderer/components/ThemeEditor.tsx
git commit -m "feat(theme): scope selector + live-preview (input->DOM, change->commit)"
```

---

## Task 7: e2e + verify + docs

- [ ] **Step 1: e2e** — `tests/e2e/scoped-theme.spec.ts`. Reuse the DOM-safe `cssVar`/`setColor` helpers from `theme.spec.ts` (globalThis casts + native value setter). Test:
  - App scope: set `theme-windowBg` → assert `:root --bg` updates and `getComputedStyle(document.body).backgroundColor` (or the app root) reflects it.
  - Pane scope: with one terminal, select the pane in `theme-scope`, set `theme-termBg` to a distinct color → assert the tile element (`[data-testid^="tile-"]`) has the `--term-bg` override set and `:root --term-bg` does NOT equal it (override is local).
  - Relaunch (same user-data-dir, after Save) → app + pane overrides persist.

- [ ] **Step 2: Full gate** — `npm run typecheck` (exit 0), `npm test`, `npm run e2e` → green (suite has `retries: 1`).
- [ ] **Step 3: Docs** — update `docs/features/theming.md` (scoped overrides, window-bg, perf, per-pane limitation for editors); `CHANGELOG.md` `[Unreleased]`. Commit.

---

## Self-review notes
- Spec coverage: resolveTheme/partial vars + types (T1), scoped store (T2), provider+window-bg+debounced Monaco (T3), cascade application (T4), per-pane term/editor (T5), scoped editor + perf (T6), e2e+docs (T7).
- Cascade correctness: `:root` full vars; workspace/pane partial vars spread as inline custom properties; nearest wins. xterm/Monaco read `resolveTheme(app, ws, pane)`. Lag fixed by `input`→direct `setProperty`, `change`→store; Monaco debounced.
- Back-compat: missing `theme` on workspace/pane → `undefined` → no override.
