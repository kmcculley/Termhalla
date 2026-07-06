// FROZEN test suite — feature 0023-remote-node-pty-prebuilt (phase 4).
// The pure co-provision model in src/remote-client/prebuilt.ts:
// REQ-008 (probe command builder), REQ-009 (probe outcome classifier), REQ-010 (libc rule),
// REQ-011 (target selection), REQ-012 (provision decision table), REQ-014 (install command +
// payload encoder), REQ-015 (sentinel constants), REQ-021 (glibc-floor hint), REQ-026 (the
// bounded probe-stdout accumulator).
// RE-CUT through the tests phase after the FINDING-020-cluster / ESC-003 loopback: the probe
// result gains the GROUND-TRUTH `actualPtyNodeSha256` field (REQ-008), the skip decision is
// gated on it (REQ-012 — TEST-2330 amended), payload header entries carry a per-file sha-256
// (REQ-014 — TEST-2332 amended), and the probe channel is bounded (REQ-026 — TEST-2368).
//
// Chosen contract (frozen here; module: src/remote-client/prebuilt.ts):
//   buildNodePtyProbeCommand(agentDir): `node -e '<PROBE_SRC>' <agentDir>`
//   parseProbeStdout(stdout): NodePtyProbeResult | null   (line-scan for the sentinel prefix)
//   classifyProbeOutcome({ exitCode, stdout, stderrExcerpt }):
//     { kind: 'fatal'; diagnostic } | { kind: 'probe'; probe }
//   deriveLibc(probe): 'glibc' | 'non-glibc'
//   selectPrebuiltTarget({ platform, arch, libc }):
//     { ok: true; target: 'linux-x64-glibc' } | { ok: false; triple: { platform; arch; libc } }
//   decideNodePtyProvision(probe, selection, localManifestOrNull):
//     { kind: 'skip' | 'install' | 'proceed-unmanaged' | 'no-match' }
//     — skip ADDITIONALLY requires probe.actualPtyNodeSha256 === localManifest.ptyNodeSha256
//       (the ESC-003 ground-truth gate; null/different ⇒ install — self-repair, never a wedge)
//   buildNodePtyInstallCommand(agentDir, nonce): `node -e '<UNPACK_SRC>' <agentDir> <nonce>`
//   encodeNodePtyPayload(files: Array<{ path; bytes; sha256 }>, ptyNodeSha256): Buffer
//     — header: { format: 1, files: [{ path, size, sha256 }...], ptyNodeSha256 } (each entry's
//       sha256 caller-sourced from the local manifest's `files` map; the manifest file's own
//       entry is computed from its bytes at encode time)
//   glibcFloorHint(sanitizedStderr): string  ('' when unrelated)
//   appendBoundedProbeStdout(window, chunk, cap = NODE_PTY_PROBE_STDOUT_CAP): string
//     — the REQ-026 trailing-window accumulator seam the probe runner feeds every chunk through
//   constants: NODE_PTY_PROBE_SENTINEL ('TERMHALLA_PROBE_V1 '), NODE_PTY_MARKER_FILE,
//     NODE_PTY_BYTES_EXIT (93), NODE_PTY_SHA_EXIT (94), NODE_PTY_RACE_EXIT (95),
//     NODE_PTY_PROBE_STDOUT_CAP (65536 — order 64 KiB, stated and tested per CONV-003),
//     PREBUILT_TARGETS_V1, PROBE_SRC, UNPACK_SRC.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  buildNodePtyProbeCommand, parseProbeStdout, classifyProbeOutcome, deriveLibc,
  selectPrebuiltTarget, decideNodePtyProvision, buildNodePtyInstallCommand,
  encodeNodePtyPayload, glibcFloorHint,
  NODE_PTY_PROBE_SENTINEL, NODE_PTY_MARKER_FILE, NODE_PTY_BYTES_EXIT, NODE_PTY_SHA_EXIT,
  PREBUILT_TARGETS_V1, PROBE_SRC, UNPACK_SRC
} from '../src/remote-client/prebuilt'
// Namespace import so amended-vocabulary assertions (TEST-2334, TEST-2368) fail as RED tests
// instead of an import-time crash of the whole file while an export is unimplemented.
import * as prebuiltNs from '../src/remote-client/prebuilt'

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

const MANIFEST = {
  formatVersion: 1,
  nodePtyVersion: '1.2.3',
  target: 'linux-x64-glibc',
  ptyNodeSha256: 'ab'.repeat(32),
  // The ESC-003/FINDING-005 amendment: a sha-256 for EVERY shipped file (manifest excluded).
  files: {
    'build/Release/pty.node': 'ab'.repeat(32),
    'lib/index.js': '11'.repeat(32),
    'package.json': '22'.repeat(32)
  }
}

const probeOf = (over: Record<string, unknown> = {}) => ({
  platform: 'linux',
  arch: 'x64',
  glibc: '2.31' as string | null,
  marker: { ...MANIFEST } as unknown,
  resolves: true,
  // The ESC-003 ground-truth field: the sha-256 of the bytes ACTUALLY on disk at
  // <agentDir>/node_modules/node-pty/build/Release/pty.node (null when absent/unreadable).
  actualPtyNodeSha256: 'ab'.repeat(32) as string | null,
  node: 'v22.0.0',
  ...over
})

const sentinelLine = (obj: unknown): string => `${NODE_PTY_PROBE_SENTINEL}${JSON.stringify(obj)}`

describe('TEST-2334 REQ-008/REQ-011/REQ-015 the frozen wire vocabulary', () => {
  it('pins the sentinel prefix, marker filename, sentinel exits, and the v1 target set', () => {
    expect(NODE_PTY_PROBE_SENTINEL).toBe('TERMHALLA_PROBE_V1 ')
    expect(NODE_PTY_MARKER_FILE).toBe('.termhalla-prebuilt.json')
    expect(NODE_PTY_BYTES_EXIT).toBe(93)
    expect(NODE_PTY_SHA_EXIT).toBe(94)
    // The ESC-001/ESC-002 amendment (REQ-015): a promote collision with a DIVERGENT install.
    expect((prebuiltNs as unknown as Record<string, unknown>).NODE_PTY_RACE_EXIT,
      'NODE_PTY_RACE_EXIT (the divergent promote-collision sentinel) must be exported as 95').toBe(95)
    expect([...PREBUILT_TARGETS_V1]).toEqual(['linux-x64-glibc'])
  })
})

describe('probe command builder (REQ-008)', () => {
  it('TEST-2322 REQ-008 pins the exact command shape and the single-quote-free, data-free script literal', () => {
    expect(buildNodePtyProbeCommand('~/.termhalla/agent')).toBe(`node -e '${PROBE_SRC}' ~/.termhalla/agent`)
    expect(buildNodePtyProbeCommand('~/custom-agents')).toBe(`node -e '${PROBE_SRC}' ~/custom-agents`)
    expect(PROBE_SRC.includes("'"), 'PROBE_SRC must contain no single-quote character').toBe(false)
    expect(PROBE_SRC.length).toBeGreaterThan(0)
    // No interpolated data: two different dirs share the identical script literal.
    const a = buildNodePtyProbeCommand('~/a')
    const b = buildNodePtyProbeCommand('~/b')
    expect(a.slice(0, a.lastIndexOf(' '))).toBe(b.slice(0, b.lastIndexOf(' ')))
  })

  it('TEST-2323 REQ-008 rejects invalid agent dirs with specific, actionable errors (CONV-001)', () => {
    expect(() => buildNodePtyProbeCommand('')).toThrow(/remoteAgentDir|non-empty/)
    expect(() => buildNodePtyProbeCommand('~/x/../y')).toThrow(/\.\./)
    expect(() => buildNodePtyProbeCommand('~/x y')).toThrow(/match|charset|character/i)
    expect(() => buildNodePtyProbeCommand("~/x'y")).toThrow(/match|charset|character/i)
    expect(() => buildNodePtyProbeCommand('-rf')).toThrow(/-|option/i)
  })
})

describe('probe outcome classification (REQ-009)', () => {
  it('TEST-2326 REQ-009 exit 255 → fatal transport with reachability/auth wording and the SANITIZED stderr tail', () => {
    const c = classifyProbeOutcome({
      exitCode: 255, stdout: '', stderrExcerpt: 'Permission denied \u001b[31m(publickey)\u001b[0m'
    })
    expect(c.kind).toBe('fatal')
    if (c.kind !== 'fatal') return
    expect(c.diagnostic).toMatch(/reachability|auth/i)
    expect(c.diagnostic).toContain('Permission denied')
    expect(c.diagnostic.includes('\u001b'), 'control characters must never enter a diagnostic (sanitizeStderr posture)').toBe(false)
  })

  it('TEST-2327 REQ-009 exit 127 → fatal: the remote has no node on the non-interactive login shell PATH and the agent requires it', () => {
    const c = classifyProbeOutcome({ exitCode: 127, stdout: '', stderrExcerpt: 'node: command not found' })
    expect(c.kind).toBe('fatal')
    if (c.kind !== 'fatal') return
    expect(c.diagnostic).toContain('PATH')
    expect(c.diagnostic).toMatch(/non-interactive|login shell/i)
    expect(c.diagnostic).toMatch(/agent/i)
  })

  it('TEST-2328 REQ-009 stdout with no parseable sentinel line → fatal with the shell-rc-noise hint; garbage after the sentinel is unparseable too', () => {
    const noise = classifyProbeOutcome({ exitCode: 0, stdout: 'Welcome!\nmotd here\n', stderrExcerpt: '' })
    expect(noise.kind).toBe('fatal')
    if (noise.kind === 'fatal') {
      expect(noise.diagnostic).toMatch(/rc file|shell rc/i)
      expect(noise.diagnostic).toMatch(/stdout/)
    }
    const garbage = classifyProbeOutcome({
      exitCode: 0, stdout: `${NODE_PTY_PROBE_SENTINEL}{{{not json\n`, stderrExcerpt: ''
    })
    expect(garbage.kind).toBe('fatal')

    const empty = classifyProbeOutcome({ exitCode: 0, stdout: '', stderrExcerpt: '' })
    expect(empty.kind, 'empty stdout is malformed input, handled honestly (CONV-002)').toBe('fatal')
  })

  it('TEST-2329 REQ-009 the sentinel line parses even when buried in rc noise, and clean stdout parses too (line-by-line scan)', () => {
    const probe = probeOf()
    const buried = classifyProbeOutcome({
      exitCode: 0,
      stdout: `Welcome to box!\nrc noise line\n${sentinelLine(probe)}\ntrailing rc noise\n`,
      stderrExcerpt: ''
    })
    expect(buried.kind, buried.kind === 'fatal' ? buried.diagnostic : '').toBe('probe')
    if (buried.kind === 'probe') {
      expect(buried.probe.platform).toBe('linux')
      expect(buried.probe.arch).toBe('x64')
      expect(buried.probe.glibc).toBe('2.31')
      expect(buried.probe.resolves).toBe(true)
      expect(buried.probe.marker).toEqual(MANIFEST)
    }
    const clean = classifyProbeOutcome({ exitCode: 0, stdout: `${sentinelLine(probe)}\n`, stderrExcerpt: '' })
    expect(clean.kind).toBe('probe')

    expect(parseProbeStdout(`noise\n${sentinelLine(probe)}\n`)).toEqual(probe)
    expect(parseProbeStdout('nothing here\n')).toBeNull()
  })
})

describe('TEST-2324 REQ-010 libc determination', () => {
  it('non-empty glibc string ⇒ glibc; null or empty ⇒ non-glibc (musl and unknown are indistinguishable in v1)', () => {
    expect(deriveLibc(probeOf({ glibc: '2.31' }))).toBe('glibc')
    expect(deriveLibc(probeOf({ glibc: '2.28' }))).toBe('glibc')
    expect(deriveLibc(probeOf({ glibc: null }))).toBe('non-glibc')
    expect(deriveLibc(probeOf({ glibc: '' }))).toBe('non-glibc')
  })
})

describe('TEST-2325 REQ-011 deterministic prebuilt selection', () => {
  it('exactly (linux, x64, glibc) matches linux-x64-glibc; every other triple no-matches, echoing its triple verbatim', () => {
    const hit = selectPrebuiltTarget({ platform: 'linux', arch: 'x64', libc: 'glibc' })
    expect(hit.ok).toBe(true)
    if (hit.ok) expect(hit.target).toBe('linux-x64-glibc')

    const misses = [
      { platform: 'linux', arch: 'arm64', libc: 'glibc' },
      { platform: 'linux', arch: 'x64', libc: 'non-glibc' },
      { platform: 'darwin', arch: 'arm64', libc: 'non-glibc' },
      { platform: 'win32', arch: 'x64', libc: 'non-glibc' }
    ] as const
    for (const triple of misses) {
      const r = selectPrebuiltTarget(triple)
      expect(r.ok, `${triple.platform}/${triple.arch}/${triple.libc} must not match`).toBe(false)
      if (!r.ok) expect(r.triple).toEqual(triple)
    }
    // Pure: the same input twice yields identical output (no ambient state).
    const again = selectPrebuiltTarget({ platform: 'linux', arch: 'x64', libc: 'glibc' })
    expect(again).toEqual(hit)
  })
})

describe('TEST-2330 REQ-012 the provision decision table (amended: the skip gate is GROUND-TRUTH-verified — ESC-003)', () => {
  const matched = selectPrebuiltTarget({ platform: 'linux', arch: 'x64', libc: 'glibc' })
  const unmatched = selectPrebuiltTarget({ platform: 'darwin', arch: 'arm64', libc: 'non-glibc' })

  it('skip: matched target + full marker equality + resolves + the ACTUAL on-disk hash equal to the local manifest sha — the idempotent steady state', () => {
    expect(decideNodePtyProvision(probeOf(), matched, MANIFEST).kind).toBe('skip')
  })

  it('install: no marker / stale version / different sha / marker ok but resolves false (torn installs are repaired, never trusted)', () => {
    expect(decideNodePtyProvision(probeOf({ marker: null }), matched, MANIFEST).kind).toBe('install')
    expect(decideNodePtyProvision(
      probeOf({ marker: { ...MANIFEST, nodePtyVersion: '1.2.2' } }), matched, MANIFEST
    ).kind).toBe('install')
    expect(decideNodePtyProvision(
      probeOf({ marker: { ...MANIFEST, ptyNodeSha256: 'cd'.repeat(32) } }), matched, MANIFEST
    ).kind).toBe('install')
    expect(decideNodePtyProvision(
      probeOf({ marker: { ...MANIFEST, target: 'linux-arm64-glibc' } }), matched, MANIFEST
    ).kind).toBe('install')
    expect(decideNodePtyProvision(probeOf({ resolves: false }), matched, MANIFEST).kind).toBe('install')
  })

  it('install (ESC-003 / FINDING-020): marker matches AND resolves is true, but the ON-DISK binary hash is null or differs from the local manifest sha ⇒ install — self-repair, never a permanent skip→launch-fail wedge', () => {
    // A hand-damaged/torn binary under an intact, matching marker: the marker alone is NEVER
    // trusted — the ground-truth hash gates the skip.
    expect(decideNodePtyProvision(
      probeOf({ actualPtyNodeSha256: 'ee'.repeat(32) }), matched, MANIFEST
    ).kind).toBe('install')
    // A DELETED binary under an intact marker (actualPtyNodeSha256: null).
    expect(decideNodePtyProvision(
      probeOf({ actualPtyNodeSha256: null }), matched, MANIFEST
    ).kind).toBe('install')
  })

  it('proceed-unmanaged: unmatched triple but the bare specifier resolves — the manual-install escape hatch is honored', () => {
    expect(decideNodePtyProvision(
      probeOf({ platform: 'darwin', arch: 'arm64', glibc: null, marker: null, actualPtyNodeSha256: null }), unmatched, null
    ).kind).toBe('proceed-unmanaged')
  })

  it('no-match: unmatched triple and no resolution', () => {
    expect(decideNodePtyProvision(
      probeOf({ platform: 'darwin', arch: 'arm64', glibc: null, marker: null, actualPtyNodeSha256: null, resolves: false }), unmatched, null
    ).kind).toBe('no-match')
  })
})

describe('install command + payload encoder (REQ-014)', () => {
  it('TEST-2331 REQ-014 pins the exact install command shape; UNPACK_SRC is single-quote-free; invalid dir/nonce inputs are rejected (CONV-001)', () => {
    expect(buildNodePtyInstallCommand('~/.termhalla/agent', 'abc123'))
      .toBe(`node -e '${UNPACK_SRC}' ~/.termhalla/agent abc123`)
    expect(UNPACK_SRC.includes("'"), 'UNPACK_SRC must contain no single-quote character').toBe(false)
    expect(() => buildNodePtyInstallCommand('', 'abc123')).toThrow(/remoteAgentDir|non-empty/)
    expect(() => buildNodePtyInstallCommand('~/x/../y', 'abc123')).toThrow(/\.\./)
    expect(() => buildNodePtyInstallCommand('~/ok', '')).toThrow(/nonce/)
    expect(() => buildNodePtyInstallCommand('~/ok', 'a b')).toThrow(/nonce/)
    expect(() => buildNodePtyInstallCommand('~/ok', 'x;y')).toThrow(/nonce/)
    expect(() => buildNodePtyInstallCommand('~/ok', '../z')).toThrow(/nonce/)
  })

  it('TEST-2332 REQ-014 encodes NODE_PTY_PAYLOAD_V1 (one JSON header line — every entry carrying its OWN sha-256 (ESC-003/FINDING-005) — then bytes in header order) and validates paths on the client', () => {
    const raw = [
      { path: 'package.json', bytes: Buffer.from('{"name":"node-pty"}') },
      { path: 'lib/index.js', bytes: Buffer.from('module.exports = {}') },
      { path: 'build/Release/pty.node', bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]) }
    ]
    const files = raw.map((f) => ({ ...f, sha256: sha256(f.bytes) }))
    const sha = 'ef'.repeat(32)
    const payload = Buffer.from(encodeNodePtyPayload(files, sha))
    const nl = payload.indexOf(0x0a)
    expect(nl).toBeGreaterThan(0)
    const header = JSON.parse(payload.subarray(0, nl).toString('utf8')) as Record<string, unknown>
    expect(header).toEqual({
      format: 1,
      files: files.map((f) => ({ path: f.path, size: f.bytes.length, sha256: f.sha256 })),
      ptyNodeSha256: sha
    })
    expect(payload.subarray(nl + 1)).toEqual(Buffer.concat(files.map((f) => f.bytes)))

    const one = (path: string): Array<{ path: string; bytes: Buffer; sha256: string }> =>
      [{ path, bytes: Buffer.from('x'), sha256: sha256(Buffer.from('x')) }]
    expect(() => encodeNodePtyPayload(one('../evil.js'), sha)).toThrow(/\.\.|path/)
    expect(() => encodeNodePtyPayload(one('/abs/evil.js'), sha)).toThrow(/absolute|leading|path/i)
    expect(() => encodeNodePtyPayload(one('lib\\evil.js'), sha)).toThrow(/backslash|\\|path/i)
    expect(() => encodeNodePtyPayload(one(''), sha)).toThrow(/path|non-empty/i)
  })
})

describe('TEST-2333 REQ-021 glibc-floor hint on dlopen-era failures', () => {
  it("stderr matching a GLIBC_<x.y>' not found class yields a hint naming the 2.31 floor and the manual-install escape hatch; unrelated stderr yields none", () => {
    const hint = glibcFloorHint("/lib/x86_64-linux-gnu/libc.so.6: version 'GLIBC_2.34' not found (required by .../pty.node)")
    expect(hint).toContain('2.31')
    expect(hint).toContain('node_modules/node-pty')
    expect(glibcFloorHint('Cannot find module something-else')).toBe('')
    expect(glibcFloorHint('')).toBe('')
  })
})

describe('TEST-2368 REQ-026 the bounded, trailing-window probe-stdout accumulator (ESC-003 / FINDING-010)', () => {
  it('exports the stated cap (order 64 KiB) and a pure accumulator that never exceeds it, retains the TRAILING window, and keeps a late sentinel parseable through heavy noise', () => {
    const ns = prebuiltNs as unknown as {
      NODE_PTY_PROBE_STDOUT_CAP?: number
      appendBoundedProbeStdout?: (window: string, chunk: string, cap?: number) => string
    }
    expect(ns.NODE_PTY_PROBE_STDOUT_CAP,
      'NODE_PTY_PROBE_STDOUT_CAP must be exported — the cap is stated and tested, never silent (CONV-003)').toBe(65536)
    expect(typeof ns.appendBoundedProbeStdout,
      'appendBoundedProbeStdout(window, chunk, cap?) must be exported — the seam the probe runner feeds every chunk through').toBe('function')
    const append = ns.appendBoundedProbeStdout as (window: string, chunk: string, cap?: number) => string
    const cap = ns.NODE_PTY_PROBE_STDOUT_CAP as number

    // Precision at a tiny cap: the window is the TRAILING cap chars, older bytes discarded.
    expect(append('abcdef', 'ghij', 8)).toBe('cdefghij')
    expect(append('', 'x'.repeat(20), 8)).toBe('x'.repeat(8))
    expect(append('ab', 'cd', 8)).toBe('abcd')

    // Overflow at the real cap: feed well past it; the retained window NEVER exceeds the cap.
    let window = ''
    const chunk = `rc noise ${'z'.repeat(1000)}\n`
    for (let i = 0; i < 200; i += 1) {
      window = append(window, chunk)
      expect(window.length).toBeLessThanOrEqual(cap)
    }
    expect(window.length, 'the window is full after > cap bytes of input').toBe(cap)
    expect(window.endsWith(chunk), 'the TRAILING content is what survives').toBe(true)

    // A sentinel arriving AFTER heavy noise still parses out of the bounded window (REQ-026:
    // the cap holds the sentinel line plus generous rc noise).
    const probe = probeOf()
    window = append(window, `${sentinelLine(probe)}\n`)
    expect(window.length).toBeLessThanOrEqual(cap)
    expect(parseProbeStdout(window), 'the bounded window still yields the parsed probe').toEqual(probe)
  })
})
