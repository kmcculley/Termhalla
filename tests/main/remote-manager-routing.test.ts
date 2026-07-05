// FROZEN test suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-008).
// REQ-008 (spawn/write/resize/kill wire mapping; launch/envId stripped; FINDING-004 pane-id
// discipline; adopted-signal polarity; drop-while-disconnected; redundant-resize suppression),
// REQ-010 (evt -> routed send forwarding, prune on exit), REQ-011 (agent-sourced status
// pass-through — absent lastExit stays an ABSENT KEY), REQ-013 (inventory-driven reconnect:
// sorted attach, reset+snapshot exactly once, dims-then-resize, missing -> exited; the empty
// inventory = the shipped v1 no-daemonization reality, CONV-054).
//
// Wire-shape pins come from the FROZEN agent contract: pty:spawn params are EXACTLY
// {id, shellId, cwd, cols, rows} (launch/envId are rejected by name by the v1 validator);
// pty:kill params are the BARE string id (the F16 contract, re-pinned through 0018's loopback);
// pty:attach params are {id}; pty:sessions params are null.
//
// Runs RED today: src/main/remote/remote-workspace-manager.ts does not exist.
import { describe, it, expect } from 'vitest'
import { CH } from '@shared/ipc-contract'
import type { WireFrame } from '@shared/remote/protocol'
import { mkHarness, settle } from './remote-manager-harness'

const WS = 'ws-1'
const spawnArgs = (id: string, over: Record<string, unknown> = {}) => ({
  id, shellId: 'sh-1', cwd: '', cols: 80, rows: 24,
  remote: { workspaceId: WS, agentId: 'a-1' }, ...over
})

const okStatus = { state: 'idle', since: 1 }

function respondingHarness(inventory: Array<Record<string, unknown>> = []) {
  return mkHarness({
    wireOpts: {
      respond: {
        'pty:sessions': () => inventory,
        'pty:spawn': () => null,
        'pty:kill': () => null,
        'pty:write': () => null,
        'pty:resize': () => null,
        'pty:attach': (params) => {
          const id = (params as { id: string }).id
          const inv = inventory.find(s => s.id === id) as { cols?: number; rows?: number; cwd?: string } | undefined
          return {
            snapshot: `SNAP_${id}`, cols: inv?.cols ?? 80, rows: inv?.rows ?? 24,
            cwd: inv?.cwd ?? '/home/kevin', status: okStatus
          }
        }
      }
    }
  })
}

const reqsOf = (h: ReturnType<typeof mkHarness>, wireIdx = 0) => h.wires[wireIdx].reqs()

describe('remote pty op routing (REQ-008)', () => {
  it('TEST-2242 REQ-008 spawn puts EXACTLY {id, shellId, cwd, cols, rows} on the wire — launch/envId stripped — and resolves false (fresh)', async () => {
    const h = respondingHarness()
    const adopted = await h.mgr.spawn(spawnArgs('p-1', {
      launch: { command: 'ssh evil' }, envId: 'env-7'
    }) as never)
    await settle()
    expect(adopted).toBe(false)
    const spawnReq = reqsOf(h).find(r => r.method === CH.ptySpawn)!
    expect(spawnReq.params).toEqual({ id: 'p-1', shellId: 'sh-1', cwd: '', cols: 80, rows: 24 })
    expect(Object.keys(spawnReq.params as object).sort()).toEqual(['cols', 'cwd', 'id', 'rows', 'shellId'])
  })

  it('TEST-2243 REQ-008 an empty cwd rides the wire as "" (the agent-home default), never a local path substitution', async () => {
    const h = respondingHarness()
    await h.mgr.spawn(spawnArgs('p-1', { cwd: '' }) as never)
    await settle()
    const spawnReq = reqsOf(h).find(r => r.method === CH.ptySpawn)!
    expect((spawnReq.params as { cwd: string }).cwd).toBe('')
  })

  it('TEST-2244 REQ-008 a second spawn for a LIVE pane on the same connection adopts (true) without a second wire spawn (FINDING-004)', async () => {
    const h = respondingHarness()
    await h.mgr.spawn(spawnArgs('p-1') as never)
    await settle()
    const again = await h.mgr.spawn(spawnArgs('p-1') as never)
    await settle()
    expect(again).toBe(true)
    expect(reqsOf(h).filter(r => r.method === CH.ptySpawn).length).toBe(1)
    expect(h.mgr.isAdoptable('p-1')).toBe(true)
  })

  it('TEST-2245 REQ-008 a spawn for an id that already EXITED on this connection is REFUSED: no wire req, resolves false, one actionable diagnostic (FINDING-004)', async () => {
    const h = respondingHarness()
    await h.mgr.spawn(spawnArgs('p-1') as never)
    await settle()
    h.wires[0].push({ type: 'evt', channel: CH.ptyExit, args: ['p-1', 0] })
    await settle()
    const before = reqsOf(h).filter(r => r.method === CH.ptySpawn).length
    const res = await h.mgr.spawn(spawnArgs('p-1') as never)
    await settle()
    expect(res).toBe(false)
    expect(reqsOf(h).filter(r => r.method === CH.ptySpawn).length).toBe(before)
    const diag = h.sendsOn(CH.ptyData).filter(a => a[0] === 'p-1' && /exit/i.test(String(a[1])))
    expect(diag.length).toBe(1)
  })

  it('TEST-2246 REQ-008 write/resize/kill map to the CH-derived methods; pty:kill params are the BARE id string (the F16 wire contract)', async () => {
    const h = respondingHarness()
    await h.mgr.spawn(spawnArgs('p-1') as never)
    await settle()
    h.mgr.write('p-1', 'ls\r')
    h.mgr.resize('p-1', 120, 40)
    h.mgr.kill('p-1')
    await settle()
    const reqs = reqsOf(h)
    expect(reqs.find(r => r.method === CH.ptyWrite)!.params).toEqual({ id: 'p-1', data: 'ls\r' })
    expect(reqs.find(r => r.method === CH.ptyResize)!.params).toEqual({ id: 'p-1', cols: 120, rows: 40 })
    expect(reqs.find(r => r.method === CH.ptyKill)!.params).toBe('p-1')
    expect(h.mgr.owns('p-1')).toBe(false) // kill prunes client-side
  })

  it('TEST-2247 REQ-008 a redundant resize (unchanged dims) is NOT forwarded (the ConPTY-repaint gotcha applied to the wire)', async () => {
    const h = respondingHarness()
    await h.mgr.spawn(spawnArgs('p-1') as never) // spawned at 80x24
    await settle()
    h.mgr.resize('p-1', 80, 24) // redundant
    await settle()
    expect(reqsOf(h).filter(r => r.method === CH.ptyResize).length).toBe(0)
    h.mgr.resize('p-1', 100, 40)
    h.mgr.resize('p-1', 100, 40) // redundant repeat
    await settle()
    expect(reqsOf(h).filter(r => r.method === CH.ptyResize).length).toBe(1)
  })

  it('TEST-2248 REQ-008 while disconnected: writes are dropped, resizes are recorded-not-forwarded, kill prunes locally — and nothing throws', async () => {
    const h = respondingHarness()
    await h.mgr.spawn(spawnArgs('p-1') as never)
    await h.mgr.spawn(spawnArgs('p-2') as never)
    await settle()
    const w = h.wires[0]
    const reqCount = w.reqs().length
    w.exit(255)
    await settle()
    expect(() => {
      h.mgr.write('p-1', 'echo hi\r')
      h.mgr.resize('p-1', 90, 30)
      h.mgr.kill('p-2')
    }).not.toThrow()
    expect(w.reqs().length).toBe(reqCount) // nothing reached the dead wire
    expect(h.mgr.owns('p-2')).toBe(false)  // kill pruned client-side
    expect(h.mgr.owns('p-1')).toBe(true)   // frozen pane still tracked for reconnect
  })
})

describe('push forwarding (REQ-010, REQ-011)', () => {
  it('TEST-2249 REQ-010 pty:data/status/cwd/exit evts forward 1:1 onto the routed send; exit prunes the pane', async () => {
    const h = respondingHarness()
    await h.mgr.spawn(spawnArgs('p-1') as never)
    await settle()
    const w = h.wires[0]
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

  it('TEST-2250 REQ-011 an agent status with NO lastExit forwards with the key ABSENT (never undefined-injected)', async () => {
    const h = respondingHarness()
    await h.mgr.spawn(spawnArgs('p-1') as never)
    await settle()
    h.wires[0].push({ type: 'evt', channel: CH.ptyStatus, args: ['p-1', { state: 'idle', since: 9 }] })
    await settle()
    const payload = h.sendsOn(CH.ptyStatus).find(a => a[0] === 'p-1')![1] as Record<string, unknown>
    expect(payload).toEqual({ state: 'idle', since: 9 })
    expect('lastExit' in payload).toBe(false)
  })
})

describe('inventory-driven reconnect (REQ-013)', () => {
  it('TEST-2251 REQ-013 reconnect re-adopts tracked panes in SORTED id order: reset+snapshot exactly once, status+cwd forwarded, resize only where recorded dims differ', async () => {
    // AMENDED at the 2026-07-04 implement→tests loopback (TEST-AUTHORING defect, the 0021
    // TEST-2105 class): the rig used to serve this AFTER-reconnect inventory to the FIRST
    // connection too, so a correct inventory-driven client legitimately ATTACHED at connection 1
    // (session-survival semantics) and the exactly-once snapshot/resize counts read 2 against a
    // correct implementation. The inventory now starts EMPTY (fresh agent) and is populated
    // in-place only after the first wire dies — every assertion's intent is byte-unchanged.
    const sessionsAfter = [
      { id: 'p-a', shellId: 'sh-1', cwd: '/home/a', cols: 100, rows: 40, attached: false, status: okStatus },
      { id: 'p-b', shellId: 'sh-1', cwd: '/home/b', cols: 80, rows: 24, attached: false, status: okStatus }
    ]
    const inventory: Array<Record<string, unknown>> = [] // connection 1: a fresh, empty agent
    const h = respondingHarness(inventory)
    // Spawn out of sorted order deliberately: p-b then p-a.
    await h.mgr.spawn(spawnArgs('p-b') as never)
    await h.mgr.spawn(spawnArgs('p-a') as never)
    await settle()
    h.mgr.resize('p-a', 120, 30) // recorded (and forwarded) — differs from p-a's inventory dims
    await settle()
    h.wires[0].exit(255)
    await settle()
    inventory.push(...sessionsAfter) // the reconnect's agent holds the two survived sessions

    await h.mgr.connectWorkspace(WS, 'a-1')
    await settle(8)
    const w2 = h.wires[1]
    const reqs2 = w2.reqs()
    expect(reqs2[0].method).toBe('pty:sessions') // inventory first
    const attaches = reqs2.filter(r => r.method === 'pty:attach')
    expect(attaches.map(r => (r.params as { id: string }).id)).toEqual(['p-a', 'p-b']) // sorted
    // Exactly-once reset+snapshot repaint per pane:
    const dataA = h.sendsOn(CH.ptyData).filter(a => a[0] === 'p-a' && String(a[1]).includes('SNAP_p-a'))
    const dataB = h.sendsOn(CH.ptyData).filter(a => a[0] === 'p-b' && String(a[1]).includes('SNAP_p-b'))
    expect(dataA.length).toBe(1)
    expect(dataB.length).toBe(1)
    expect(String(dataA[0][1]).startsWith('\x1bc')).toBe(true)
    expect(String(dataB[0][1]).startsWith('\x1bc')).toBe(true)
    // Status + cwd re-pushed from the attach result:
    expect(h.sendsOn(CH.ptyStatus).some(a => a[0] === 'p-a')).toBe(true)
    expect(h.sendsOn(CH.ptyCwd).some(a => a[0] === 'p-a' && a[1] === '/home/a')).toBe(true)
    // Resize only for the pane whose recorded dims (120x30) differ from the attach dims (100x40):
    const resizes = reqs2.filter(r => r.method === CH.ptyResize)
    expect(resizes.length).toBe(1)
    expect(resizes[0].params).toEqual({ id: 'p-a', cols: 120, rows: 30 })
  })

  it('TEST-2252 REQ-013 an EMPTY inventory (the shipped v1 no-daemonization reality) surfaces every tracked pane as exited and prunes it', async () => {
    const h = respondingHarness([]) // inventory always empty
    await h.mgr.spawn(spawnArgs('p-1') as never)
    await h.mgr.spawn(spawnArgs('p-2') as never)
    await settle()
    h.wires[0].exit(255)
    await settle()
    await h.mgr.connectWorkspace(WS, 'a-1')
    await settle(8)
    for (const id of ['p-1', 'p-2']) {
      const ended = h.sendsOn(CH.ptyData).filter(a => a[0] === id && /session ended/i.test(String(a[1])))
      expect(ended.length, `${id} gets one session-ended line`).toBe(1)
      expect(h.sendsOn(CH.ptyExit)).toContainEqual([id, 0])
      expect(h.mgr.owns(id)).toBe(false)
    }
    expect(h.wires[1].reqs().filter(r => r.method === 'pty:attach')).toEqual([])
  })

  it('TEST-2253 REQ-013 app-start attach-or-spawn: a spawn whose id EXISTS in the fresh connection inventory attaches (adopted=true) instead of spawning', async () => {
    const h = respondingHarness([
      { id: 'p-live', shellId: 'sh-1', cwd: '/srv', cols: 90, rows: 30, attached: false, status: okStatus }
    ])
    const adopted = await h.mgr.spawn(spawnArgs('p-live', { cols: 90, rows: 30 }) as never)
    await settle(8)
    expect(adopted).toBe(true)
    const reqs = reqsOf(h)
    expect(reqs.some(r => r.method === 'pty:attach' && (r.params as { id: string }).id === 'p-live')).toBe(true)
    expect(reqs.filter(r => r.method === CH.ptySpawn)).toEqual([]) // never a second incarnation
    const snap = h.sendsOn(CH.ptyData).filter(a => a[0] === 'p-live' && String(a[1]).includes('SNAP_p-live'))
    expect(snap.length).toBe(1)
  })
})
