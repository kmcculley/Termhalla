# 0001 — Test design (phase 4, iteration 1)

Tests authored against the amended `02-spec.md` (REQ-001..**REQ-010**) and `03-plan.md`
(TASK-001..011, incl. the iteration-1 ESC-001 error carve-out in TASK-008/010). The suite runs
**RED** — every new feature test references code that does not exist yet (the Edit menu, the
`menu:open-settings` channel, `setToastsEnabled`, the kind-branched toast gate, the checkbox), and
the iteration-1 error-bypass tests (TEST-019/020) additionally fail against the *current*
always-suppress `pushToast` implementation (which still suppresses `error` too) — driving the
`kind === 'error'` carve-out.

Each test carries its `TEST-NNN` id in its test name so the Gatekeeper can confirm existence.

**Iteration-1 delta (ESC-001 / REQ-010):** `error`-kind toasts must NOT be suppressed by the
`toastsEnabled` preference. The toast-suppression tests were reconciled (TEST-010 re-scoped to
non-error kinds) and two new error-bypass tests were added (TEST-019, TEST-020). See the
reconciliation log below.

## TEST → REQ map

| TEST | Kind | File | Covers | Asserts |
|---|---|---|---|---|
| TEST-001 | unit (vitest) | `tests/main/menu.test.ts` | REQ-001 | `installAppMenu()` builds a top-level **Edit** submenu whose index is **< View and < Help**, containing exactly **one** item `Settings…` with accelerator `CmdOrCtrl+,`. Drives the real fn with `electron`/`./updater` mocked, capturing the template passed to `Menu.buildFromTemplate`. |
| TEST-002 | unit (vitest) | `tests/main/menu.test.ts` | REQ-002 | The `Settings…` item's `click` handler sends **exactly** `['menu:open-settings']` to the focused `BrowserWindow.webContents` — and no other channel. |
| TEST-003 | unit (vitest) | `tests/shared/open-settings-channel.test.ts` | REQ-003 | `CH.openSettings === 'menu:open-settings'` is declared in the shared contract. (The `onOpenSettings` subscription shape + unsubscribe are enforced by `npm run typecheck` and the App.tsx cleanup set — see "Not unit-tested" below.) |
| TEST-004 | unit (vitest) | `tests/renderer/quick-slice.test.ts` | REQ-007 | `setToastsEnabled(true)` sets `quick.toastsEnabled === true` **and** calls `scheduleQuickSave()` once. Headless slice harness (no `../api`). |
| TEST-005 | unit (vitest) | `tests/renderer/quick-slice.test.ts` | REQ-007 | `setToastsEnabled(false)` sets `quick.toastsEnabled === false` and schedules a save. |
| TEST-006 | unit (vitest) | `tests/main/quick-store-toasts.test.ts` | REQ-007 | `toastsEnabled: true` **round-trips** through `QuickStore.save`→`load` (i.e. `normalizeQuick` must pass it through). |
| TEST-007 | unit (vitest) | `tests/main/quick-store-toasts.test.ts` | REQ-007 | A **legacy** `quick.json` lacking the field loads clean (no throw, no migration); `toastsEnabled` is `undefined` ⇒ effective **OFF** for success/info. |
| TEST-008 | unit (vitest) | `tests/main/quick-store-toasts.test.ts` | REQ-007 | `SCHEMA_VERSION === 6` — the additive field does **not** bump the schema. (Freeze/guard test, stays green.) |
| TEST-009 | unit (vitest) | `tests/toasts-slice.test.ts` | REQ-005 | With `toastsEnabled` **unset** (fresh/legacy), `pushToast(text,'success')` and `pushToast(text,'info')` add **zero** toasts; default pinned `=== off`; the string-id return contract is preserved. |
| TEST-010 | unit (vitest) | `tests/toasts-slice.test.ts` | REQ-005 | With `toastsEnabled === false`, `pushToast` for **`info`/`success`** (non-error kinds) adds nothing. *(Re-scoped this iteration — see reconciliation log; previously used `error`.)* |
| TEST-011 | unit (vitest) | `tests/toasts-slice.test.ts` | REQ-006 | With toasts **enabled**, the single `pushToast` gate surfaces a toast for **every** kind (`success`/`error`/`info`) — no per-call-site check. |
| TEST-012 | unit (vitest) | `tests/toasts-slice.test.ts` | REQ-006 | With toasts enabled, the stack is **capped at `MAX_TOASTS = 4`** (CONV-003: cap stays asserted). |
| TEST-013 | e2e (Playwright) | `tests/e2e/edit-menu-settings.spec.ts` | REQ-001 | Launched app's application menu has `Edit` **before** `View`/`Help` with a single `Settings…` item, accel `CmdOrCtrl+,` (read via `app.evaluate(Menu.getApplicationMenu())`). |
| TEST-014 | e2e (Playwright) | `tests/e2e/edit-menu-settings.spec.ts` | REQ-002 | Triggering the `Edit ▸ Settings…` menu item's click in main makes `settings-general` visible in the renderer. |
| TEST-015 | e2e (Playwright) | `tests/e2e/edit-menu-settings.spec.ts` | REQ-004 | After launch, `data-testid="settings-button"` (the ⚙ gear) has **count 0**. |
| TEST-016 | e2e (Playwright) | `tests/e2e/edit-menu-settings.spec.ts` | REQ-004 | `Ctrl+,` still opens Settings (`settings-general` visible) — the preserved keybinding entry point. |
| TEST-017 | e2e (Playwright) | `tests/e2e/edit-menu-settings.spec.ts` | REQ-008 | General settings shows `data-testid="toasts-enabled"`, and with no prior preference it renders **unchecked** (default OFF). |
| TEST-018 | e2e (Playwright) | `tests/e2e/edit-menu-settings.spec.ts` | REQ-005, REQ-008 | Default-off: saving a template fires a `success` `pushToast` but **no** `toast` appears. After checking `toasts-enabled`, the same action surfaces a `toast` reading "Template saved". |
| **TEST-019** | unit (vitest) | `tests/toasts-slice.test.ts` | **REQ-010** | `error`-kind toasts enqueue even when `toastsEnabled` is **unset** AND when **`false`** — visible `toasts` length increases and contains the error entry. **(New this iteration; key RED test — fails against the current always-suppress impl.)** |
| **TEST-020** | unit (vitest) | `tests/toasts-slice.test.ts` | **REQ-010, REQ-006** | Negative control / kind-branch pin: in the **disabled** state, `pushToast(text,'info')` and `pushToast(text,'success')` enqueue **nothing**, while `pushToast(text,'error')` enqueues — proving the bypass is keyed on `kind === 'error'`, not a blanket pass-through. **(New this iteration.)** |
| **TEST-021** | unit (vitest) | `tests/docs-feature-0001.test.ts` | **REQ-009** | CHANGELOG-content guard: the `[Unreleased]` section must document the Edit-menu move (incl. `menu:open-settings`) and the toast default-off/errors-always-show behavior. Fails if the feature stops being documented. **(Added at doc-sync to close the traceability gate — a real regression guard, not a no-op.)** |

## Coverage (every REQ ≥ 1 TEST)

- REQ-001 → TEST-001, TEST-013
- REQ-002 → TEST-002, TEST-014
- REQ-003 → TEST-003 (+ typecheck/unsubscribe, below)
- REQ-004 → TEST-015, TEST-016
- REQ-005 → TEST-009, TEST-010, TEST-018
- REQ-006 → TEST-011, TEST-012, TEST-020
- REQ-007 → TEST-004, TEST-005, TEST-006, TEST-007, TEST-008
- REQ-008 → TEST-017, TEST-018
- REQ-009 → TEST-021 (CHANGELOG-content assertion; added at doc-sync to close the traceability gate)
- REQ-010 → TEST-019, TEST-020

### Not unit-tested (by spec design)
- **REQ-003 unsubscribe boundary (CONV-002):** the `onOpenSettings` return-value unsubscribe and the
  preload `pushChannel` wiring require Electron's `ipcRenderer` at module load (throws under vitest's
  node env, per CLAUDE.md). It is enforced by `npm run typecheck` (the channel + `onOpenSettings`
  member must resolve) and exercised by the App.tsx cleanup set in the launched-app e2e. TEST-002
  already pins the main→renderer `webContents.send` half directly.
- **REQ-009 docs:** in addition to the reviewer/doc-sync check, TEST-021 asserts the CHANGELOG content
  so the documentation requirement is traceable to an executable test.

## Brownfield characterization reconciliation (TASK-010, CONV-003)

REQ-005 deliberately flips `success`/`info` toasts from *always-render* to *default-OFF*, and the
iteration-1 amendment (REQ-010) carves `error` out of that gate. The change-detector and
toast-/gear-touching tests were updated **deliberately** to encode the new intended behavior (not
weakened to hide it). No `tests/characterization-*.test.ts` references toasts or the gear, so none of
the baseline CHAR change-detectors required edits (verified by grep).

| File | What changed | Why |
|---|---|---|
| `tests/toasts-slice.test.ts` (iteration 1) | **TEST-010 re-scoped:** previously called `pushToast('Nope','error')` + `pushToast('Still nope','info')` and asserted suppression of both. Now uses **`info`/`success` only**. **Added TEST-019** (error bypass, unset + false) and **TEST-020** (negative control: disabled ⇒ info/success drop, error enqueues). | REQ-010 (ESC-001) exempts `error` from the gate. A suppression test asserting `error` adds nothing would now be **wrong** (and would mask the carve-out / silently drop the "Save failed" signal), so it was re-scoped to non-error kinds and the error path got its own dedicated tests. |
| `tests/toasts-slice.test.ts` (iteration 0) | Rewritten. Harness seeds `quick` (defaults `{}` ⇒ OFF). Render/cap cases (`TEST-011`/`TEST-012`, plus preserved default-kind & dismiss cases) re-seed `{ toastsEnabled: true }` because their **intent** is to exercise rendering. Added explicit default-OFF (`TEST-009`) and disabled (`TEST-010`) suppression assertions. | The old harness seeded no `quick` and asserted toasts always render — exactly what REQ-005 changes. |
| `tests/e2e/ui-polish.spec.ts` | "toast appears when saving a workspace template": now enables toasts (`Ctrl+,` → check `toasts-enabled` → close) **before** saving the template; gear-open swapped for `Ctrl+,`. | Under default-OFF the template-save (`success`) toast no longer renders; the test's intent (toast rendering) is preserved by first enabling the preference. |
| `tests/e2e/focus.spec.ts` | "closing a dialog restores focus": opens Settings via `Ctrl+,` instead of the removed ⚙ `settings-button`. | REQ-004 removes the gear; the test's intent (a modal steals/returns focus) is unchanged. |
| `tests/e2e/settings.spec.ts` | Both gear opens → `Ctrl+,`; first test renamed "gear opens…" → "Ctrl+, opens…". | REQ-004 gear removal; entry-point swapped to a preserved one. |
| `tests/e2e/keybindings.spec.ts` (×2), `env-per-terminal.spec.ts`, `env-vars.spec.ts`, `theme.spec.ts`, `scoped-theme.spec.ts`, `statusbar-tips.spec.ts`, `font-zoom.spec.ts`, `ui-polish.spec.ts` (line ~206) | Mechanical: each `getByTestId('settings-button').click()` (used only to *open* Settings) → `keyboard.press('Control+Comma')`. | These tests open Settings incidentally via the gear; REQ-004 removes it, so they use the preserved `Ctrl+,` entry point. None assert on the gear element itself, so intent is unchanged. |

These e2e files are FROZEN once the gate passes, so they were reconciled now (the implementer cannot
edit them later). All reconciled specs parse/collect cleanly via `npx playwright test --list`.

## RED confirmation

`npx vitest run tests/toasts-slice.test.ts`: **2 failed | 6 passed**, non-zero exit. The two failing
tests prove the `error` carve-out (REQ-010) is **not yet implemented** — the current `pushToast`
still suppresses `error` when `toastsEnabled !== true`:

```
× tests/toasts-slice.test.ts › toasts slice — error carve-out is never suppressed (REQ-010)
    › TEST-019: error toasts enqueue even when toastsEnabled is unset AND when false
      AssertionError: expected [] to have a length of 1 but got +0
× tests/toasts-slice.test.ts › toasts slice — error carve-out is never suppressed (REQ-010)
    › TEST-020: in the disabled state, the bypass is keyed on kind === error (info/success
      enqueue nothing, error enqueues)
      AssertionError: expected [] to have a length of 1 but got +0
```

Green-by-design in this file (positive/guard, coherent under the new spec): TEST-009 (success/info
suppressed when unset), TEST-010 (success/info suppressed when false), TEST-011/TEST-012
(enabled-path render/cap), and the two preserved enabled-path behaviors (default-kind, dismiss).

Full-suite RED items from iteration 0 (missing menu/channel/store/store-load impl) remain RED:
TEST-001, TEST-002, TEST-003, TEST-004, TEST-005, TEST-006. The e2e tests (TEST-013..018) are RED
until `npm run build` exercises the implemented app.
