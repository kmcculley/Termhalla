// Test suite — feature 0024-agent-daemonization (phase 4, revision 3 — re-derived after the
// ESC-002 loop-back; REQ-003/005/007 as amended per FINDING-005/FINDING-007/FINDING-022).
// The single-instance / stale-reclaim decision core (REQ-005/REQ-007) and the daemon endpoint
// bootstrap's security-ordering seams (REQ-003): the socket MUST be created 0600 ATOMICALLY via
// a temporarily restrictive umask around the bind (a chmod-after-listen ordering is
// non-compliant — the kernel accepts connections at the creation-time mode the moment listen()
// succeeds, FINDING-005), metadata strictly after listen, and the AF_UNIX path limit measured in
// BYTES of the encoded path (never UTF-16 code units — FINDING-007). All with injected
// umask/fs/net seams (REQ-016's factoring mandate), no real sockets — the real-endpoint POSIX
// twins live in tests/agent-daemon-process.test.ts (TEST-2454 and, since revision 3, TEST-2459 —
// both skipIf win32).
//
// Revision 3 adds TEST-2458 (FINDING-022): the over-long-path guard is ONE shared exported
// implementation — `checkSocketPathLength` in daemon-guard.ts — enforced on the PRODUCTION bind
// path as well as the pure bootstrap seam, with no duplicated limit constant to drift.
//
// Chosen contract (frozen here):
//   src/agent/daemon-guard.ts exports decideDaemonReach(obs) →
//     { kind: 'attach' } | { kind: 'reclaim' } | { kind: 'wait' }
//     with obs = { connectable, metadataPid: number | null, pidAlive: boolean }.
//   src/agent/daemon-guard.ts exports checkSocketPathLength(socketPath, platform) →
//     { message: string } | null — null on win32 (named pipes are exempt) and for in-limit POSIX
//     paths; otherwise the ONE named path-and-limit error (byte-measured, never a raw EINVAL).
//   src/agent/daemon-server.ts exports bootstrapDaemonEndpoint({ socketPath, metadataPath,
//     metadata, seams }) with seams { platform, umask(mask) → priorMask, listen(path),
//     writeFile(path, text, mode) } → { ok } | { ok: false, message }. POSIX seam order is
//     EXACTLY umask(0o077) → listen → umask(prior) → writeFile(metadata, 0600). Its over-long
//     rejection IS checkSocketPathLength's error (the same implementation, called — FINDING-022).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decideDaemonReach, checkSocketPathLength } from '../src/agent/daemon-guard'
import { bootstrapDaemonEndpoint } from '../src/agent/daemon-server'

describe('TEST-2409 REQ-007 the bridge reach decision table is deterministic', () => {
  it('a connectable socket is an ordinary attach — never a reclaim', () => {
    expect(decideDaemonReach({ connectable: true, metadataPid: 42, pidAlive: true })).toEqual({ kind: 'attach' })
    // Metadata unreadable but the socket answers: attach anyway (the status line reports nulls).
    expect(decideDaemonReach({ connectable: true, metadataPid: null, pidAlive: false })).toEqual({ kind: 'attach' })
  })

  it('refused + dead-or-absent metadata pid reclaims (spawn fresh; the DAEMON owns all removal — locked D7/FINDING-016)', () => {
    expect(decideDaemonReach({ connectable: false, metadataPid: 42, pidAlive: false })).toEqual({ kind: 'reclaim' })
    expect(decideDaemonReach({ connectable: false, metadataPid: null, pidAlive: false })).toEqual({ kind: 'reclaim' })
  })

  it('refused + LIVE metadata pid waits (connect retries, then 96) — never a removal', () => {
    expect(decideDaemonReach({ connectable: false, metadataPid: 42, pidAlive: true })).toEqual({ kind: 'wait' })
  })
})

describe('TEST-2410 REQ-005/REQ-007 the never-kill-a-live-daemon invariant (CONV-045)', () => {
  it('no observation with a live recorded pid ever yields a reclaim; no connectable socket ever does', () => {
    for (const connectable of [true, false]) {
      for (const metadataPid of [42, null]) {
        for (const pidAlive of [true, false]) {
          const d = decideDaemonReach({ connectable, metadataPid, pidAlive })
          if (pidAlive && metadataPid !== null) {
            expect(d.kind, `live pid ${JSON.stringify({ connectable, metadataPid, pidAlive })}`).not.toBe('reclaim')
          }
          if (connectable) {
            expect(d.kind, 'a listening daemon is attached, never disturbed').toBe('attach')
          }
        }
      }
    }
  })
})

// ── the endpoint bootstrap with injected seams (REQ-003) ─────────────────────────────────────
interface LedgerEntry { op: string; path?: string; mode?: number; mask?: number; text?: string }

const PRIOR_UMASK = 0o022

const mkSeams = (platform: NodeJS.Platform) => {
  const ledger: LedgerEntry[] = []
  let currentMask = PRIOR_UMASK
  return {
    ledger,
    seams: {
      platform,
      umask: (mask: number): number => {
        const prior = currentMask
        currentMask = mask
        ledger.push({ op: 'umask', mask })
        return prior
      },
      listen: async (path: string): Promise<void> => { ledger.push({ op: 'listen', path }) },
      writeFile: async (path: string, text: string, mode: number): Promise<void> => {
        ledger.push({ op: 'write', path, mode, text })
      }
    }
  }
}

const META = {
  pid: 4711, version: '1.2.3', proto: 1, backend: 'fake', startedAt: '2026-07-06T00:00:00.000Z'
}

describe('TEST-2411 REQ-003 the socket is 0600 FROM CREATION: umask-wrapped bind, metadata strictly after listen (FINDING-005)', () => {
  it('POSIX: exactly umask(0o077) → listen → umask(prior) → write(metadata, 0600); the exact metadata key set', async () => {
    const { ledger, seams } = mkSeams('linux')
    const r = await bootstrapDaemonEndpoint({
      socketPath: '/home/u/.termhalla/agent/agent-w1.sock',
      metadataPath: '/home/u/.termhalla/agent/daemon-w1.json',
      metadata: META,
      seams
    })
    expect(r.ok, r.ok ? '' : r.message).toBe(true)

    // The EXACT seam-call sequence: the socket is CREATED owner-only by the restrictive umask
    // in force during the bind — no chmod-after-listen window can exist by construction.
    expect(ledger.map((e) => e.op), 'save-umask → restrict → listen → restore → metadata')
      .toEqual(['umask', 'listen', 'umask', 'write'])
    expect(ledger[0].mask, 'the restrictive mask is 0o077 (socket born 0600)').toBe(0o077)
    expect(ledger[1].path).toBe('/home/u/.termhalla/agent/agent-w1.sock')
    expect(ledger[2].mask, 'the PRIOR umask is restored immediately after the listen call').toBe(PRIOR_UMASK)
    expect(ledger[3].path, 'metadata existence implies a bound listener (written strictly after listen)')
      .toBe('/home/u/.termhalla/agent/daemon-w1.json')
    expect(ledger[3].mode).toBe(0o600)

    const written = JSON.parse(ledger[3].text ?? 'null') as Record<string, unknown>
    expect(Object.keys(written).sort(), 'exactly the frozen key set — no secrets, no host identity')
      .toEqual(['backend', 'formatVersion', 'pid', 'proto', 'startedAt', 'version'])
    expect(written.formatVersion).toBe(1)
    expect(written.pid).toBe(META.pid)
    expect(written.version).toBe(META.version)
    expect(written.proto).toBe(META.proto)
    expect(written.backend).toBe(META.backend)
  })

  it('win32 (named-pipe test substrate): still ok, metadata still strictly after listen', async () => {
    const { ledger, seams } = mkSeams('win32')
    const r = await bootstrapDaemonEndpoint({
      socketPath: '\\\\.\\pipe\\termhalla-0024-x',
      metadataPath: 'C:/tmp/agent/daemon-w1.json',
      metadata: META,
      seams
    })
    expect(r.ok, r.ok ? '' : r.message).toBe(true)
    const listenAt = ledger.findIndex((e) => e.op === 'listen')
    const writeAt = ledger.findIndex((e) => e.op === 'write')
    expect(listenAt).toBeGreaterThanOrEqual(0)
    expect(writeAt).toBeGreaterThan(listenAt)
  })
})

describe('TEST-2412 REQ-003 the AF_UNIX path limit is measured in BYTES, and failure is NAMED (FINDING-007)', () => {
  it('POSIX: an over-long ASCII path fails naming the path and the numeric limit; nothing bound or written', async () => {
    const longPath = `/tmp/${'x'.repeat(200)}/agent-w1.sock`
    const { ledger, seams } = mkSeams('linux')
    const r = await bootstrapDaemonEndpoint({
      socketPath: longPath,
      metadataPath: '/tmp/daemon-w1.json',
      metadata: META,
      seams
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message, 'names the offending path (CONV-001)').toContain(longPath)
      expect(r.message, 'names the numeric AF_UNIX limit').toMatch(/\d{2,3}/)
      expect(r.message).not.toMatch(/EINVAL/)
    }
    expect(ledger.some((e) => e.op === 'listen' || e.op === 'write'), 'nothing was bound or written').toBe(false)
  })

  it('POSIX multibyte: ≤ 107 UTF-16 units but > 107 BYTES must hit the SAME named error, never EINVAL', async () => {
    // '€' is 1 UTF-16 code unit but 3 UTF-8 bytes: 30×'€' + fixed parts ≈ 48 units, 138 bytes.
    const sneaky = `/tmp/${'€'.repeat(30)}/agent-w1.sock`
    expect(sneaky.length, 'the vector is genuinely short in UTF-16 units').toBeLessThanOrEqual(107)
    expect(Buffer.byteLength(sneaky, 'utf8'), 'but long in encoded bytes').toBeGreaterThan(107)

    const { ledger, seams } = mkSeams('linux')
    const r = await bootstrapDaemonEndpoint({
      socketPath: sneaky,
      metadataPath: '/tmp/daemon-w1.json',
      metadata: META,
      seams
    })
    expect(r.ok, 'a non-ASCII home dir must not slip past the guard (FINDING-007)').toBe(false)
    if (!r.ok) {
      expect(r.message).toContain(sneaky)
      expect(r.message).not.toMatch(/EINVAL/)
    }
    expect(ledger.some((e) => e.op === 'listen'), 'no bind was attempted').toBe(false)
  })

  it('win32: pipe paths live in their own namespace — the AF_UNIX length check must not apply', async () => {
    const { seams } = mkSeams('win32')
    const r = await bootstrapDaemonEndpoint({
      socketPath: `\\\\.\\pipe\\termhalla-${'y'.repeat(140)}`,
      metadataPath: 'C:/tmp/daemon-w1.json',
      metadata: META,
      seams
    })
    expect(r.ok, r.ok ? '' : r.message).toBe(true)
  })
})

// ── the shared over-long-path guard: ONE implementation, seam AND production (FINDING-022) ───
describe('TEST-2458 REQ-003 the over-long-socket-path guard is ONE shared implementation used by the seam AND the production bind path (FINDING-022)', () => {
  const longPath = `/tmp/${'x'.repeat(200)}/agent-w1.sock`

  it('checkSocketPathLength: byte-measured, named, platform-aware — the single source of truth', () => {
    expect(checkSocketPathLength('/tmp/agent-w1.sock', 'linux'), 'an in-limit path passes').toBeNull()

    const long = checkSocketPathLength(longPath, 'linux')
    expect(long, 'an over-long POSIX path is refused').not.toBeNull()
    expect(long!.message, 'names the offending path (CONV-001)').toContain(longPath)
    expect(long!.message, 'names the numeric AF_UNIX limit').toMatch(/\d{2,3}/)
    expect(long!.message).not.toMatch(/EINVAL|ENAMETOOLONG/)

    // FINDING-007 rides the SHARED guard: measured in BYTES of the encoded path, never units.
    const sneaky = `/tmp/${'€'.repeat(30)}/agent-w1.sock`
    expect(sneaky.length).toBeLessThanOrEqual(107)
    expect(Buffer.byteLength(sneaky, 'utf8')).toBeGreaterThan(107)
    const mb = checkSocketPathLength(sneaky, 'linux')
    expect(mb, 'a multibyte over-long path is refused by the shared guard too').not.toBeNull()
    expect(mb!.message).toContain(sneaky)

    // win32 named pipes live in their own namespace — the exemption lives IN the one guard.
    expect(checkSocketPathLength(`\\\\.\\pipe\\termhalla-${'y'.repeat(140)}`, 'win32')).toBeNull()
  })

  it('the pure seam produces EXACTLY the shared guard\'s error — the same implementation, not a lookalike copy', async () => {
    const { seams } = mkSeams('linux')
    const r = await bootstrapDaemonEndpoint({
      socketPath: longPath,
      metadataPath: '/tmp/daemon-w1.json',
      metadata: META,
      seams
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message, 'bootstrapDaemonEndpoint calls checkSocketPathLength — the messages are byte-identical by construction')
        .toBe(checkSocketPathLength(longPath, 'linux')!.message)
    }
  })

  it('structural single source: the limit lives ONLY in daemon-guard; the production bind path consumes the shared guard', () => {
    const guardSrc = readFileSync(resolve(process.cwd(), 'src/agent/daemon-guard.ts'), 'utf8')
    const serverSrc = readFileSync(resolve(process.cwd(), 'src/agent/daemon-server.ts'), 'utf8')
    expect(guardSrc, 'the byte-length comparison lives in the shared guard module').toMatch(/Buffer\.byteLength/)
    expect(serverSrc, 'daemon-server imports the ONE shared guard')
      .toMatch(/import[^;]*checkSocketPathLength[^;]*from '\.\/daemon-guard'/)
    expect(serverSrc, 'no duplicated AF_UNIX limit constant to drift (FINDING-022)')
      .not.toMatch(/AF_UNIX_PATH_MAX\s*=\s*\d/)
    expect(serverSrc, 'no re-derived byte comparison beside the shared guard')
      .not.toMatch(/Buffer\.byteLength\(\s*socketPath/)
    // Both the pure seam AND the production claim/listen sequence call the guard (the plan's
    // TASK-004/TASK-006 shape): at least two call expressions in daemon-server beyond the import.
    const calls = serverSrc.split('checkSocketPathLength(').length - 1
    expect(calls, 'the seam and the production bind path each invoke the shared guard')
      .toBeGreaterThanOrEqual(2)
  })
})
