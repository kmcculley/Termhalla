# Text Readability — contrast pass

**Date:** 2026-06-16
**Status:** Design — pending review

## Goal

Make text legible on every surface to WCAG AA, fixing the measured low-contrast spots
without muting the app's look. Measurements (relative-luminance WCAG ratios) over the
default theme found one hard failure and a few marginals; everything else already passes
AA comfortably.

| Pair | Ratio | Verdict |
|---|---|---|
| white on needs-input bar `#ff8f00` | **2.29** | **FAIL** |
| white on busy bar `#1e88e5` | 3.68 | large-only |
| recording-red `#e53935` on toolbar | 3.94 | marginal |
| env-error `#e55` on elevated | 4.42 | marginal |
| accent `#1e88e5` as text on elevated | 4.16 | marginal (theoretical) |
| body `#eee`/dim `#aaa`/sel-item/opacity-dim | 4.6–14.4 | pass |

## Decisions (from brainstorming)

- **Adaptive text color** on the saturated alert bars (not darkening the colors): compute
  black-or-white from the bar color's luminance, so it stays correct for any user-chosen
  alert color, and keeps the bright defaults.
- Scope: **failures + marginals** (fix the alert bars and nudge the marginal small-text
  colors to clear AA).
- Standard: **WCAG AA** — 4.5:1 for body text, 3:1 for the bold alert-bar titles.

## Components

### 1. Pure contrast module — `src/shared/contrast.ts` (new)

```ts
export function relativeLuminance(hex: string): number   // WCAG, sRGB → linear
export function contrastRatio(a: string, b: string): number
/** Black-vs-white text choice for a background, by the WCAG luminance crossover
 *  (L > 0.179 → dark wins). Returns the provided dark/light tokens. */
export function readableOn(bgHex: string, dark = '#182026', light = '#ffffff'): string
```

Robust hex parsing (`#rgb`/`#rrggbb`). Pure, fully unit-tested.

### 2. Adaptive alert-text vars — `@shared/theme.ts`

`themeCssVars(t)` additionally emits:

```ts
'--on-busy': readableOn(t.statusBusy),
'--on-needs': readableOn(t.statusNeedsInput),
```

`themeCssVarsPartial(partial)` emits `--on-busy` only when `statusBusy` is present, and
`--on-needs` only when `statusNeedsInput` is present (so a per-workspace/pane override of
an alert color recomputes its readable text automatically).

Because `ThemeProvider` already iterates `themeCssVars` onto `document.documentElement`,
and `App.tsx` / `PaneTile` already spread `themeCssVarsPartial(...)` for workspace/pane
overrides, **no component wiring changes** — the vars appear at every scope for free.

### 3. `index.css` — use the adaptive vars on alert-bar titles

The combined busy/needs title rule (currently `color: #fff !important; text-shadow: …`)
splits into two, each pulling its scope-correct color and dropping the now-pointless dark
text-shadow (the text is dark-on-bright now):

```css
.mosaic-blueprint-theme .mosaic-window.term-busy .mosaic-window-title { color: var(--on-busy, #fff) !important; }
.mosaic-blueprint-theme .mosaic-window.term-needs-input .mosaic-window-title { color: var(--on-needs, #fff) !important; }
```

The alert-bar *toolbar buttons* are already white-bg/dark-text (16.5:1) — unchanged.

Result: needs-input title 2.29 → **7.21**; busy title 3.68 → **4.48** (bold title, AA).

### 4. Marginal small-text colors → clear AA

- **Recording red** — `PaneToolbar.tsx`: the recording button `color: '#e53935'` (3.94)
  → `#ff6b6b` (6.01 on the toolbar).
- **Env error** — `EnvSettings.tsx`: the error text references `var(--status-needs-input,
  #e55)` — a var name that **does not exist** (the real token is `--status-needs`), so it
  always falls back to `#e55` (4.42). Repoint to a clear-AA error red `#ff6b6b` (5.52 on
  elevated) — no bogus var.
- **Accent-as-text** — the accent (`#1e88e5`) is used as text only on the toolbar/panel
  (`#1e1e1e`), where it's 4.53 (passes AA). The 4.16 elevated case is theoretical (no
  current on-elevated accent-text site); leave the accent token unchanged to avoid
  disrupting focus rings / active-tab / `--sel-bg`. The guard test pins the real usage.

## Testing (TDD per CLAUDE.md)

- **Unit — `tests/contrast.test.ts`**: `relativeLuminance` (black=0, white=1, a known mid
  value); `contrastRatio` (white/black = 21, symmetric); `readableOn` (returns dark for
  the bright orange/blue, light for near-black `#1e1e1e`; honors custom dark/light args).
- **Unit — `tests/theme-contrast.test.ts` (guard)**: using `contrastRatio`, assert the
  default theme's key text/background pairs meet the standard, so a future token change
  can't silently regress readability:
  - body `text` on `windowBg`/`elevatedBg` ≥ 4.5
  - `textDim` on `windowBg`/`elevatedBg` ≥ 4.5
  - `readableOn(statusBusy)` on `statusBusy` ≥ 3.0 and `readableOn(statusNeedsInput)` on
    `statusNeedsInput` ≥ 4.5 (bold-title AA-large for busy; full AA for needs)
  - the recording-red and env-error replacement colors ≥ 4.5 on their backgrounds
  - `fg` on the `--sel-bg` blend (`color-mix(accent 32%, elevated)`, computed in the test)
    ≥ 4.5
- **e2e — extend `tests/e2e/status.spec.ts` (or `ui-polish.spec.ts`)**: drive a terminal
  into needs-input (the existing y/N-prompt path already does this) and assert the
  window-title's computed `color` is the dark adaptive color, not white — proving the
  orange-bar fix end to end. Read computed style via `getComputedStyle` (cast through
  `globalThis`, per the Phase-1 tests-tsconfig lesson).
- Full `npm run typecheck && npm test && npm run build`, then the touched e2e spec. Read
  typecheck's exit code directly (no `tail` pipe).

## Load-bearing gotchas respected

- **Adaptive vars cascade with the theme**: emitting `--on-busy`/`--on-needs` from both
  `themeCssVars` (app) and `themeCssVarsPartial` (overrides) keeps the readable text color
  correct at every scope without per-component code — matching how the rest of the token
  system already works.
- **Don't change the alert *colors***: the brightness is intentional (alerting); only the
  text color adapts. Busy stays `#1e88e5`, needs stays `#ff8f00`.
- **CSS var fallbacks**: the alert-title rules keep `, #fff)` fallbacks so an engine
  without the var still renders (degrading to today's behavior).
- **No persistence/schema change**: `--on-*` are derived render-time vars, never stored;
  the `Theme` type is untouched.

## Risks

- Low. Pure derived vars + a few default color value swaps. The contrast guard test locks
  the standard in. The only visible change is dark (instead of white) titles on the
  busy/needs bars and slightly brighter recording/error reds — both intentional.
