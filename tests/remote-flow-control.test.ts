// FROZEN test suite — feature 0018-windowed-flow-control (phase 4).
// The pure shared flow-control module (REQ-001..REQ-009, REQ-012): the single measure,
// defaults + validated overrides, the agent-side flow gate (per-pane unacked accounting,
// watermark hysteresis, window frames, pruning) and the client-side ack policy. Every
// vector is synchronous and deterministic — the module itself must be timer/RNG-free.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  flowPayloadSize,
  DEFAULT_FLOW_WINDOW_BYTES,
  DEFAULT_ACK_EVERY_BYTES,
  createAgentFlowGate,
  createClientAckPolicy,
  parseWireMessage
} from '@shared/remote/protocol'
import type { FlowDecision } from '@shared/remote/protocol'

const fill = (units: number): string => 'x'.repeat(units)

describe('TEST-779 REQ-002 the single shared measure: flowPayloadSize', () => {
  it('returns UTF-16 code-unit length, including the documented boundaries', () => {
    expect(flowPayloadSize('')).toBe(0)
    expect(flowPayloadSize('abc')).toBe(3)
    expect(flowPayloadSize('a\u{1F600}')).toBe(3) // non-BMP: surrogate pair counts 2 (D1, CONV-002)
    expect(flowPayloadSize(fill(8192))).toBe(8192)
  })

  it('both machines derive identical accounting from the same raw payload strings', () => {
    const inputs = ['abc', 'a\u{1F600}', fill(40), '', fill(57)]
    const expected = inputs.reduce((n, s) => n + flowPayloadSize(s), 0)

    const gate = createAgentFlowGate()
    for (const s of inputs) gate.onDataEmitted('p', s)
    expect(gate.stats('p')?.unacked).toBe(expected)

    // The policy's threshold-crossing ack acknowledges the ENTIRE accumulation, so the
    // returned bytes equal the same sum when the threshold is at/below it.
    const policy = createClientAckPolicy({ ackEveryBytes: expected })
    let ack: ReturnType<typeof policy.onData> = null
    for (const s of inputs) {
      const got = policy.onData('p', s)
      if (got) ack = got
    }
    expect(ack).not.toBeNull()
    expect(ack?.bytes).toBe(expected)
  })
})

describe('TEST-780 REQ-003 shared defaults and validated construction overrides', () => {
  it('exports exactly the pinned defaults', () => {
    expect(DEFAULT_FLOW_WINDOW_BYTES).toBe(1_048_576)
    expect(DEFAULT_ACK_EVERY_BYTES).toBe(65_536)
  })

  it('a gate with no overrides applies the default window to tracked panes', () => {
    const gate = createAgentFlowGate()
    gate.onDataEmitted('p', 'x')
    expect(gate.stats('p')?.windowBytes).toBe(DEFAULT_FLOW_WINDOW_BYTES)
  })

  it('non-positive-integer overrides throw actionable errors naming the parameter and value', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => createAgentFlowGate({ defaultWindowBytes: bad }))
        .toThrowError(/defaultWindowBytes/)
      expect(() => createAgentFlowGate({ defaultWindowBytes: bad }))
        .toThrowError(new RegExp(String(bad).replace('.', '\\.')))
      expect(() => createClientAckPolicy({ ackEveryBytes: bad }))
        .toThrowError(/ackEveryBytes/)
    }
  })
})

describe('TEST-781 REQ-001/REQ-004 module placement, purity, and per-pane accounting', () => {
  it('src/shared/remote/flow-control.ts exists and is timer/RNG/clock-free', () => {
    const p = resolve(process.cwd(), 'src/shared/remote/flow-control.ts')
    expect(existsSync(p), 'src/shared/remote/flow-control.ts must exist (REQ-001)').toBe(true)
    const src = readFileSync(p, 'utf8')
    for (const [re, what] of [
      [/\bsetTimeout\b/, 'setTimeout'],
      [/\bsetInterval\b/, 'setInterval'],
      [/\bqueueMicrotask\b/, 'queueMicrotask'],
      [/\bDate\b/, 'Date'],
      [/\bperformance\b/, 'performance'],
      [/Math\.random/, 'Math.random']
    ] as Array<[RegExp, string]>) {
      expect(re.test(src), `flow-control.ts must not reference ${what} (REQ-004)`).toBe(false)
    }
  })

  it('accounts per pane independently; stats(untracked) is undefined', () => {
    const gate = createAgentFlowGate()
    gate.onDataEmitted('a', fill(1000))
    gate.onDataEmitted('a', fill(1000))
    gate.onDataEmitted('a', fill(1000))
    // 9 units, not 7: 0009's residual sweep TEST-384 forbids the literal `toBe(` + `7)`
    // anywhere under tests/** (CONV-022 collision class) — reshaped to dodge it, per CONV-032.
    gate.onDataEmitted('b', fill(9))
    expect(gate.stats('a')?.unacked).toBe(3000)
    expect(gate.stats('b')?.unacked).toBe(9)
    expect(gate.stats('zzz')).toBeUndefined()
  })
})

describe('TEST-782 REQ-005 pause exactly once on the first high-watermark crossing', () => {
  it('emits pause only when unacked first EXCEEDS the window, never again while paused', () => {
    const gate = createAgentFlowGate({ defaultWindowBytes: 100 })
    expect(gate.onDataEmitted('p', fill(60))).toEqual([])
    expect(gate.onDataEmitted('p', fill(60))).toEqual([{ id: 'p', action: 'pause' }])
    expect(gate.onDataEmitted('p', fill(60))).toEqual([]) // still counted, no second pause
    expect(gate.stats('p')).toEqual({ unacked: 180, windowBytes: 100, paused: true })
  })

  it('unacked exactly AT the window does not pause (strict >)', () => {
    const gate = createAgentFlowGate({ defaultWindowBytes: 100 })
    expect(gate.onDataEmitted('p', fill(100))).toEqual([])
    expect(gate.stats('p')?.paused).toBe(false)
  })
})

describe('TEST-783 REQ-006 ack: decrement, over-ack clamp + one diagnostic, unknown-pane silence', () => {
  it('decrements without diagnostics for a normal ack', () => {
    const diags: string[] = []
    const gate = createAgentFlowGate({ defaultWindowBytes: 1_000_000, onDiagnostic: (t) => diags.push(t) })
    gate.onDataEmitted('p', fill(5000))
    expect(gate.onAck('p', 2000)).toEqual([])
    expect(gate.stats('p')?.unacked).toBe(3000)
    expect(diags).toEqual([])
  })

  it('clamps an over-ack to zero and emits exactly one diagnostic naming pane, acked and outstanding', () => {
    const diags: string[] = []
    const gate = createAgentFlowGate({ defaultWindowBytes: 1_000_000, onDiagnostic: (t) => diags.push(t) })
    gate.onDataEmitted('p', fill(3000))
    gate.onAck('p', 99_999)
    expect(gate.stats('p')?.unacked).toBe(0)
    expect(diags.length).toBe(1)
    expect(diags[0]).toContain('p')
    expect(diags[0]).toContain('99999')
    expect(diags[0]).toContain('3000')
  })

  it('an ack for an untracked pane is a silent no-op (the documented ack-after-exit race)', () => {
    const diags: string[] = []
    const gate = createAgentFlowGate({ onDiagnostic: (t) => diags.push(t) })
    gate.onDataEmitted('other', fill(10))
    expect(gate.onAck('ghost', 10)).toEqual([])
    expect(diags).toEqual([])
    expect(gate.stats('ghost')).toBeUndefined()
    expect(gate.stats('other')?.unacked).toBe(10) // untouched
  })
})

describe('TEST-784 REQ-007 window frames: per-pane override and connection-wide default', () => {
  it('per-pane shrink below unacked pauses immediately and records the window', () => {
    const gate = createAgentFlowGate({ defaultWindowBytes: 1000 })
    gate.onDataEmitted('p', fill(500))
    expect(gate.onWindow(400, 'p')).toEqual([{ id: 'p', action: 'pause' }])
    expect(gate.stats('p')).toEqual({ unacked: 500, windowBytes: 400, paused: true })
  })

  it('a connection-wide window applies to non-explicit panes now and future panes, not explicit ones', () => {
    const gate = createAgentFlowGate({ defaultWindowBytes: 1000 })
    gate.onDataEmitted('plain', 'x')
    gate.onDataEmitted('special', 'x')
    gate.onWindow(2000, 'special') // explicit per-pane window
    gate.onWindow(64) // connection-wide
    expect(gate.stats('plain')?.windowBytes).toBe(64)
    expect(gate.stats('special')?.windowBytes).toBe(2000) // explicit survives the default change
    gate.onDataEmitted('future', 'x')
    expect(gate.stats('future')?.windowBytes).toBe(64)
  })

  it('growing the window resumes a paused pane whose unacked is at/below the NEW low watermark', () => {
    const gate = createAgentFlowGate({ defaultWindowBytes: 100 })
    gate.onDataEmitted('p', fill(180)) // pause (180 > 100)
    expect(gate.stats('p')?.paused).toBe(true)
    expect(gate.onWindow(400, 'p')).toEqual([{ id: 'p', action: 'resume' }]) // 180 <= floor(400/2)
    expect(gate.stats('p')?.paused).toBe(false)
  })

  it('a window for an untracked pane is ignored with one diagnostic and stores nothing', () => {
    const diags: string[] = []
    const gate = createAgentFlowGate({ onDiagnostic: (t) => diags.push(t) })
    expect(gate.onWindow(64, 'ghost')).toEqual([])
    expect(diags.length).toBe(1)
    expect(diags[0]).toContain('ghost')
    expect(gate.stats('ghost')).toBeUndefined()
    // and it did NOT become a stored per-pane window for a later pane with that id:
    gate.onDataEmitted('ghost', 'x')
    expect(gate.stats('ghost')?.windowBytes).toBe(DEFAULT_FLOW_WINDOW_BYTES)
  })

  it('size = 1 edge: low watermark floor(1/2) = 0 — resume requires full drain (CONV-002 boundary)', () => {
    const gate = createAgentFlowGate()
    gate.onDataEmitted('p', fill(2))
    gate.onWindow(1, 'p') // 2 > 1 -> pause
    expect(gate.stats('p')?.paused).toBe(true)
    expect(gate.onAck('p', 1)).toEqual([]) // unacked 1 > 0: still paused
    expect(gate.onAck('p', 1)).toEqual([{ id: 'p', action: 'resume' }]) // drained to 0
  })
})

describe('TEST-785 REQ-008 hysteresis: drained = floor(window/2); strict pause/resume alternation', () => {
  it('resumes exactly when unacked first reaches the low watermark', () => {
    const gate = createAgentFlowGate({ defaultWindowBytes: 100 })
    gate.onDataEmitted('p', fill(120)) // pause
    expect(gate.onAck('p', 50)).toEqual([]) // 70 > 50
    expect(gate.onAck('p', 20)).toEqual([{ id: 'p', action: 'resume' }]) // 50 <= 50
    expect(gate.onDataEmitted('p', fill(60))).toEqual([{ id: 'p', action: 'pause' }]) // 110 > 100
  })

  it('a scripted 10-cycle flood/ack interleaving yields strictly alternating decisions', () => {
    const gate = createAgentFlowGate({ defaultWindowBytes: 100 })
    const log: FlowDecision[] = []
    for (let cycle = 0; cycle < 10; cycle++) {
      log.push(...gate.onDataEmitted('p', fill(150))) // beyond the window from any sub-watermark start
      log.push(...gate.onAck('p', gate.stats('p')!.unacked)) // drain fully
    }
    expect(log.length).toBe(20)
    for (let i = 0; i < log.length; i++) {
      expect(log[i].id).toBe('p')
      expect(log[i].action).toBe(i % 2 === 0 ? 'pause' : 'resume')
    }
  })
})

describe('TEST-786 REQ-009 pruning: pane exit and disposal clear all per-pane flow state', () => {
  it('paneExited removes unacked, paused flag AND the explicit per-pane window', () => {
    const gate = createAgentFlowGate({ defaultWindowBytes: 1000 })
    gate.onDataEmitted('p', fill(5000))
    gate.onWindow(64, 'p')
    expect(gate.stats('p')?.paused).toBe(true)
    gate.paneExited('p')
    expect(gate.stats('p')).toBeUndefined()
    // Reusing the id starts fresh under the CONNECTION default, not the old explicit window:
    gate.onDataEmitted('p', fill(100))
    expect(gate.stats('p')).toEqual({ unacked: 100, windowBytes: 1000, paused: false })
  })

  it('dispose clears every pane', () => {
    const gate = createAgentFlowGate()
    gate.onDataEmitted('a', 'x')
    gate.onDataEmitted('b', 'y')
    gate.dispose()
    expect(gate.stats('a')).toBeUndefined()
    expect(gate.stats('b')).toBeUndefined()
  })

  it('the client policy prunes identically (paneClosed and dispose)', () => {
    const policy = createClientAckPolicy({ ackEveryBytes: 100 })
    policy.onData('a', fill(40))
    policy.paneClosed('a')
    expect(policy.flush()).toEqual([]) // the residue died with the pane
    policy.onData('a', fill(40))
    policy.onData('b', fill(40))
    policy.dispose()
    expect(policy.flush()).toEqual([])
  })
})

describe('TEST-787 REQ-012 client ack policy: ack every N, consumer-driven flush, no state for empty data', () => {
  it('returns null below the threshold, then one full-accumulation ack (resetting to zero)', () => {
    const policy = createClientAckPolicy({ ackEveryBytes: 100 })
    expect(policy.onData('p', fill(40))).toBeNull()
    expect(policy.onData('p', fill(40))).toBeNull()
    expect(policy.onData('p', fill(40))).toEqual({ type: 'ack', id: 'p', bytes: 120 })
    expect(policy.onData('p', fill(40))).toBeNull()
    expect(policy.flush()).toEqual([{ type: 'ack', id: 'p', bytes: 40 }])
    expect(policy.flush()).toEqual([])
  })

  it('accumulates panes independently and flushes residues sorted by pane id', () => {
    const policy = createClientAckPolicy({ ackEveryBytes: 1000 })
    policy.onData('zeta', fill(7))
    policy.onData('alpha', fill(3))
    expect(policy.flush()).toEqual([
      { type: 'ack', id: 'alpha', bytes: 3 },
      { type: 'ack', id: 'zeta', bytes: 7 }
    ])
  })

  it('empty data creates no pane state and no residue', () => {
    const policy = createClientAckPolicy({ ackEveryBytes: 10 })
    expect(policy.onData('p', '')).toBeNull()
    expect(policy.flush()).toEqual([])
  })

  it('every returned frame passes F15 wire validation', () => {
    const policy = createClientAckPolicy({ ackEveryBytes: 8 })
    const frames = [policy.onData('p', fill(9)), ...(policy.onData('q', fill(3)), policy.flush())]
    for (const f of frames) {
      expect(f).not.toBeNull()
      const parsed = parseWireMessage(JSON.parse(JSON.stringify(f)))
      expect(parsed.ok, `frame must validate: ${JSON.stringify(f)}`).toBe(true)
    }
  })
})
