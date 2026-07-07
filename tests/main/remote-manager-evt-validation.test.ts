// 2026-07-06 quality audit (borderline finding): onEvt forwarded remote evt payloads into
// renderer IPC on unvalidated casts (`args as [string, string]`) after only the pane-id guard
// (FINDING-007). A compromised or buggy remote agent could push a non-string data payload, a
// non-number exit code, etc. straight onto the renderer bridge. Each payload position is now
// type-checked; a mismatch is dropped with one diagnostic and NO side effect (no forward, no
// prune, no ack accounting).
//
// Harness: the frozen remote-manager stub-wire pattern (remote-manager-harness.ts).
import { describe, it, expect, vi } from 'vitest'
import { CH } from '@shared/ipc-contract'
import { mkHarness, settle } from './remote-manager-harness'

const WS = 'ws-1'
const spawnArgs = (id: string) => ({
  id, shellId: 'sh-1', cwd: '', cols: 80, rows: 24,
  remote: { workspaceId: WS, agentId: 'a-1' }
})

async function connected() {
  const diag = vi.fn()
  const h = mkHarness({
    diag,
    wireOpts: { respond: { 'pty:sessions': () => [], 'pty:spawn': () => null } }
  })
  await h.mgr.spawn(spawnArgs('p-1') as never)
  await settle()
  return { h, diag, w: h.wires[0] }
}

const evtDiags = (diag: ReturnType<typeof vi.fn>) =>
  diag.mock.calls.map(c => String(c[0])).filter(l => /evt/.test(l))

describe('remote evt pane-membership guard — the 0022 FINDING-007 NEGATIVE case', () => {
  it('an evt for a pane this connection does NOT own is dropped with one diagnostic — a compromised remote cannot inject output/status/cwd/exit into a guessed pane id', async () => {
    const { h, diag, w } = await connected()
    for (const [channel, payload] of [
      [CH.ptyData, 'evil-bytes'], [CH.ptyStatus, { state: 'idle', since: 1 }],
      [CH.ptyCwd, '/tmp'], [CH.ptyExit, 0]
    ] as const) {
      w.push({ type: 'evt', channel, args: ['p-unowned', payload] })
    }
    await settle()
    for (const ch of [CH.ptyData, CH.ptyStatus, CH.ptyCwd, CH.ptyExit]) {
      expect(h.sendsOn(ch).filter(a => a[0] === 'p-unowned'), `${ch} for an unowned pane must never reach the renderer`).toEqual([])
    }
    expect(diag.mock.calls.map(c => String(c[0])).filter(l => /does not own/.test(l)).length).toBe(4)
    // the owned pane is untouched by the attempts
    expect(h.mgr.owns('p-1')).toBe(true)
  })
})

describe('remote evt payload validation (onEvt) — malformed positions drop with a diagnostic', () => {
  it('pty:data with a non-string payload is dropped: no forward, one diagnostic', async () => {
    const { h, diag, w } = await connected()
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', { evil: true }] })
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1'] }) // missing position entirely
    await settle()
    expect(h.sendsOn(CH.ptyData)).toEqual([])
    expect(evtDiags(diag).length).toBe(2)
  })

  it('pty:status with a non-object payload is dropped', async () => {
    const { h, diag, w } = await connected()
    w.push({ type: 'evt', channel: CH.ptyStatus, args: ['p-1', 'busy'] })
    w.push({ type: 'evt', channel: CH.ptyStatus, args: ['p-1', null] })
    await settle()
    expect(h.sendsOn(CH.ptyStatus)).toEqual([])
    expect(evtDiags(diag).length).toBe(2)
  })

  it('pty:cwd with a non-string payload is dropped', async () => {
    const { h, diag, w } = await connected()
    w.push({ type: 'evt', channel: CH.ptyCwd, args: ['p-1', 42] })
    await settle()
    expect(h.sendsOn(CH.ptyCwd)).toEqual([])
    expect(evtDiags(diag).length).toBe(1)
  })

  it('pty:exit with a non-number code is dropped — and the pane is NOT pruned', async () => {
    const { h, diag, w } = await connected()
    w.push({ type: 'evt', channel: CH.ptyExit, args: ['p-1', 'zero'] })
    await settle()
    expect(h.sendsOn(CH.ptyExit)).toEqual([])
    expect(evtDiags(diag).length).toBe(1)
    expect(h.mgr.owns('p-1'), 'a malformed exit must not tear the pane down').toBe(true)
  })

  it('well-formed payloads still forward 1:1 (the TEST-2249 behavior is untouched)', async () => {
    const { h, w } = await connected()
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'hello'] })
    w.push({ type: 'evt', channel: CH.ptyStatus, args: ['p-1', { state: 'busy', since: 2 }] })
    w.push({ type: 'evt', channel: CH.ptyCwd, args: ['p-1', '/srv/app'] })
    w.push({ type: 'evt', channel: CH.ptyExit, args: ['p-1', 3] })
    await settle()
    expect(h.sendsOn(CH.ptyData)).toContainEqual(['p-1', 'hello'])
    expect(h.sendsOn(CH.ptyStatus)).toContainEqual(['p-1', { state: 'busy', since: 2 }])
    expect(h.sendsOn(CH.ptyCwd)).toContainEqual(['p-1', '/srv/app'])
    expect(h.sendsOn(CH.ptyExit)).toContainEqual(['p-1', 3])
    expect(h.mgr.owns('p-1')).toBe(false)
  })
})
