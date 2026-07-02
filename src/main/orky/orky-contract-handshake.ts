import { ORKY_PHASES } from '@shared/orky-status'
import { locateOrkyCli } from './orky-cli-locate'
import { runOrkyCli } from './orky-cli-runner'

/**
 * Startup contract handshake against the ACTUALLY-INSTALLED Orky plugin (cross-repo contract-review
 * hardening) — the runtime complement to the golden-fixture suite
 * (tests/shared/orky-contract-golden.test.ts): the fixtures pin agreement with a committed SNAPSHOT of
 * the producer, while this check runs `node <plugin>/gatekeeper/cli.js contract` against whatever
 * `ORKY_PLUGIN_DIR` points at RIGHT NOW, so an in-place Orky upgrade with breaking schema changes
 * produces one loud warn line at startup instead of staying invisible until something breaks.
 *
 * This is LOG-ONLY OBSERVABILITY, never a behavior gate: a mismatch warns and returns `ok:false`, but
 * nothing consults the result to block dispatch — Termhalla keeps working (possibly degraded) exactly
 * as it would have without the check. NEVER throws, NEVER rejects. An absent CLI or an older Orky
 * without the `contract` subcommand (non-zero exit / unparseable stdout) is tolerated as
 * `ok:true` + `note` with a softer warn — skew is simply undetectable there, not proven.
 */

/** The contract major version Termhalla's mirrored constants (`ORKY_PHASES`, the OSC parser, the
 *  shared mappers) were written against. Bump ONLY together with a deliberate re-mirror. */
export const EXPECTED_CONTRACT_VERSION = 1

/** Handshake-specific timeout — shorter than `DEFAULT_CLI_TIMEOUT_MS` (15s): `contract` is a pure
 *  constant dump, so 10s is already generous, and this runs at startup where hanging longer buys
 *  nothing (the runner resolves `timedOut:true` rather than rejecting either way). */
export const CONTRACT_HANDSHAKE_TIMEOUT_MS = 10_000

export interface OrkyContractCheck {
  /** `false` ONLY on a proven mismatch. Undetectable (CLI absent / pre-`contract` Orky) is `true`+`note`. */
  ok: boolean
  /** The plugin's reported `contract_version`; `null` when it could not be determined. */
  contractVersion: number | null
  /** One human-readable entry per disagreeing field, each carrying BOTH sides' values. */
  mismatches: string[]
  /** Set iff the check could not actually compare (absent CLI / old Orky / unexpected failure). */
  note?: string
}

/** Injectable seams, mirroring `OrkyActionDispatcherDeps`' style — defaults are the real
 *  `locateOrkyCli` (bound to `process.env`), the real `runOrkyCli`, and `console.warn`. */
export interface OrkyContractHandshakeDeps {
  locate?: (kind: 'gatekeeper' | 'feedback') => string | null
  runCli?: (
    cliPath: string,
    args: string[],
    opts?: { timeoutMs?: number; signal?: AbortSignal }
  ) => Promise<{ exitCode: number | null; stdout: string; timedOut: boolean }>
  warn?: (line: string) => void
}

/** Per-located-path memo for the process lifetime — the handshake spawns a child process, so it runs
 *  at most ONCE per resolved cli.js path no matter how many callers ask (the promise itself is cached,
 *  deduplicating concurrent calls too). The not-located branch is not cached: it spawns nothing and a
 *  later re-check is free. */
const cacheByPath = new Map<string, Promise<OrkyContractCheck>>()

function fmt(list: readonly unknown[] | unknown): string {
  return Array.isArray(list) ? `[${list.join(', ')}]` : JSON.stringify(list)
}

/**
 * Locate the gatekeeper cli.js, run its `contract` subcommand, and compare the emitted
 * `contract_version`/`phases` against Termhalla's mirrors (`EXPECTED_CONTRACT_VERSION`,
 * `ORKY_PHASES`). One detailed `warn` line on a proven mismatch (both sides' values); one softer
 * line when skew is undetectable. Always resolves; never throws.
 */
export function verifyOrkyContract(deps: OrkyContractHandshakeDeps = {}): Promise<OrkyContractCheck> {
  const locate = deps.locate ?? locateOrkyCli
  const warn = deps.warn ?? console.warn

  const cliPath = locate('gatekeeper')
  if (!cliPath) {
    // Nothing installed to skew against — softer note, no subprocess, no cache entry.
    const note = 'no gatekeeper cli.js located (is ORKY_PLUGIN_DIR set?) — contract handshake skipped'
    warn(`[orky] ${note}; version skew undetectable`)
    return Promise.resolve({ ok: true, contractVersion: null, mismatches: [], note })
  }

  const cached = cacheByPath.get(cliPath)
  if (cached) return cached

  const pending = runHandshake(cliPath, deps.runCli ?? runOrkyCli, warn)
  cacheByPath.set(cliPath, pending)
  return pending
}

async function runHandshake(
  cliPath: string,
  runCli: NonNullable<OrkyContractHandshakeDeps['runCli']>,
  warn: (line: string) => void
): Promise<OrkyContractCheck> {
  try {
    const run = await runCli(cliPath, ['contract'], { timeoutMs: CONTRACT_HANDSHAKE_TIMEOUT_MS })

    // Old Orky: no `contract` subcommand (non-zero exit / timeout) or non-JSON output. Tolerated —
    // this predates the handshake, so skew is undetectable, not proven. Softer warn, ok:true + note.
    let contract: Record<string, unknown> | null = null
    if (run.exitCode === 0 && !run.timedOut) {
      try {
        const parsed: unknown = JSON.parse(run.stdout)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          contract = parsed as Record<string, unknown>
        }
      } catch {
        /* unparseable → handled by the null check below */
      }
    }
    if (contract === null || typeof contract.contract_version !== 'number') {
      const note = 'Orky plugin predates the contract command — version skew undetectable'
      warn(`[orky] ${note} (gatekeeper: ${cliPath})`)
      return { ok: true, contractVersion: null, mismatches: [], note }
    }

    const contractVersion = contract.contract_version
    const mismatches: string[] = []
    if (contractVersion !== EXPECTED_CONTRACT_VERSION) {
      mismatches.push(
        `contract_version: plugin=${contractVersion} expected=${EXPECTED_CONTRACT_VERSION}`
      )
    }
    const phases = contract.phases
    const phasesMatch =
      Array.isArray(phases) &&
      phases.length === ORKY_PHASES.length &&
      ORKY_PHASES.every((p, i) => phases[i] === p)
    if (!phasesMatch) {
      mismatches.push(`phases: plugin=${fmt(phases)} expected=${fmt(ORKY_PHASES)}`)
    }

    if (mismatches.length > 0) {
      // ONE detailed line carrying both sides of every disagreement — log-only, never a gate.
      warn(
        `[orky] contract mismatch with installed Orky plugin (${cliPath}): ${mismatches.join('; ')}` +
          ` — Termhalla's mirrored constants may misread this plugin until re-mirrored`
      )
      return { ok: false, contractVersion, mismatches }
    }
    return { ok: true, contractVersion, mismatches: [] }
  } catch (e) {
    // Defensive: the runner never rejects by contract, but the handshake must never throw regardless.
    const note = `contract handshake failed unexpectedly: ${(e as Error).message}`
    warn(`[orky] ${note} (gatekeeper: ${cliPath}); version skew undetectable`)
    return { ok: true, contractVersion: null, mismatches: [], note }
  }
}
