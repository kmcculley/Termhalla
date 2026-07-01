import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The SINGLE shared Orky CLI resolver (feature 0007, TASK-003, REQ-012) — used by every action
 * that needs a CLI (`gatekeeper`/`feedback`), never duplicated. Injectable `env`/`exists` so it is
 * unit-testable without touching the real filesystem/environment. NEVER throws.
 *
 * Resolution order: an explicit `ORKY_PLUGIN_DIR` env var -> `join(dir, kind, 'cli.js')`
 * existence-checked -> else `null`. No default path is assumed valid on an arbitrary machine (the
 * intake's `C:/dev/Orky/plugin/...` is Kevin's machine only) — a fresh machine gets the honest
 * `orky-cli-not-found` error (via `describeMissingCli`) rather than a guess that silently succeeds on
 * one dev box and fails everywhere else.
 */
export function locateOrkyCli(
  kind: 'gatekeeper' | 'feedback',
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync
): string | null {
  const dir = env.ORKY_PLUGIN_DIR
  if (!dir) return null
  const cliPath = join(dir, kind, 'cli.js')
  return exists(cliPath) ? cliPath : null
}

/** The exact actionable message REQ-012 requires when a CLI could not be located, reused by the
 *  dispatcher for both `resolveEscalation`'s/`submitWork`'s `feedback` lookup and
 *  `recordHumanGate`'s/`driveStatus`'s `gatekeeper` lookup. Distinct per kind (CONV-001). */
export function describeMissingCli(kind: 'gatekeeper' | 'feedback'): string {
  return `the Orky ${kind} CLI could not be located; set ORKY_PLUGIN_DIR to your Orky plugin directory`
}
