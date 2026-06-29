# Edit menu + Settings entry + toast toggle (Orky 0001) — Review Follow-ups (deferred)

Feature `0001-edit-menu-settings-toasts` shipped READY. The HIGH error-suppression
risk (FINDING-DA-001 / FINDING-UX-001) was **resolved in iteration 1** — `error`-kind
toasts now bypass the toast-disable preference (`pushToast` branches on `kind`), pinned
by TEST-019/TEST-020 (REQ-010). The non-blocking items below were deferred, not fixed,
and are tracked here so they aren't lost. Full records live in
`.orky/features/0001-edit-menu-settings-toasts/findings.json`.

## Deferred follow-ups

- **[MEDIUM] Menu accelerator hard-coded vs the rebindable `open-settings` keybinding**
  (FINDING-UX-002, `src/main/menu.ts`). The Edit ▸ Settings… item registers
  `accelerator: 'CmdOrCtrl+,'`, duplicating the user-customizable `open-settings`
  keybinding (`src/shared/keybindings.ts`, dispatched in `src/renderer/App.tsx`). A
  registered menu accelerator intercepts the keystroke before the renderer keydown
  handler, so the menu — not the keybinding registry — effectively owns `Ctrl+,`; a user
  who remaps `open-settings` (or rebinds `Ctrl+,` to something else) finds their
  customization silently shadowed. Fix: derive the accelerator from the keybinding
  registry, or register with `registerAccelerator: false` so the renderer keybinding stays
  the single source of truth. Promoted to **CONV-005**.

- **[LOW] `CH.openSettings` key naming deviates from the `domainVerb` convention**
  (FINDING-QUA-001, `src/shared/ipc-contract.ts`). Every other push-channel key is
  domain-prefixed (`appFlush`, `ptyData`, `usageMetrics`, …); the new key is `openSettings`
  rather than `menuOpenSettings`. The string value `'menu:open-settings'` is correct; only
  the TS key name is inconsistent. Pure rename across `menu.ts`, `preload/index.ts`,
  `App.tsx` — no runtime impact.

- **[LOW] REQ-003 unsubscribe boundary not directly unit-tested** (FINDING-DA-002,
  `04-tests.md` TEST-003 / REQ-003). TEST-003 asserts only `CH.openSettings ===
  'menu:open-settings'`; the "unsubscribe stops further callbacks" acceptance bullet is
  enforced only by `npm run typecheck` + the App.tsx cleanup set, with no
  subscribe→unsubscribe→re-emit→assert-no-fire test. Add a headless test injecting a fake
  emitter into `pushChannel`, or an e2e that detaches and re-sends.

- **[INFO] UUID allocated before the suppression guard in `pushToast`**
  (FINDING-QUA-002, `src/renderer/store/toasts-slice.ts`). `const id = uuid()` runs before
  the `kind`/enable short-circuit, so every suppressed call mints and discards a UUID. This
  is **intentional** — the string-id return contract must be preserved so no call site
  special-cases the disabled state (REQ-006). No action required; consider strengthening the
  inline comment so a future maintainer doesn't "optimize" the ordering and break the
  return-type contract.

## Resolved in-feature (not deferred)

- FINDING-DA-001 / FINDING-UX-001 (error toasts swallowed by default-OFF gate) — fixed via
  the REQ-010 error carve-out.
- FINDING-UX-004 (checkbox copy didn't convey scope/default) — label changed to "Show
  success and info toast notifications (errors always show)".
- FINDING-UX-003 (Edit menu holds only Settings…) — accepted human design decision; standard
  clipboard/undo Edit actions explicitly deferred to a future feature.
- FINDING-DOC-001 / FINDING-DOC-002 (doc drift) — reconciled by doc-sync (this pass).
