import type { OrkyActionResult } from './types'

/**
 * The pure, TOTAL exit-code + stdout-JSON -> `OrkyActionResult` core (feature 0007, TASK-006;
 * REQ-002/REQ-010/REQ-011). No fs/IPC/clock access. Also the single home of `DEFAULT_CLI_TIMEOUT_MS`
 * (15s) so `orky-cli-runner.ts` (main-process) imports it from here rather than redefining it.
 *
 * Evaluation order (pinned): timedOut check FIRST, then JSON-parse-of-stdout (a plain object only —
 * array/primitive/empty/garbage all reject), THEN the per-(cliKind,action) exit-code table. The CLI's
 * own `{error}` field, when present in parsed JSON, is surfaced VERBATIM (CONV-001) — never re-worded.
 * Any undocumented exit code is a defensive `cli-error` branch — this function is TOTAL.
 */

export const DEFAULT_CLI_TIMEOUT_MS = 15_000

export type DispatchAction = 'resolveEscalation' | 'submitWork' | 'recordHumanGate' | 'driveStatus'
export type CliKind = 'feedback' | 'gatekeeper'
export type CliRun = { exitCode: number | null; stdout: string; timedOut: boolean }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parsedErrorMessage(parsed: Record<string, unknown>): string | undefined {
  return typeof parsed.error === 'string' ? parsed.error : undefined
}

export function mapCliRunToResult(action: DispatchAction, cliKind: CliKind, run: CliRun): Partial<OrkyActionResult> {
  if (run.timedOut) {
    return {
      ok: false,
      exitCode: null,
      errorKind: 'cli-timeout',
      error: `the ${cliKind} command timed out after ${DEFAULT_CLI_TIMEOUT_MS / 1000}s`
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return {
      ok: false,
      exitCode: run.exitCode,
      errorKind: 'cli-unparseable',
      error: `the ${cliKind} command produced unexpected output (${run.stdout.length} bytes)`
    }
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      exitCode: run.exitCode,
      errorKind: 'cli-unparseable',
      error: `the ${cliKind} command produced unexpected output (${run.stdout.length} bytes)`
    }
  }

  const exitCode = run.exitCode

  if (cliKind === 'feedback') {
    // feedback emit ALWAYS exits 0; any other exit is undocumented/defensive.
    if (exitCode === 0) return { ok: true, exitCode, data: parsed }
    return {
      ok: false,
      exitCode,
      errorKind: 'cli-error',
      error: parsedErrorMessage(parsed) ?? `unexpected exit code ${exitCode} from ${cliKind}`
    }
  }

  // cliKind === 'gatekeeper'
  if (action === 'recordHumanGate') {
    if (exitCode === 0 || exitCode === 1) return { ok: true, exitCode, data: parsed }
    if (exitCode === 2) {
      return { ok: false, exitCode, errorKind: 'cli-error', error: parsedErrorMessage(parsed) ?? 'gatekeeper record failed' }
    }
    return { ok: false, exitCode, errorKind: 'cli-error', error: `unexpected exit code ${exitCode} from ${cliKind}` }
  }

  // resolveEscalation (gatekeeper fallback) / driveStatus
  if (exitCode === 0) return { ok: true, exitCode, data: parsed }
  if (exitCode === 2) {
    return { ok: false, exitCode, errorKind: 'cli-error', error: parsedErrorMessage(parsed) ?? `${cliKind} failed` }
  }
  return { ok: false, exitCode, errorKind: 'cli-error', error: `unexpected exit code ${exitCode} from ${cliKind}` }
}
