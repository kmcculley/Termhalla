import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Extend global timeout so worker teardown (Electron process shutdown on
  // Windows with active node-pty sessions) does not fail the run.
  globalTimeout: 300_000,
  fullyParallel: false,
  // Each spec launches its own Electron app with node-pty + a system-wide
  // busy-gated process poll (CIM/WMI). Running multiple apps concurrently makes
  // those polls contend, starving the foreground-process / AI-session detection
  // (e.g. procs/cwd intermittently time out). Pin to a single worker so the
  // specs run serially, matching the non-parallel intent above.
  workers: 1,
  reporter: [['list']]
})
