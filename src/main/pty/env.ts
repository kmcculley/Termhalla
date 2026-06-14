// Variables Electron injects into its own process that must not leak into
// spawned user shells (e.g. ELECTRON_RUN_AS_NODE makes a child `electron` run as node).
const STRIP = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_RENDERER_URL'
])

/** Return a copy of `env` with Electron-injected variables removed. Pure; does not mutate input. */
export function sanitizeShellEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !STRIP.has(k)) out[k] = v
  }
  return out
}
