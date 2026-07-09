import { defineConfig } from '@playwright/test'

// Don't interrupt the developer. Electron's `win.show()` raises AND activates each window, and the
// suite launches one app per spec — ~190 windows popping over whatever you're working on (including
// an installed Termhalla) across a ~13 minute run. So main never shows them: the windows are created,
// laid out, and fully scriptable, they are simply never presented. Layout-measuring specs (Monaco,
// xterm's FitAddon, the toolbar boxes) are unaffected — layout does not require presentation — and
// `backgroundThrottling: false` keeps the renderer's timers/rAF alive so xterm still paints its rows.
// `showInactive()` is NOT enough: it withholds keyboard focus but still raises the window.
// Every spec inherits this env — implicitly, or via `{ ...process.env }` — and each Playwright worker
// re-loads this file, so the assignment reaches every launch.
//   TERMHALLA_E2E_WINDOW=inactive npx playwright test   # visible, never focused
//   TERMHALLA_E2E_WINDOW=show     npx playwright test   # production behavior; watch the run
process.env.TERMHALLA_E2E_WINDOW ??= 'hidden'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Each spec launches its own Electron app with node-pty; terminal-spawning specs
  // intermittently lose their timing margin under whole-suite CPU contention (node-pty
  // ConPTY spawn + the busy-gated CIM/WMI process poll), even though they pass
  // deterministically in isolation. Two retries absorb that load flakiness — the standard
  // mitigation for launch-heavy e2e (we also pin workers: 1 below).
  retries: 2,
  // Whole-suite cap. Each launch-heavy spec can need its full 60s timeout plus retries under
  // contention; the suite must not be guillotined mid-run (which silently leaves specs
  // "did not run" — it happened at the 600s cap with ~50 specs, and AGAIN at the 1200s cap
  // once the suite grew to ~185 specs across the Orky features + the Remote Agent v1 epic:
  // 79 specs never ran). Scale this WITH the suite: ~12s/spec observed serial happy path
  // (~37 min at 185 specs) + retry headroom → 60 min.
  globalTimeout: 3_600_000,
  fullyParallel: false,
  // Each spec launches its own Electron app with node-pty + a system-wide
  // busy-gated process poll (CIM/WMI). Running multiple apps concurrently makes
  // those polls contend, starving the foreground-process / AI-session detection
  // (e.g. procs/cwd intermittently time out). Pin to a single worker so the
  // specs run serially, matching the non-parallel intent above.
  workers: 1,
  reporter: [['list']]
})
