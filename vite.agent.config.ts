/**
 * The agent bundle build (REQ-015) — a single-file plain-Node artifact:
 *   entry src/agent/main.ts  ->  out/agent/termhalla-agent.cjs
 *
 * `npm run build` chains this after `electron-vite build`; the stdio integration test
 * (tests/agent-stdio-roundtrip.test.ts) builds programmatically THROUGH THIS SAME FILE with
 * only `build.outDir` overridden, so the artifact form `npm run build` ships is exactly what
 * CI proves against (REQ-016). Everything is bundled (the @shared protocol, the reused
 * src/main/status stack, the package.json version) EXCEPT Node builtins and `node-pty` —
 * the one native module, loaded lazily and only by the real backend.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  ssr: { noExternal: true },
  build: {
    target: 'node18',
    outDir: 'out/agent',
    // NOT emptied (feature 0023): the release workflow stages node-pty prebuilts into the
    // SIBLING out/agent/prebuilds/ dir (resolvePrebuiltRoot in src/main/remote/agent-artifact.ts)
    // BEFORE `npm run package` re-runs this build — emptying out/agent here would wipe them right
    // back out. This build always overwrites its one fixed-name output file
    // (termhalla-agent.cjs), so leaving prior sibling content in place is safe. Every test/CI
    // caller that needs a clean directory overrides both outDir AND emptyOutDir explicitly (see
    // tests/agent-stdio-*.test.ts, tests/remote-client-gold.test.ts,
    // tests/integration-*-full-stack.test.ts, tests/integration-node-pty-prebuilt.test.ts) and is
    // unaffected by this default.
    emptyOutDir: false,
    minify: false,
    ssr: resolve('src/agent/main.ts'),
    rollupOptions: {
      output: { format: 'cjs', entryFileNames: 'termhalla-agent.cjs' },
      external: ['node-pty']
    }
  }
})
