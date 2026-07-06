// Test suite — feature 0024-agent-daemonization (phase 4, revision 2 — re-derived after the
// ESC-001 loop-back; REQ-003/004/006/009/010/011/018 as amended).
// The Definitions-table contract constants, the WORKSPACE-KEYED (D6′) file-name functions, the
// cross-version-frozen daemon metadata shape (now carrying `proto` — D4′), the detached-spawn
// spec (now routing the child's stdout/stderr to the daemon log sink — FINDING-011), and the
// size-capped daemon log sink (FINDING-010/015). Pure units + one real-tmp-fs log unit.
//
// Chosen contract (frozen here):
//   src/agent/daemon-constants.ts exports
//     DAEMON_IDLE_TIMEOUT_DEFAULT_MS = 300000, DAEMON_SPAWN_WAIT_MS = 10000,
//     BRIDGE_DAEMON_UNREACHABLE_EXIT = 96, DAEMON_LOG_MAX_BYTES = 1048576,
//     DAEMON_METADATA_FORMAT_VERSION = 1, BRIDGE_STATUS_PREFIX = 'TERMHALLA_BRIDGE_V1 ',
//     socketFileName(wsToken) = `agent-<wsToken>.sock`,
//     metadataFileName(wsToken) = `daemon-<wsToken>.json`,
//     logFileName(wsToken) = `daemon-<wsToken>.log`
//   src/agent/daemon-guard.ts exports buildDaemonMetadata / validateDaemonMetadata over the
//     six-key shape {formatVersion, pid, version, proto, backend, startedAt}
//   src/agent/spawn-daemon.ts exports buildDaemonSpawnSpec({ artifactPath, ptyBackend, logFd,
//     wsToken?, socketPath?, idleTimeoutMs? }) → { command, args, options: { detached: true,
//     stdio: ['ignore', logFd, logFd] } }
//   src/agent/daemon-server.ts exports createDaemonLogSink(logPath, maxBytes?) → { append(text) }
//     (construction truncates the previous generation; appends never grow the file past the cap
//     while keeping the most recent diagnostic — ring-style truncation is fine)
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DAEMON_IDLE_TIMEOUT_DEFAULT_MS, DAEMON_SPAWN_WAIT_MS, BRIDGE_DAEMON_UNREACHABLE_EXIT,
  DAEMON_LOG_MAX_BYTES, DAEMON_METADATA_FORMAT_VERSION, BRIDGE_STATUS_PREFIX,
  socketFileName, metadataFileName, logFileName
} from '../src/agent/daemon-constants'
import { buildDaemonMetadata, validateDaemonMetadata } from '../src/agent/daemon-guard'
import { buildDaemonSpawnSpec } from '../src/agent/spawn-daemon'
import { createDaemonLogSink } from '../src/agent/daemon-server'

describe('TEST-2403 REQ-003/004/006/009/010/011 the Definitions-table constants are the contract', () => {
  it('pins the exported values', () => {
    expect(DAEMON_IDLE_TIMEOUT_DEFAULT_MS).toBe(300_000)
    expect(DAEMON_SPAWN_WAIT_MS).toBe(10_000)
    expect(BRIDGE_DAEMON_UNREACHABLE_EXIT).toBe(96)
    expect(DAEMON_LOG_MAX_BYTES).toBe(1_048_576)
    expect(DAEMON_METADATA_FORMAT_VERSION).toBe(1)
    expect(BRIDGE_STATUS_PREFIX).toBe('TERMHALLA_BRIDGE_V1 ')
  })

  it('the bridge sentinel is distinct from every reserved exit in the remote stack', () => {
    // 127 launch-absent, 93/94 upload/npty sentinels, 95 npty race, 12 shim parse error,
    // 0/1/2 the agent's own taxonomy (REQ-010's Definitions row).
    for (const reserved of [127, 93, 94, 95, 12, 0, 1, 2, 255]) {
      expect(BRIDGE_DAEMON_UNREACHABLE_EXIT).not.toBe(reserved)
    }
  })
})

describe('TEST-2444 REQ-003/009/018 the on-disk names are workspace-keyed (D6′) and version-stable (D4/D4′)', () => {
  it('produces agent-<ws>.sock / daemon-<ws>.json / daemon-<ws>.log', () => {
    expect(socketFileName('w1')).toBe('agent-w1.sock')
    expect(metadataFileName('w1')).toBe('daemon-w1.json')
    expect(logFileName('w1')).toBe('daemon-w1.log')
  })

  it('distinct workspace tokens yield distinct names on every file (same-host coexistence, REQ-018)', () => {
    for (const fn of [socketFileName, metadataFileName, logFileName]) {
      expect(fn('alpha')).not.toBe(fn('beta'))
    }
  })

  it('the socket name is version-stable: no version digits, no template holes', () => {
    const name = socketFileName('ws-main_01')
    expect(name).not.toMatch(/\d+\.\d+/)
    expect(name).not.toContain('<')
    expect(name).toContain('ws-main_01')
  })
})

describe('TEST-2404 REQ-003 the daemon metadata shape is exact and cross-version frozen (now with proto)', () => {
  const good = {
    pid: 4711, version: '1.2.3', proto: 1, backend: 'fake', startedAt: '2026-07-06T00:00:00.000Z'
  }

  it('buildDaemonMetadata emits EXACTLY {formatVersion, pid, version, proto, backend, startedAt}', () => {
    const meta = buildDaemonMetadata(good)
    expect(Object.keys(meta as Record<string, unknown>).sort())
      .toEqual(['backend', 'formatVersion', 'pid', 'proto', 'startedAt', 'version'])
    expect(meta).toEqual({ formatVersion: 1, ...good })
  })

  it('validateDaemonMetadata accepts an (older) daemon\'s formatVersion-1 file — a newer client can read it', () => {
    const r = validateDaemonMetadata({
      formatVersion: 1, pid: 1, version: '0.0.1-old', proto: 1, backend: 'node-pty', startedAt: 'x'
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.meta.pid).toBe(1)
      expect(r.meta.proto).toBe(1)
    }
  })

  it('rejects extra keys, missing keys, wrong types, and a foreign formatVersion — never a throw', () => {
    const cases: unknown[] = [
      null, 'nope', [],
      { formatVersion: 1, ...good, host: 'leak.example' },      // extra key = a no-secrets breach
      { formatVersion: 1, version: '1.2.3', proto: 1, backend: 'fake', startedAt: 'x' }, // missing pid
      { formatVersion: 1, pid: 1, version: '1.2.3', backend: 'fake', startedAt: 'x' },   // missing proto
      { formatVersion: 1, ...good, pid: '4711' },                // wrong type
      { formatVersion: 1, ...good, proto: '1' },                 // proto must be a number
      { formatVersion: 2, ...good }                              // not the frozen v1 shape
    ]
    for (const raw of cases) {
      const r = validateDaemonMetadata(raw)
      expect(r.ok, `must reject ${JSON.stringify(raw)}`).toBe(false)
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
    }
  })
})

describe('TEST-2405 REQ-004/REQ-011 the detached daemon spawn spec: setsid semantics, log-routed stdio, --ws forwarding', () => {
  it('builds node <artifact> --daemon --pty=<b> --ws=<t>, detached, stdout/stderr to the log fd (FINDING-011)', () => {
    const spec = buildDaemonSpawnSpec({
      artifactPath: '/home/u/.termhalla/agent/termhalla-agent-1.2.3.cjs',
      ptyBackend: 'fake',
      wsToken: 'ws1',
      logFd: 7
    })
    expect(spec.command, 'the daemon runs under the same node executable').toBe(process.execPath)
    expect(spec.args[0]).toBe('/home/u/.termhalla/agent/termhalla-agent-1.2.3.cjs')
    expect(spec.args).toContain('--daemon')
    expect(spec.args).toContain('--pty=fake')
    expect(spec.args, 'the workspace scope is forwarded (REQ-011)').toContain('--ws=ws1')
    expect(spec.args, 'the daemon is never the bridge').not.toContain('--attach')
    expect(spec.options.detached, 'POSIX setsid semantics — the daemon survives channel SIGHUP (REQ-004)').toBe(true)
    // stdin ignored; stdout/stderr NEVER inherited (a retained fd of the ssh exec channel would
    // wedge every disconnect and could leak daemon output onto a frames-only stdout) — they
    // target the daemon LOG sink so an uncaught crash leaves a forensic trace (FINDING-011).
    expect(spec.options.stdio).toEqual(['ignore', 7, 7])
  })

  it('forwards --socket and --idle-timeout-ms exactly when given, omits absent flags (REQ-001/REQ-011)', () => {
    const forwarded = buildDaemonSpawnSpec({
      artifactPath: '/a/agent.cjs', ptyBackend: 'node-pty', wsToken: 'w2', logFd: 9,
      socketPath: '\\\\.\\pipe\\t-0024', idleTimeoutMs: 250
    })
    expect(forwarded.args).toContain('--socket=\\\\.\\pipe\\t-0024')
    expect(forwarded.args).toContain('--idle-timeout-ms=250')
    expect(forwarded.args).toContain('--pty=node-pty')
    expect(forwarded.args).toContain('--ws=w2')

    const bare = buildDaemonSpawnSpec({ artifactPath: '/a/agent.cjs', ptyBackend: 'fake', socketPath: '/s.sock', logFd: 3 })
    expect(bare.args.some((a: string) => a.startsWith('--ws=')), 'no --ws unless the bridge was given one').toBe(false)
    expect(bare.args.some((a: string) => a.startsWith('--idle-timeout-ms=')), 'no override unless the bridge was given one').toBe(false)
  })
})

describe('TEST-2445 REQ-004 the daemon log sink: truncated per start AND size-capped within a generation', () => {
  it('construction truncates the prior generation; appends never exceed the cap; the latest diagnostic survives', () => {
    const dir = mkdtempSync(join(tmpdir(), 'termhalla-0024-log-'))
    try {
      const logPath = join(dir, 'daemon-w1.log')
      writeFileSync(logPath, 'PREVIOUS-GENERATION-MARKER\n'.repeat(10))

      const cap = 4096
      const sink = createDaemonLogSink(logPath, cap)
      expect(readFileSync(logPath, 'utf8'), 'each daemon start truncates the prior log (CONV-003)')
        .not.toContain('PREVIOUS-GENERATION-MARKER')

      // Drive well over the cap through the sink (FINDING-010/015: a survival daemon's
      // generation is wall-clock unbounded — truncate-at-start alone is not a bound).
      const line = (i: number): string => `diagnostic-${i} ${'x'.repeat(80)}`
      const count = Math.ceil((cap * 4) / 90)
      for (let i = 0; i <= count; i++) {
        sink.append(line(i))
        expect(statSync(logPath).size, 'the log file NEVER exceeds DAEMON_LOG_MAX_BYTES-style cap')
          .toBeLessThanOrEqual(cap)
      }
      expect(readFileSync(logPath, 'utf8'), 'the most recent diagnostic is present after capping')
        .toContain(`diagnostic-${count}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the default cap is the named exported constant (CONV-003: stated and asserted)', () => {
    expect(DAEMON_LOG_MAX_BYTES).toBe(1_048_576)
  })
})
