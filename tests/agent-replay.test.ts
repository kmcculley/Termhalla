// FROZEN test suite — feature 0019-agent-replay-session-survival (phase 4).
// REQ-003 (the replay layer) + REQ-010 (snapshot fidelity): one bounded @xterm/headless
// terminal per pane whose serialize snapshot is a faithful function of the fed byte stream.
// Oracle: an INDEPENDENT reference terminal (same { cols, rows, scrollback,
// allowProposedApi: true } options — the implementation must keep option parity) fed the same
// bytes via awaited write callbacks. Vectors poll content with a bounded until() — no
// assertions on time.
import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { createPaneReplay, HISTORY_LIMIT_DEFAULT } from '../src/agent/replay'

interface RefOpts { cols: number; rows: number; scrollback: number }

const mkReference = (opts: RefOpts): { term: Terminal; serialize: () => string; dispose: () => void } => {
  const term = new Terminal({ cols: opts.cols, rows: opts.rows, scrollback: opts.scrollback, allowProposedApi: true })
  const addon = new SerializeAddon()
  term.loadAddon(addon as unknown as Parameters<Terminal['loadAddon']>[0])
  return { term, serialize: () => addon.serialize(), dispose: () => term.dispose() }
}

const writeAll = async (term: Terminal, chunks: string[]): Promise<void> => {
  for (const c of chunks) await new Promise<void>((r) => term.write(c, r))
}

/** Reference serialization of `chunks` with an optional resize applied before chunk[i]. */
const referenceSerialize = async (
  chunks: string[], opts: RefOpts, resizeAt?: { index: number; cols: number; rows: number }
): Promise<string> => {
  const ref = mkReference(opts)
  for (let i = 0; i < chunks.length; i++) {
    if (resizeAt && resizeAt.index === i) ref.term.resize(resizeAt.cols, resizeAt.rows)
    await new Promise<void>((r) => ref.term.write(chunks[i], r))
  }
  const out = ref.serialize()
  ref.dispose()
  return out
}

const OPTS: RefOpts = { cols: 40, rows: 6, scrollback: 8 }
const lines = (from: number, to: number): string[] => {
  const out: string[] = []
  for (let i = from; i <= to; i++) out.push(`line-${String(i).padStart(2, '0')}\r\n`)
  return out
}

describe('TEST-1901 REQ-003 replay unit: barrier, bound, resize, default, dispose', () => {
  it('exports HISTORY_LIMIT_DEFAULT = 2000 (the tmux history-limit default)', () => {
    expect(HISTORY_LIMIT_DEFAULT).toBe(2000)
  })

  it('snapshot() reflects every byte fed BEFORE the call', async () => {
    const replay = createPaneReplay(OPTS)
    const chunks = ['alpha\r\n', 'beta\r\n', 'gamma']
    for (const c of chunks) replay.feed(c)
    const snap = await replay.snapshot()
    expect(snap).toBe(await referenceSerialize(chunks, OPTS))
    expect(snap).toContain('gamma')
    replay.dispose()
  })

  it('bytes fed AFTER the snapshot() call are excluded from that snapshot', async () => {
    const replay = createPaneReplay(OPTS)
    replay.feed('before\r\n')
    const pending = replay.snapshot()
    replay.feed('after\r\n') // fed after the call — must not appear
    const snap = await pending
    expect(snap).toBe(await referenceSerialize(['before\r\n'], OPTS))
    expect(snap).not.toContain('after')
    replay.dispose()
  })

  it('bounds scrollback: old lines evicted exactly like the reference', async () => {
    const replay = createPaneReplay(OPTS)
    const all = lines(1, 30) // 30 lines into rows 6 + scrollback 8
    for (const c of all) replay.feed(c)
    const snap = await replay.snapshot()
    expect(snap).toBe(await referenceSerialize(all, OPTS))
    expect(snap).toContain('line-30')
    expect(snap).toContain('line-23')
    expect(snap).not.toContain('line-05')
    // The reference terminal's retained buffer is itself bounded (rows + scrollback).
    const ref = mkReference(OPTS)
    await writeAll(ref.term, all)
    expect(ref.term.buffer.active.length).toBeLessThanOrEqual(OPTS.rows + OPTS.scrollback)
    ref.dispose()
    replay.dispose()
  })

  it('resize keeps parity with a reference resized at the same stream point', async () => {
    const replay = createPaneReplay(OPTS)
    replay.feed('one\r\n')
    replay.resize(60, 10)
    replay.feed('two-after-resize\r\n')
    const snap = await replay.snapshot()
    expect(snap).toBe(await referenceSerialize(
      ['one\r\n', 'two-after-resize\r\n'], OPTS, { index: 1, cols: 60, rows: 10 }))
    replay.dispose()
  })

  it('dispose() is idempotent', async () => {
    const replay = createPaneReplay(OPTS)
    replay.feed('x')
    replay.dispose()
    expect(() => replay.dispose()).not.toThrow()
  })
})

describe('TEST-1902 REQ-010 fidelity table: the snapshot is a faithful function of the bytes', () => {
  const MARKER_A = '\x1b]133;A\x07'
  const MARKER_C = '\x1b]133;C\x07'
  const table: Array<{ name: string; chunks: string[]; opts: RefOpts; resizeAt?: { index: number; cols: number; rows: number } }> = [
    { name: 'plain CRLF lines', chunks: ['hello\r\n', 'world\r\n'], opts: OPTS },
    { name: 'ANSI SGR color state', chunks: ['\x1b[31mred-text\x1b[0m plain\r\n', '\x1b[1;44mbold-on-blue\x1b[0m\r\n'], opts: OPTS },
    { name: 'scrollback overflow', chunks: lines(1, 60), opts: { cols: 40, rows: 6, scrollback: 8 } },
    { name: 'mid-stream resize', chunks: ['aaaa\r\n', 'bbbb\r\n', 'cccc\r\n'], opts: OPTS, resizeAt: { index: 2, cols: 66, rows: 9 } },
    {
      name: 'OSC 133 command cycle (fake shell byte conventions)',
      chunks: [MARKER_A + 'fake$ ', MARKER_C, 'out-line\r\n', '\x1b]133;D;0\x07', MARKER_A, 'fake$ '],
      opts: OPTS
    }
  ]

  for (const row of table) {
    it(`snapshot === reference: ${row.name}`, async () => {
      const replay = createPaneReplay(row.opts)
      for (let i = 0; i < row.chunks.length; i++) {
        if (row.resizeAt && row.resizeAt.index === i) replay.resize(row.resizeAt.cols, row.resizeAt.rows)
        replay.feed(row.chunks[i])
      }
      const snap = await replay.snapshot()
      expect(snap).toBe(await referenceSerialize(row.chunks, row.opts, row.resizeAt))
      replay.dispose()
    })
  }

  it('composition oracle: snapshot ⊕ later bytes ≡ the whole stream (overflow vector)', async () => {
    const opts: RefOpts = { cols: 40, rows: 6, scrollback: 8 }
    const before = lines(1, 20)
    const after = ['tail-one\r\n', 'tail-two\r\n']
    const replay = createPaneReplay(opts)
    for (const c of before) replay.feed(c)
    const snap = await replay.snapshot()
    replay.dispose()

    const composed = mkReference(opts)
    await writeAll(composed.term, [snap, ...after])
    const direct = mkReference(opts)
    await writeAll(direct.term, [...before, ...after])
    expect(composed.serialize()).toBe(direct.serialize())
    composed.dispose()
    direct.dispose()
  })

  it('composition oracle: ANSI vector', async () => {
    const before = ['\x1b[32mgreen\x1b[0m\r\n']
    const after = ['\x1b[35mmagenta-later\x1b[0m\r\n']
    const replay = createPaneReplay(OPTS)
    for (const c of before) replay.feed(c)
    const snap = await replay.snapshot()
    replay.dispose()

    const composed = mkReference(OPTS)
    await writeAll(composed.term, [snap, ...after])
    const direct = mkReference(OPTS)
    await writeAll(direct.term, [...before, ...after])
    expect(composed.serialize()).toBe(direct.serialize())
    composed.dispose()
    direct.dispose()
  })
})
