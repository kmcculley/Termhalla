import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Extend global timeout so worker teardown (Electron process shutdown on
  // Windows with active node-pty sessions) does not fail the run.
  globalTimeout: 300_000,
  fullyParallel: false,
  reporter: [['list']]
})
