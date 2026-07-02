// Contract-handshake suite — cross-repo contract-review hardening (NEW file; the 0007 suites are
// FROZEN and untouched). Targets `src/main/orky/orky-contract-handshake.ts` — the RUNTIME complement
// to tests/shared/orky-contract-golden.test.ts: the golden suite pins agreement with a committed
// fixture snapshot; `verifyOrkyContract` runs `gatekeeper contract` against the ACTUALLY-INSTALLED
// plugin at startup and warns (log-only, never a gate) on `contract_version`/`phases` skew.
//
// Mocking approach mirrors tests/main/orky-action-dispatcher.test.ts: FAKE injected `runCli`/`locate`
// seams (never a real subprocess here — real-spawn coverage is orky-cli-runner.test.ts's job) plus an
// injected `warn` spy. The module caches per LOCATED PATH for the process lifetime, so every test
// locates a UNIQUE fake path (a shared literal would leak one test's cached result into the next);
// the caching test reuses ONE path across two calls on purpose.
import { describe, it, expect, vi } from 'vitest'
import {
  verifyOrkyContract,
  EXPECTED_CONTRACT_VERSION,
  CONTRACT_HANDSHAKE_TIMEOUT_MS
} from '../../src/main/orky/orky-contract-handshake'
import { ORKY_PHASES } from '@shared/orky-status'

type CliRun = { exitCode: number | null; stdout: string; timedOut: boolean }

let pathSeq = 0
/** A unique fake cli.js path per test — the module-level cache is keyed on the located path. */
function uniquePath(): string {
  return `C:/fake/orky-${++pathSeq}/gatekeeper/cli.js`
}

function goodContract(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    contract_version: 1,
    phases: [...ORKY_PHASES],
    osc: { code: 9999, v: 1, terminator: 'BEL', max_payload_bytes: 4096 },
    ...overrides
  })
}

function fakeRunCli(result: CliRun): {
  run: (cliPath: string, args: string[], opts?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<CliRun>
  calls: Array<{ cliPath: string; args: string[]; timeoutMs?: number }>
} {
  const calls: Array<{ cliPath: string; args: string[]; timeoutMs?: number }> = []
  const run = async (cliPath: string, args: string[], opts?: { timeoutMs?: number }): Promise<CliRun> => {
    calls.push({ cliPath, args, timeoutMs: opts?.timeoutMs })
    return result
  }
  return { run, calls }
}

// ---------------------------------------------------------------------------------------------------

describe('verifyOrkyContract — matching contract (the healthy path)', () => {
  it('a plugin emitting contract_version 1 + the exact ORKY_PHASES list is ok, no mismatches, NO warn', async () => {
    const path = uniquePath()
    const { run, calls } = fakeRunCli({ exitCode: 0, stdout: goodContract(), timedOut: false })
    const warn = vi.fn()
    const r = await verifyOrkyContract({ locate: () => path, runCli: run, warn })
    expect(r).toEqual({ ok: true, contractVersion: 1, mismatches: [] })
    expect(warn).not.toHaveBeenCalled()
    // The invocation itself is pinned: the literal `contract` subcommand, the handshake's short timeout.
    expect(calls).toHaveLength(1)
    expect(calls[0].cliPath).toBe(path)
    expect(calls[0].args).toEqual(['contract'])
    expect(calls[0].timeoutMs).toBe(CONTRACT_HANDSHAKE_TIMEOUT_MS)
  })

  it('extra unknown contract fields are tolerated, never a mismatch (consumers must tolerate additions)', async () => {
    const { run } = fakeRunCli({
      exitCode: 0,
      stdout: goodContract({ some_future_field: { nested: true } }),
      timedOut: false
    })
    const warn = vi.fn()
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn })
    expect(r.ok).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('verifyOrkyContract — proven mismatches (the drift catcher)', () => {
  it('contract_version 2 → ok:false, a mismatch naming BOTH sides, exactly one detailed warn line', async () => {
    const { run } = fakeRunCli({
      exitCode: 0,
      stdout: goodContract({ contract_version: 2 }),
      timedOut: false
    })
    const warn = vi.fn()
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn })
    expect(r.ok).toBe(false)
    expect(r.contractVersion).toBe(2)
    expect(r.mismatches).toHaveLength(1)
    expect(r.mismatches[0]).toContain('contract_version')
    expect(r.mismatches[0]).toContain('2')                               // theirs
    expect(r.mismatches[0]).toContain(String(EXPECTED_CONTRACT_VERSION)) // ours
    expect(warn).toHaveBeenCalledTimes(1)
    const line = warn.mock.calls[0][0] as string
    expect(line).toContain('contract_version')
    expect(line).toContain('plugin=2')
    expect(line).toContain(`expected=${EXPECTED_CONTRACT_VERSION}`)
  })

  it('phase-list drift (an inserted phase) → ok:false, the mismatch carries both phase lists', async () => {
    const drifted = [...ORKY_PHASES.slice(0, 4), 'security-review', ...ORKY_PHASES.slice(4)]
    const { run } = fakeRunCli({
      exitCode: 0,
      stdout: goodContract({ phases: drifted }),
      timedOut: false
    })
    const warn = vi.fn()
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn })
    expect(r.ok).toBe(false)
    expect(r.contractVersion).toBe(1) // version still matches; ONLY phases drifted
    expect(r.mismatches).toHaveLength(1)
    expect(r.mismatches[0]).toContain('phases')
    expect(r.mismatches[0]).toContain('security-review')  // theirs
    expect(r.mismatches[0]).toContain('human-review')     // ours
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a same-length phase RENAME (human-review → human) is still drift, not a length-only check', async () => {
    const renamed = [...ORKY_PHASES.slice(0, -1), 'human']
    const { run } = fakeRunCli({
      exitCode: 0,
      stdout: goodContract({ phases: renamed }),
      timedOut: false
    })
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn: vi.fn() })
    expect(r.ok).toBe(false)
    expect(r.mismatches.some((m) => m.includes('phases'))).toBe(true)
  })

  it('version AND phase drift together → both mismatches reported in ONE result / ONE warn line', async () => {
    const { run } = fakeRunCli({
      exitCode: 0,
      stdout: goodContract({ contract_version: 2, phases: ['brainstorm'] }),
      timedOut: false
    })
    const warn = vi.fn()
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn })
    expect(r.ok).toBe(false)
    expect(r.mismatches).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('verifyOrkyContract — graceful degradation (never a throw, never a hard fail)', () => {
  it('no CLI located (locate → null) → ok:true with a note, runner NEVER invoked, no throw', async () => {
    const { run, calls } = fakeRunCli({ exitCode: 0, stdout: goodContract(), timedOut: false })
    const warn = vi.fn()
    const r = await verifyOrkyContract({ locate: () => null, runCli: run, warn })
    expect(r.ok).toBe(true)
    expect(r.contractVersion).toBeNull()
    expect(r.mismatches).toEqual([])
    expect(r.note).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('old Orky without the contract subcommand (non-zero exit) → ok:true + note, softer "predates" warn', async () => {
    const { run } = fakeRunCli({ exitCode: 2, stdout: 'Unknown command: contract', timedOut: false })
    const warn = vi.fn()
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn })
    expect(r.ok).toBe(true)
    expect(r.contractVersion).toBeNull()
    expect(r.mismatches).toEqual([])
    expect(r.note).toContain('predates')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('version skew undetectable')
  })

  it('exit 0 but unparseable stdout (not JSON) → ok:true + note, never a throw', async () => {
    const { run } = fakeRunCli({ exitCode: 0, stdout: 'usage: gatekeeper <cmd>', timedOut: false })
    const warn = vi.fn()
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn })
    expect(r.ok).toBe(true)
    expect(r.note).toBeTruthy()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('exit 0 with JSON that carries no numeric contract_version → tolerated as pre-contract, not a mismatch', async () => {
    const { run } = fakeRunCli({ exitCode: 0, stdout: '{"ok":true}', timedOut: false })
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn: vi.fn() })
    expect(r.ok).toBe(true)
    expect(r.contractVersion).toBeNull()
    expect(r.note).toBeTruthy()
  })

  it('a timed-out runner ({exitCode:null, timedOut:true}) → ok:true + note, never a throw/hang', async () => {
    const { run } = fakeRunCli({ exitCode: null, stdout: '', timedOut: true })
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn: vi.fn() })
    expect(r.ok).toBe(true)
    expect(r.contractVersion).toBeNull()
  })

  it('even a runner that REJECTS (contract violation of runOrkyCli) is swallowed → ok:true + note, never a rejection', async () => {
    const run = async (): Promise<CliRun> => { throw new Error('spawn EPERM') }
    const warn = vi.fn()
    const r = await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn })
    expect(r.ok).toBe(true)
    expect(r.note).toBeTruthy()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('verifyOrkyContract — per-located-path process-lifetime cache', () => {
  it('two calls locating the SAME path invoke the runner exactly once and return the same result', async () => {
    const path = uniquePath()
    const { run, calls } = fakeRunCli({ exitCode: 0, stdout: goodContract(), timedOut: false })
    const warn = vi.fn()
    const r1 = await verifyOrkyContract({ locate: () => path, runCli: run, warn })
    const r2 = await verifyOrkyContract({ locate: () => path, runCli: run, warn })
    expect(calls).toHaveLength(1) // cached — the child process is never respawned for the same path
    expect(r2).toEqual(r1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a mismatch result is cached too — the detailed warn line fires once, not once per caller', async () => {
    const path = uniquePath()
    const { run, calls } = fakeRunCli({
      exitCode: 0,
      stdout: goodContract({ contract_version: 3 }),
      timedOut: false
    })
    const warn = vi.fn()
    const r1 = await verifyOrkyContract({ locate: () => path, runCli: run, warn })
    const r2 = await verifyOrkyContract({ locate: () => path, runCli: run, warn })
    expect(r1.ok).toBe(false)
    expect(r2).toEqual(r1)
    expect(calls).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a DIFFERENT located path is a fresh handshake (cache is keyed per path, not global)', async () => {
    const { run, calls } = fakeRunCli({ exitCode: 0, stdout: goodContract(), timedOut: false })
    await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn: vi.fn() })
    await verifyOrkyContract({ locate: () => uniquePath(), runCli: run, warn: vi.fn() })
    expect(calls).toHaveLength(2)
  })

  it('concurrent calls for one path share ONE in-flight handshake (the promise is what is cached)', async () => {
    const path = uniquePath()
    let invocations = 0
    const run = (): Promise<CliRun> => {
      invocations++
      return new Promise((resolve) =>
        setTimeout(() => resolve({ exitCode: 0, stdout: goodContract(), timedOut: false }), 20)
      )
    }
    const [r1, r2] = await Promise.all([
      verifyOrkyContract({ locate: () => path, runCli: run, warn: vi.fn() }),
      verifyOrkyContract({ locate: () => path, runCli: run, warn: vi.fn() })
    ])
    expect(invocations).toBe(1)
    expect(r1.ok).toBe(true)
    expect(r2).toEqual(r1)
  })
})
