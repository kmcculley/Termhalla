import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // maxWorkers capped: the watcher-heavy main-process suites (real chokidar, 5s
  // timeouts) starve and flake under unbounded parallelism on this suite's size —
  // and the Orky implement gate depends on 'npm test' being deterministic.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', minWorkers: 1, maxWorkers: 4, testTimeout: 15_000 }
})
