import { defineConfig } from '@playwright/test'

// Suite-wide default: slow the busy-gated CIM/WMI process poll to ~off. In production it
// spawns a powershell.exe (`Get-CimInstance Win32_Process`) every second per busy terminal;
// during the spawn-heavy suite that powershell-per-second churn contends with node-pty
// ConPTY spawns and intermittently hangs a terminal-spawning spec for the full 60s timeout.
// The two specs that actually assert proc-derived data (procs, ai-session) re-enable the
// fast 1s poll via a per-launch env override. This config side-effect runs in each worker,
// so electron.launch (which inherits the worker's process.env) picks it up.
process.env.TERMHALLA_PROC_POLL_MS ??= '60000'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Launch-heavy specs can lose timing margin under whole-suite CPU contention even though
  // they pass deterministically in isolation. Two retries absorb that load flakiness (the
  // standard mitigation for launch-heavy e2e; we also pin workers: 1 and slow the proc poll
  // above to cut the dominant contention source).
  retries: 2,
  // Whole-suite cap. Each launch-heavy spec can need its full 60s timeout plus retries under
  // CPU contention; with ~50 specs the suite must not be guillotined mid-run (which silently
  // leaves specs "did not run"). 20 min leaves ample headroom over the ~9-min happy path.
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
