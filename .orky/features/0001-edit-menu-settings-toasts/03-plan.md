# 0001 — Edit menu + Settings entry + toast toggle — Implementation Plan

**Status:** plan amended (phase 3, iteration 1). Derived from the amended `02-spec.md`
(REQ-001..REQ-010) and `01-brainstorm.md`. Brownfield: planned against
`.orky/baseline/architecture.md` — reuses the existing IPC spine (`ipc-contract` → `preload` →
`renderer/api`), the `QuickStore` additive-optional preference pattern, the zustand quick-slice
setter pattern, and the existing Settings modal / open-settings command. No new module boundaries
are introduced.

**Iteration-1 amendment (ESC-001):** the toast disable preference must NOT suppress `error`-kind
toasts. The single `pushToast` chokepoint now branches on `kind` — drop `success`/`info` when
`toastsEnabled !== true`, but ALWAYS enqueue `error`. New REQ-010 pins this carve-out. The change is
contained to TASK-008 (same code site); TASK-009 gains a help-text sub-step and TASK-010 gains an
error-bypass test note. No TASK-IDs were renumbered.

This plan does **not** write code or tests. It specifies structure and sequence only. Tests
(vitest unit + Playwright e2e) are authored in phase 4; the traceability `tests` arrays are left
empty for the Gatekeeper to fill then.

## Target file / module layout

No new directories. Changes land in existing files across the three sandboxed layers:

| Layer | File | Change |
|---|---|---|
| shared (contract) | `src/shared/ipc-contract.ts` | New `CH.openSettings = 'menu:open-settings'` (main→renderer); `onOpenSettings(cb): () => void` on `TermhallaApi`. |
| shared (types) | `src/shared/types.ts` | `QuickStore.toastsEnabled?: boolean` (additive optional, alongside `copyOnSelect`). **No `SCHEMA_VERSION` bump.** |
| main | `src/main/menu.ts` | New top-level `Edit` submenu before `View`/`Help`; one `Settings…` item, accel `CmdOrCtrl+,`, `click` → `webContents.send('menu:open-settings')` to focused window. |
| preload | `src/preload/index.ts` | Expose `onOpenSettings: pushChannel<[]>(CH.openSettings)` (empty payload), matching `onAppFlush`. |
| renderer (api) | `src/renderer/api.ts` | Surfaces `window.api.onOpenSettings` (pass-through; no edit unless api.ts enumerates members — confirm at impl time). |
| renderer (wiring) | `src/renderer/App.tsx` | Register `api.onOpenSettings(() => s().openSettings({ section: 'general' }))` alongside the other push subscriptions (near line 51-58); keep the returned unsubscribe in the existing cleanup set. |
| renderer (UI) | `src/renderer/components/WorkspaceTabs.tsx` | **Remove** the `data-testid="settings-button"` gear button (was line ~103). |
| renderer (store) | `src/renderer/store/toasts-slice.ts` | Gate `pushToast` on `kind`: drop `success`/`info` when `get().quick.toastsEnabled !== true`; **always enqueue `kind === 'error'`** (REQ-010). Single chokepoint; keep `MAX_TOASTS = 4` cap. |
| renderer (store) | `src/renderer/store/quick-slice.ts` | New `setToastsEnabled(on)` mirroring `setCopyOnSelect`; add to the `QuickSlice` Pick. |
| renderer (store types) | `src/renderer/store/types.ts` | Declare `setToastsEnabled(on: boolean): void` on `State`. |
| renderer (UI) | `src/renderer/components/GeneralSettings.tsx` | Checkbox `data-testid="toasts-enabled"`, label "Show toast notifications", help text noting it governs success/info and errors always show; `checked={quick.toastsEnabled === true}`, `onChange → setToastsEnabled(e.target.checked)`. |
| docs | `CHANGELOG.md`, `CLAUDE.md` (where-things-live / IPC), relevant feature doc | Note Edit menu, removed gear, default-off `success`/`info` toasts (errors always show), new `menu:open-settings` channel; confirm `docs/decisions.md:404-410` runOp guarantee preserved. |

Note on the toast chokepoint (REQ-006/REQ-010): the slice's `pushToast` is the chosen single gate
because it already receives `get` (so it can read `quick.toastsEnabled`) and is the source of truth
that every call site flows through — no call site changes, and it stays headlessly vitest-testable.
The gate **branches on `kind`**: `success`/`info` are dropped when the preference is not strictly
`true`; `error` always enqueues so the editor "Save failed" signal (runOp guarantee,
`docs/decisions.md:404-410`) is preserved. `Toasts.tsx` render is left unchanged (gating there would
still let suppressed toasts occupy the capped stack). This is a decision the tests in phase 4 pin.

## Tasks

### TASK-001 — Declare the `menu:open-settings` IPC channel in the contract
- **Files:** `src/shared/ipc-contract.ts`
- **What:** Add `openSettings: 'menu:open-settings'` to the `CH` map (commented `// main -> renderer event`); add `onOpenSettings(cb: () => void): () => void` to `TermhallaApi`, shaped like `onAppFlush`.
- **Depends on:** —
- **Satisfies:** REQ-003

### TASK-002 — Expose `onOpenSettings` through preload
- **Files:** `src/preload/index.ts` (and verify `src/renderer/api.ts` surfaces it)
- **What:** Add `onOpenSettings: pushChannel<[]>(CH.openSettings)` to the exposed `window.api` object (empty carrier payload). The shared `pushChannel` helper already returns an unsubscribe function detaching the listener.
- **Depends on:** TASK-001
- **Satisfies:** REQ-003

### TASK-003 — Add the native Edit ▸ Settings… menu item
- **Files:** `src/main/menu.ts`
- **What:** Insert a top-level `Edit` submenu **before** `View` and `Help` (order `Edit · View · Help`) containing exactly one item `Settings…`, accelerator `CmdOrCtrl+,`, whose `click` calls `BrowserWindow.getFocusedWindow()?.webContents.send('menu:open-settings')` (and sends on no other channel).
- **Depends on:** TASK-001 (channel name)
- **Satisfies:** REQ-001, REQ-002

### TASK-004 — Subscribe in the renderer and open the Settings modal
- **Files:** `src/renderer/App.tsx`
- **What:** Where the other push subscriptions register (≈ line 51-58), add `api.onOpenSettings(() => s().openSettings({ section: 'general' }))`; store its returned unsubscribe alongside the existing ones so cleanup detaches it (exercises the unsubscribe boundary, REQ-003).
- **Depends on:** TASK-002
- **Satisfies:** REQ-002, REQ-003

### TASK-005 — Remove the gear (⚙) Settings button
- **Files:** `src/renderer/components/WorkspaceTabs.tsx`
- **What:** Delete the `data-testid="settings-button"` gear button (≈ line 103) and any now-unused `openSettings` import/handler local to it. Leave Command Palette, pane context menu, and `Ctrl+,` (`open-settings` in `App.tsx:100`) entry points untouched.
- **Depends on:** TASK-004 (so the Edit-menu path is live before the gear is removed — ordering keeps Settings reachable throughout)
- **Satisfies:** REQ-004

### TASK-006 — Add the `toastsEnabled` persisted preference (additive, no schema bump)
- **Files:** `src/shared/types.ts`
- **What:** Add `toastsEnabled?: boolean` to `QuickStore` beside `copyOnSelect`. Do **not** change `EMPTY_QUICK` (absence ⇒ effective OFF for `success`/`info`) and do **not** bump `SCHEMA_VERSION`. Confirm `normalizeQuick` (`quick-store.ts`) passes it through / leaves it absent without throwing for legacy `quick.json`.
- **Depends on:** —
- **Satisfies:** REQ-007

### TASK-007 — Add the `setToastsEnabled` store action
- **Files:** `src/renderer/store/quick-slice.ts`, `src/renderer/store/types.ts`
- **What:** Add `setToastsEnabled(on)` that sets `quick.toastsEnabled = on` and calls `scheduleQuickSave()`, mirroring `setCopyOnSelect`; add it to the `QuickSlice` Pick and declare it on `State`.
- **Depends on:** TASK-006
- **Satisfies:** REQ-007

### TASK-008 — Gate `pushToast` on the toast preference, branching on `kind` (single chokepoint)
- **Files:** `src/renderer/store/toasts-slice.ts`
- **What:** In `pushToast`, branch on `kind`. When `get().quick.toastsEnabled !== true`: if `kind` is `success` or `info`, short-circuit (return without adding to `toasts`; return-value contract preserved); if `kind === 'error'`, **always proceed to enqueue** (REQ-010 — the carve-out). When enabled, all kinds surface. This is the single global gate — no call site changes. Keep `MAX_TOASTS = 4` (errors count against the cap like any toast). Wire `get` into the slice if not already destructured.
- **Acceptance (drives phase-4 tests):**
  - disabled + `success`/`info` ⇒ nothing enqueued;
  - disabled + `error` ⇒ toast enqueued (bypass keyed on `kind === 'error'`, not blanket pass-through);
  - enabled ⇒ all kinds surface, capped at 4;
  - the enable/kind check lives **only** in `pushToast` (no per-call-site enable checks).
- **Depends on:** TASK-006
- **Satisfies:** REQ-005, REQ-006, REQ-010

### TASK-009 — Add the toast-toggle checkbox to General settings
- **Files:** `src/renderer/components/GeneralSettings.tsx`
- **What:** Render a checkbox alongside copy-on-select: `data-testid="toasts-enabled"`, label "Show toast notifications", `checked={quick.toastsEnabled === true}` (unchecked for `undefined`/`false`), `onChange` → `setToastsEnabled(checkbox.checked)`.
  - **Sub-step (REQ-008 help text):** the label/help copy SHOULD make clear the toggle governs `success`/`info` notifications and that **error notifications always appear** regardless of the setting (e.g. helper text "Errors always show"). Keep it paint-only/text-only; no behavior beyond the checkbox.
- **Depends on:** TASK-007
- **Satisfies:** REQ-008

### TASK-010 — Reconcile baseline characterization with kind-branched toast gating
- **Files:** (phase-4 test surface) — flag for `tests/toasts-slice.test.ts` and any `tests/characterization-*.test.ts` / `tests/e2e/*` pinning toasts-render
- **What:** The existing `tests/toasts-slice.test.ts` harness seeds `{ toasts: [] }` with **no** `quick`, so post-gate `pushToast` for `success`/`info` would add nothing and those assertions break. This is the deliberate REQ-005 behavior change (CONV-003). The tests phase MUST:
  1. Seed `quick.toastsEnabled = true` for the "renders/caps" cases (so all kinds surface, cap stays asserted).
  2. Add explicit **default-OFF** assertions using a **non-error** kind (`info`/`success`) — the suppression test must NOT use `error`, since errors are exempt.
  3. Add a **NEW error-bypass test**: with `toastsEnabled` `undefined` (and again `false`), `pushToast(text, 'error')` enqueues a toast (REQ-010), while `pushToast(text, 'info'|'success')` enqueue nothing (negative control pinning the `kind === 'error'` branch).
  No production code beyond TASK-008 is needed; this task only flags the reconciliation so phase 4 owns it. Also check `tests/e2e/ui-polish.spec.ts` / `focus.spec.ts` (matched "toast") for toast-render assumptions.
- **Depends on:** TASK-008
- **Satisfies:** REQ-005, REQ-010 (test reconciliation; primary impl is TASK-008)

### TASK-011 — Update documentation (changelog + arch/feature docs)
- **Files:** `CHANGELOG.md`, `CLAUDE.md` (IPC + where-things-live), relevant feature doc under `docs/features/`
- **What:** Changelog entry naming (a) the Edit ▸ Settings… menu, (b) the removed gear button, (c) `success`/`info` toasts now default OFF **while error toasts always show**. Document the new `menu:open-settings` channel and the moved Settings entry point so a reviewer can trace the channel to a doc mention. Confirm `docs/decisions.md:404-410` (runOp "Save failed" guarantee) remains accurate and is **left intact** — the REQ-010 carve-out preserves it (resolves FINDING-DOC-001).
- **Depends on:** TASK-003, TASK-005, TASK-008
- **Satisfies:** REQ-009

## Sequencing summary

1. Contract/types foundation: TASK-001, TASK-006 (independent, can go first/parallel).
2. Transport: TASK-002 (preload) after TASK-001; TASK-007 (store action) after TASK-006.
3. Producers/consumers: TASK-003 (menu) after TASK-001; TASK-004 (renderer subscribe) after TASK-002; TASK-008 (kind-branched gate) after TASK-006.
4. UI: TASK-005 (remove gear) after TASK-004 (keep Settings reachable); TASK-009 (checkbox + help text) after TASK-007.
5. Cross-cutting: TASK-010 (test reconciliation incl. error bypass) after TASK-008; TASK-011 (docs) after the user-visible changes land.

## Risks / notes

- **Brownfield behavior change (REQ-005/TASK-010):** default-off `success`/`info` toasts will break
  the current `tests/toasts-slice.test.ts` render/cap assertions and possibly toast-touching e2e
  specs. This is intended per CONV-003; flagged as TASK-010 so the tests phase updates the
  change-detectors deliberately rather than the code being "fixed" to make them pass.
- **Error carve-out (REQ-010):** the gate branches on `kind`; `error` toasts always enqueue. The
  default-OFF suppression test MUST use a non-error kind, and a dedicated error-bypass test pins the
  carve-out (phase 4). Getting this wrong (blanket suppression) would silently drop the editor "Save
  failed" signal and violate the `docs/decisions.md:404-410` runOp guarantee.
- **No `SCHEMA_VERSION` bump (REQ-007):** the field is additive optional; bumping would force an
  unnecessary migration and risk legacy `quick.json` load. Plan keeps `EMPTY_QUICK` unchanged so
  absence reads as OFF for `success`/`info`.
- **Entry-point ordering (REQ-004):** remove the gear (TASK-005) only after the Edit-menu path
  (TASK-004) is wired, so Settings is reachable at every commit.
- **Single chokepoint (REQ-006):** gate (incl. the kind branch) lives only in `pushToast`; the diff
  must show no per-call enable checks at any other call site (asserted by the single-gate test in
  phase 4).

## Open issues
_None._ All ten REQs (REQ-001..REQ-010) map to ≥1 task.
