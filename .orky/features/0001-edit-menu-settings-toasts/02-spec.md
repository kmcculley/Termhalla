# 0001 — Edit menu + Settings entry + toast-notification toggle — Specification

**Status:** spec amended (phase 2, iteration 1). Encodes the decisions agreed with the human in
`01-brainstorm.md` (authoritative), including the **Addendum — Iteration 1** error carve-out
(ESC-001) — not re-opened here.

**Concerns:** `ux`, `qol`, `doc-drift`
(always-on lenses `security`, `quality`, `devils-advocate` apply too).

This is a brownfield feature built against `.orky/baseline/`. It **intentionally changes**
existing characterized behavior in one place (`success`/`info` toasts now default OFF) — see
REQ-005, which must be reconciled with any baseline characterization that pins
toasts-always-render. No existing baseline `REQ-` is superseded wholesale; non-error toast
rendering gains a gating precondition while **`error`-kind toasts continue to always render**
(REQ-010).

**Iteration 1 note (ESC-001 / FINDING-DA-001 resolved by the human):** the toast disable
preference MUST NOT suppress `error`-kind toasts. Gating applies to `success`/`info` only;
`error` toasts always surface. This preserves the editor "Save failed" signal and the
documented runOp guarantee (`docs/decisions.md:404-410`) — see REQ-010 and REQ-009.

---

## Public interface

### IPC contract (`src/shared/ipc-contract.ts`)
- A new **main → renderer push** channel `menu:open-settings` (string `'menu:open-settings'`),
  named per the `domain:verb` convention and commented `// main -> renderer event`.
- A renderer subscription method on the `TermhallaApi` interface:
  `onOpenSettings(cb: () => void): () => void` — returns an unsubscribe function, matching the
  existing `onAppFlush` / `onWinAssignment` push-subscription shape.
- Exposed through preload (`src/preload/index.ts`) via the existing `pushChannel<[]>(CH.openSettings)`
  helper so it reaches `window.api` (the carrier payload is empty — no arguments).

### Persisted preference (`src/shared/types.ts`)
- `QuickStore` gains one optional field: `toastsEnabled?: boolean`. Optional, additive, placed
  alongside `recordByDefault` / `autoResumeClaude` / `copyOnSelect`. Semantics: **`success`/`info`**
  toasts render only when this is **strictly `true`**; `undefined`/`false` ⇒ suppressed.
  **`error`-kind toasts are exempt and always render** regardless of this field (REQ-010).

### Store action (`src/renderer/store/quick-slice.ts`)
- A new action `setToastsEnabled(on: boolean): void` that sets `quick.toastsEnabled` and calls
  `scheduleQuickSave()`, mirroring `setCopyOnSelect`. Declared on the store `State` type.

---

## REQ-001 — Edit menu added to the native application menu
**MUST.** `installAppMenu()` in `src/main/menu.ts` MUST build a top-level **"Edit"** submenu
positioned **before** View and Help, yielding menu order `Edit · View · Help`. The Edit submenu
MUST contain exactly one item labelled **"Settings…"** with accelerator `CmdOrCtrl+,`.

**Acceptance:** A unit test that inspects the menu template (or the built `Menu`) asserts: a
top-level label `Edit` exists; its index is less than the index of `View` and of `Help`; its
submenu has exactly one item whose `label` is `Settings…` and whose `accelerator` is `CmdOrCtrl+,`.

## REQ-002 — Settings menu item opens the renderer Settings modal via IPC
**MUST.** Clicking the Edit ▸ Settings… item MUST send the `menu:open-settings` push event to the
focused window's renderer (and to no other channel). The renderer, on receiving it, MUST open the
existing Settings modal at the General section (equivalent to `openSettings({ section: 'general' })`).

**Acceptance:**
- Unit: the menu item's `click` handler invokes `webContents.send` with channel `'menu:open-settings'`
  on the focused `BrowserWindow` (assert via a stubbed/fake window).
- e2e (`tests/e2e/`): launching the app and triggering the Edit ▸ Settings… menu item results in the
  Settings modal (`data-testid="settings-general"`) becoming visible.

## REQ-003 — `menu:open-settings` is a declared, wired IPC channel
**MUST.** The channel MUST be declared in `src/shared/ipc-contract.ts` (channel-name map +
`onOpenSettings` on `TermhallaApi`), exposed in `src/preload/index.ts`, and consumed in
`src/renderer/api.ts` / wherever push subscriptions are registered — so no renderer reads an
undeclared channel and `npm run typecheck` passes. The subscription MUST return an unsubscribe
function that detaches the listener.

**Acceptance:**
- `npm run typecheck` succeeds with the new channel and `onOpenSettings` member referenced from the
  renderer.
- Unit/e2e: subscribing then calling the returned unsubscribe stops further `menu:open-settings`
  callbacks from firing (CONV-002 boundary: unsubscribe is exercised, not just subscribe).

## REQ-004 — Gear (⚙) Settings button removed; other entry points preserved
**MUST.** The `data-testid="settings-button"` gear button MUST be removed from
`src/renderer/components/WorkspaceTabs.tsx`. Settings MUST remain reachable via: the new Edit menu
(REQ-002), the Command Palette entry, the pane context-menu entry, and the `Ctrl+,` keybinding
(`open-settings`). None of those three pre-existing entry points may be removed or altered.

**Acceptance:**
- e2e: after launch, no element with `data-testid="settings-button"` exists in the workspace-tabs bar.
- e2e: the `Ctrl+,` keybinding still opens Settings; the Command Palette still lists a Settings entry
  that opens it; the pane context menu still has a Settings entry that opens it. (At least the
  `Ctrl+,` path is asserted directly; palette + context-menu paths asserted by their existing tests
  remaining green.)

## REQ-005 — `success`/`info` toasts disabled by default (deliberate behavior change)
**MUST.** **`success`- and `info`-kind** toasts MUST be suppressed unless the user has explicitly
enabled them (`quick.toastsEnabled === true`). For a fresh install and for any existing `quick.json`
that lacks the field, the effective state for these kinds MUST be **OFF**. This is a deliberate
change from prior behavior (toasts always rendered) and is called out here per CONV-003 (no silent
behavior change). **`error`-kind toasts are explicitly excluded from this default-OFF gate and
always render** (REQ-010); the default-OFF applies to `success`/`info` only.

**Acceptance:**
- Unit: with `quick.toastsEnabled` `undefined`, calling `pushToast(text, 'success')` and
  `pushToast(text, 'info')` (and/or rendering `Toasts`) produces **zero** visible toasts; the default
  is pinned by an explicit assertion `=== off`.
- Unit: with `quick.toastsEnabled === false`, same suppression for `success`/`info`.
- Unit: with `quick.toastsEnabled` `undefined`/`false`, `pushToast(text, 'error')` still surfaces a
  toast (cross-reference REQ-010) — asserting the carve-out, not blanket suppression.

## REQ-006 — Toast suppression is global, gated at one chokepoint, branching on kind
**MUST.** Suppression MUST be enforced at a single source-of-truth chokepoint — `pushToast`
(`src/renderer/store/toasts-slice.ts`) — such that **no individual `pushToast` call site needs
modification**. The chokepoint MUST branch on `kind`: when disabled (`toastsEnabled !== true`), a
`success`/`info` toast is NOT added to the visible `toasts` stack, but an `error` toast IS added
(REQ-010). The gate must hold regardless of which call site invoked it.

**Acceptance:**
- Unit: with toasts disabled, calling `pushToast` with kind `success` or `info` from any call site
  adds nothing to the rendered/visible toast set; calling with kind `error` adds a toast. With toasts
  enabled, all kinds surface (capped at the existing `MAX_TOASTS = 4` — CONV-003: the cap stays
  asserted).
- Static/structural: the single chokepoint is the only place the enable/kind check lives; no
  `pushToast` call site outside the chokepoint is changed to add a per-call enable check (verified by
  the diff / by the single-gate test).

## REQ-007 — Toast toggle persists in QuickStore as an additive optional field
**MUST.** Enabling/disabling the toast preference MUST set `quick.toastsEnabled` and persist it to
`quick.json` via the existing debounced `scheduleQuickSave()` path (the `setToastsEnabled` action,
mirroring `setCopyOnSelect`). The field is **additive and optional**; `SCHEMA_VERSION` MUST **not**
be bumped for it. An old `quick.json` written before this field existed MUST load cleanly with
`toastsEnabled` absent and the effective state OFF for `success`/`info` (no migration, no parse
error, no default-on).

**Acceptance:**
- Unit: loading a `QuickStore` object lacking `toastsEnabled` (e.g. `EMPTY_QUICK` / a legacy fixture)
  yields a valid store with `success`/`info` toasts effectively OFF and does not throw (CONV-002
  malformed/legacy input).
- Unit: `setToastsEnabled(true)` sets `quick.toastsEnabled === true` and triggers `scheduleQuickSave`;
  `setToastsEnabled(false)` sets it `false` and triggers `scheduleQuickSave`.
- Assertion that `SCHEMA_VERSION` is unchanged by this feature.

## REQ-008 — Toast toggle checkbox in General settings
**MUST.** `src/renderer/components/GeneralSettings.tsx` MUST render a checkbox (alongside
copy-on-select) bound to `quick.toastsEnabled` via `setToastsEnabled`, with a stable
`data-testid` (e.g. `toasts-enabled`) and a clear label (e.g. "Show toast notifications"). Its
`checked` state MUST reflect strict-`true` (unchecked when `undefined`/`false`), and toggling it
MUST call `setToastsEnabled` with the checkbox value. The label/help text SHOULD make clear the
toggle governs `success`/`info` notifications and that error notifications always appear.

**Acceptance:**
- e2e: the General settings section shows a checkbox `data-testid="toasts-enabled"`; with no prior
  preference it renders **unchecked**; checking it then triggering a `success`/`info` toast surfaces a
  toast, and unchecking it suppresses subsequent `success`/`info` toasts.

## REQ-009 — Documentation updated (doc-drift)
**SHOULD.** Because Settings moves and a menu is added with a default-off behavior change, the
changelog and affected docs MUST be updated: `CHANGELOG.md` notes the new Edit menu, the removed
gear button, and the default-off toast change (scoped to `success`/`info`, with errors exempt); the
relevant feature/where-things-live docs reflect the new IPC channel and the moved entry point. The
`docs/decisions.md:404-410` **runOp guarantee is preserved** by the REQ-010 error carve-out (the
"Save failed" toast still surfaces), so that note does **not** require amendment — resolving
FINDING-DOC-001 (doc-drift).

**Acceptance:** `CHANGELOG.md` contains an entry for this feature naming (a) the Edit ▸ Settings…
menu, (b) removal of the gear button, and (c) `success`/`info` toasts now default OFF while error
toasts always show; a reviewer can trace the `menu:open-settings` channel to a doc mention, and can
confirm `docs/decisions.md:404-410` is left intact (still accurate). (Doc-only; verified by
review/doc-sync, not a unit test.)

## REQ-010 — `error`-kind toasts are never suppressed by the toast preference
**MUST.** An `error`-kind toast MUST surface (be enqueued onto the visible `toasts` stack) even when
`quick.toastsEnabled` is `undefined` or `false`. The `success`/`info` default-OFF gate (REQ-005,
REQ-006) MUST NOT apply to `error` toasts. This carve-out preserves the editor "Save failed" signal
(`use-editor-tabs.ts` via `runOp`) — the only indication of a failed write — and therefore upholds
the documented runOp guarantee (`docs/decisions.md:404-410`). Per CONV-003 the carve-out is specified
here and MUST be asserted by a test. (ESC-001 / FINDING-DA-001 HIGH resolution.)

**Acceptance:**
- Unit: with `quick.toastsEnabled` `undefined`, `pushToast(text, 'error')` enqueues a toast (visible
  `toasts` length increases / contains the error entry).
- Unit: with `quick.toastsEnabled === false`, `pushToast(text, 'error')` still enqueues a toast.
- Unit (negative control, pins the kind branch): with the same disabled state,
  `pushToast(text, 'info')` and `pushToast(text, 'success')` enqueue **nothing** — confirming the
  bypass is keyed on `kind === 'error'`, not a blanket pass-through.

---

## Cross-cutting convention checks
- **CONV-001 (specific/actionable errors):** This feature surfaces no new user-facing error strings
  (menu click, checkbox toggle, additive load are non-failing paths). If the legacy-load path is made
  to validate input and reject, any rejection message MUST name the field and file. No bare
  `"invalid input"`.
- **CONV-002 (empty/boundary/malformed):** Covered by REQ-003 (unsubscribe), REQ-005/REQ-007
  (absent/undefined/false preference, legacy `quick.json`).
- **CONV-003 (no silent truncation/behavior change):** Covered by REQ-005 (`success`/`info` default-off
  is explicit + tested), REQ-006 (`MAX_TOASTS` cap remains asserted), and REQ-010 (the `error`
  carve-out is specified and asserted — no silent suppression of the failed-write signal).

## Open questions
_None._ All brainstorm decisions are resolved, including the Iteration 1 error carve-out (ESC-001):
the suppression chokepoint stays single (`pushToast`) but branches on `kind`, so `error` toasts
always render (REQ-010) while `success`/`info` default OFF (REQ-005). The schema-migration story
(additive optional, no SCHEMA_VERSION bump) is confirmed as REQ-007.
