// FROZEN test suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-007).
// REQ-009: the F17 client-ack consumption contract — a FRESH createClientAckPolicy per
// (re)connection (the F17×F18 weld: flow accounting is connection-scoped), ack-on-data at the
// 64 KiB default cadence, a REAL scheduled quiet-flush (CONV-036; injectable scheduler), pruning
// on pane exit, and structurally NO window-frame emission (0018 FINDING-006: v1 never declares a
// window, so the default 1 MiB window / 64 KiB cadence stays well below floor(window/2)).
//
// Runs RED today: src/main/remote/remote-workspace-manager.ts does not exist.
import { describe, it, expect } from 'vitest'
import { CH } from '@shared/ipc-contract'
import type { WireFrame } from '@shared/remote/protocol'
import { mkHarness, settle } from './remote-manager-harness'

const WS = 'ws-1'
const SPAWN = { id: 'p-1', shellId: 'sh', cwd: '', cols: 80, rows: 24, remote: { workspaceId: WS, agentId: 'a-1' } }

const acks = (frames: WireFrame[]) => frames.filter((f): f is Extract<WireFrame, { type: 'ack' }> => f.type === 'ack')

async function connected(over: Parameters<typeof mkHarness>[0] = {}) {
  const h = mkHarness({
    wireOpts: { respond: { 'pty:sessions': () => [], 'pty:spawn': () => null, 'pty:kill': () => null } },
    ...over
  })
  await h.mgr.connectWorkspace(WS, 'a-1')
  await settle()
  const spawned = await h.mgr.spawn(SPAWN as never)
  expect(spawned).toBe(false) // fresh spawn
  return h
}

describe('client ack policy consumption (REQ-009)', () => {
  it('TEST-2236 REQ-009 data below the cadence produces NO ack frame (it accumulates)', async () => {
    const h = await connected()
    const w = h.wires[0]
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'x'.repeat(1000)] })
    await settle()
    expect(acks(w.sent)).toEqual([])
  })

  it('TEST-2237 REQ-009 crossing the 64 KiB default cadence acks the ENTIRE accumulation once and resets', async () => {
    const h = await connected()
    const w = h.wires[0]
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'x'.repeat(40_000)] })
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'x'.repeat(30_000)] })
    await settle()
    const got = acks(w.sent)
    expect(got.length).toBe(1)
    expect(got[0]).toMatchObject({ type: 'ack', id: 'p-1', bytes: 70_000 })
    // reset after the ack: a small follow-up does not ack again
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'x'.repeat(100)] })
    await settle()
    expect(acks(w.sent).length).toBe(1)
  })

  it('TEST-2238 REQ-009 CONV-036 residue is flushed by an ACTUALLY SCHEDULED quiet timer (armed on data, empties on fire)', async () => {
    const h = await connected()
    const w = h.wires[0]
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'x'.repeat(500)] })
    await settle()
    expect(acks(w.sent)).toEqual([]) // below cadence — residue pending
    expect(h.scheduler.pending()).toBeGreaterThan(0) // the timer is REALLY armed, not lazy
    h.scheduler.fire()
    await settle()
    const got = acks(w.sent)
    expect(got.length).toBe(1)
    expect(got[0]).toMatchObject({ id: 'p-1', bytes: 500 })
    // idle after the flush: firing again emits nothing more
    h.scheduler.fire()
    await settle()
    expect(acks(w.sent).length).toBe(1)
  })

  it('TEST-2239 REQ-009 a reconnection gets a FRESH policy: pre-disconnect residue never leaks into the new connection', async () => {
    const h = await connected()
    const w1 = h.wires[0]
    w1.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'x'.repeat(60_000)] }) // residue below 64 KiB
    await settle()
    expect(acks(w1.sent)).toEqual([])
    w1.exit(255) // transport dies with residue pending
    await settle()
    await h.mgr.connectWorkspace(WS, 'a-1') // reconnect -> fresh wire + fresh policy
    await settle()
    const w2 = h.wires[1]
    // 10 KB on the new connection: with a carried-over 60 KB the total would cross 64 KiB and ack.
    w2.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'x'.repeat(10_000)] })
    await settle()
    expect(acks(w2.sent)).toEqual([])   // fresh window — nothing carried across (the weld rule)
    expect(acks(w1.sent)).toEqual([])   // and the dead wire never got a late flush
  })

  it('TEST-2240 REQ-009 pane exit prunes its pending residue (a later quiet-flush emits nothing for it)', async () => {
    const h = await connected()
    const w = h.wires[0]
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'x'.repeat(500)] })
    w.push({ type: 'evt', channel: CH.ptyExit, args: ['p-1', 0] })
    await settle()
    h.scheduler.fire()
    await settle()
    expect(acks(w.sent)).toEqual([])
  })

  it('TEST-2241 REQ-009 the manager NEVER emits a window frame (v1 declares no window — FINDING-006 discipline)', async () => {
    const h = await connected()
    const w = h.wires[0]
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-1', 'x'.repeat(200_000)] })
    await settle()
    h.scheduler.fire()
    await settle()
    h.mgr.resize('p-1', 100, 40)
    h.mgr.write('p-1', 'ls\r')
    h.mgr.kill('p-1')
    await settle()
    expect(w.sent.filter(f => f.type === 'window')).toEqual([])
  })
})
