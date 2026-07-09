/**
 * How the e2e harness is allowed to put pixels on the developer's screen.
 *
 * The suite launches one app per spec (~190 of them) across a ~13 minute run, so anything that
 * presents — a window, a desktop toast — interrupts whatever the developer is doing, including an
 * installed Termhalla. `TERMHALLA_E2E_WINDOW` is set only by `playwright.config.ts`; unset (the
 * product default) every predicate here reports production behavior, so nothing below can change
 * how the shipped app behaves.
 *
 *   'hidden'   — the e2e default. Windows are created, laid out, and fully scriptable, but never
 *                shown. `showInactive()` is NOT enough: it withholds keyboard focus yet still
 *                raises. Requires `backgroundThrottling: false` on the window (a never-shown
 *                window is a background window, and Chromium would throttle the timers/rAF that
 *                xterm's render loop rides).
 *   'inactive' — shown, never activated. Still covers your work.
 *   'show' / unset — production: show and focus.
 */
export type PresentationMode = 'hidden' | 'inactive' | 'show'

/** Pure given its argument; defaults to reading the harness env at call time. */
export function presentationMode(
  raw: string | undefined = process.env.TERMHALLA_E2E_WINDOW
): PresentationMode {
  return raw === 'hidden' || raw === 'inactive' ? raw : 'show'
}

/** Whether a newly-created window may be presented at all. */
export function presentsWindows(mode: PresentationMode = presentationMode()): boolean {
  return mode !== 'hidden'
}

/**
 * Whether main may raise an OS-level surface: a desktop `Notification`, or bringing a window to the
 * front from a background event (a notification click).
 *
 * The Orky needs-you notifier lives entirely in main and consults no window, so it fires REAL desktop
 * toasts for any spec that seeds a needs-you root without arming `TERMHALLA_E2E_NOTIFY_SPY`. The
 * notification-click handler then calls `show()` + `focus()` on the main window, which presents a
 * window the harness deliberately never presented (`orky-notify.spec.ts` invokes that handler).
 *
 * The pane needs-input toast (`register-pty.ts`) is gated here too, as defense in depth. It is not
 * currently reachable under Playwright: the renderer only asks for it when `!document.hasFocus()`,
 * and Playwright enables CDP focus emulation, so `document.hasFocus()` is true in EVERY mode — the
 * product's own guard already closes that path. Measured, not assumed; don't rely on it.
 *
 * False for both harness modes rather than 'hidden' alone: `inactive` presents a window but never
 * activates it, so main-side focus (`BrowserWindow.getFocusedWindow()`) is still absent and a raise
 * would still steal the foreground.
 */
export function raisesOsSurfaces(mode: PresentationMode = presentationMode()): boolean {
  return mode === 'show'
}
