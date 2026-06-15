import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Each spec launches its own Electron app serially; relaunch/debounce-timing specs
  // (hot-exit/scratch restore, workspace rename+relaunch) occasionally lose their timing
  // margin under whole-suite CPU contention even though they pass deterministically in
  // isolation. One retry absorbs that load flakiness — the standard mitigation for
  // launch-heavy e2e (we already pin workers: 1).
  retries: 1,
  // Extend global timeout so worker teardown (Electron process shutdown on
  // Windows with active node-pty sessions) plus a retry does not fail the run.
  globalTimeout: 600_000,
  fullyParallel: false,
  // Each spec launches its own Electron app with node-pty + a system-wide
  // busy-gated process poll (CIM/WMI). Running multiple apps concurrently makes
  // those polls contend, starving the foreground-process / AI-session detection
  // (e.g. procs/cwd intermittently time out). Pin to a single worker so the
  // specs run serially, matching the non-parallel intent above.
  workers: 1,
  reporter: [['list']]
})
