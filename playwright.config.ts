import { defineConfig } from '@playwright/test'

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
  // contention; with ~50 specs the suite must not be guillotined mid-run (which silently
  // leaves specs "did not run", as happened at the previous 600s cap). 20 min leaves ample
  // headroom over the ~9-min happy path.
  globalTimeout: 1_200_000,
  fullyParallel: false,
  // Each spec launches its own Electron app with node-pty + a system-wide
  // busy-gated process poll (CIM/WMI). Running multiple apps concurrently makes
  // those polls contend, starving the foreground-process / AI-session detection
  // (e.g. procs/cwd intermittently time out). Pin to a single worker so the
  // specs run serially, matching the non-parallel intent above.
  workers: 1,
  reporter: [['list']]
})
