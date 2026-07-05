// FROZEN test harness — feature 0022-client-routing-remote-workspace-ux (phase 4).
// Shared by the three remote-manager suites. In-process only (locked decision 1's test posture:
// no ssh, no network — the wire is a stub session handle).
//
// This file FREEZES the manager's DI contract (the plan's TASK-006 prose):
//
//   src/main/remote/remote-workspace-manager.ts exports
//     interface RemoteWire {                    // the consumed slice of F19's AgentSessionHandle
//       version: string
//       capabilities: string[]
//       send(frame: WireFrame): void
//       onFrame(cb: (frame: WireFrame) => void): () => void
//       onExit(cb: (code: number | null) => void): () => void
//       kill(): void
//     }
//     type RemoteConnectResult =
//       | { ok: true; session: RemoteWire }
//       | { ok: false; kind: string; diagnostic: string; indeterminate?: boolean }
//     type RemoteConnectFn = (opts: {
//       agent: NamedAgent; version: string; artifactPath: string; signal: AbortSignal
//     }) => Promise<RemoteConnectResult>
//     interface RemoteScheduler {
//       setTimeout(fn: () => void, ms: number): unknown
//       clearTimeout(timer: unknown): void
//     }
//     interface RemoteManagerDeps {
//       send(channel: string, ...args: unknown[]): void   // the routed pane-scoped send
//       loadAgents(): Promise<NamedAgent[]>
//       connect: RemoteConnectFn
//       version: string
//       artifactPath: string
//       scheduler: RemoteScheduler
//       ackQuietMs?: number
//       ackEveryBytes?: number
//     }
//     class RemoteWorkspaceManager {
//       constructor(deps: RemoteManagerDeps)
//       connectWorkspace(workspaceId: string, agentId: string): Promise<void>
//       disconnectWorkspace(workspaceId: string): void
//       currentStates(): RemoteWorkspaceState[]
//       owns(paneId: string): boolean
//       isAdoptable(paneId: string): boolean
//       spawn(args: PtySpawnArgs): Promise<boolean>
//       write(id: string, data: string): void
//       resize(id: string, cols: number, rows: number): void
//       kill(id: string): void
//       stop(): void
//     }
import { vi } from 'vitest'
import type { WireFrame } from '@shared/remote/protocol'
import type { NamedAgent } from '@shared/remote-agents'
import {
  RemoteWorkspaceManager,
  type RemoteConnectFn,
  type RemoteConnectResult,
  type RemoteManagerDeps,
  type RemoteWire
} from '../../src/main/remote/remote-workspace-manager'

export const AGENTS: NamedAgent[] = [
  { id: 'a-1', name: 'buildbox', host: 'bb.local', user: 'kevin' },
  { id: 'a-2', name: 'lab', host: 'lab.local', user: 'kevin' }
]

export interface StubWire {
  wire: RemoteWire
  sent: WireFrame[]
  /** All outbound req frames, in order. */
  reqs(): Array<{ id: number; method: string; params: unknown }>
  /** Push an inbound frame (evt/res) into the manager. */
  push(frame: WireFrame): void
  exit(code: number | null): void
  killed(): boolean
}

/** A stub session handle. `respond` maps method -> result for AUTO-answered reqs (a microtask
 *  later, mimicking the async wire); methods absent from `respond` stay pending until the test
 *  pushes a res itself. */
export function mkWire(opts: {
  capabilities?: string[]
  respond?: Record<string, (params: unknown) => unknown>
} = {}): StubWire {
  let frameCb: ((f: WireFrame) => void) | null = null
  let exitCb: ((code: number | null) => void) | null = null
  let dead = false
  const sent: WireFrame[] = []
  const wire: RemoteWire = {
    version: '9.9.9',
    capabilities: opts.capabilities ?? ['pty', 'status'],
    send: (f: WireFrame) => {
      sent.push(f)
      if (f.type === 'req' && opts.respond && f.method in opts.respond) {
        const result = opts.respond[f.method](f.params)
        queueMicrotask(() => { if (!dead) frameCb?.({ type: 'res', id: f.id, ok: true, result }) })
      }
    },
    onFrame: (cb) => { frameCb = cb; return () => { frameCb = null } },
    onExit: (cb) => { exitCb = cb; return () => { exitCb = null } },
    kill: vi.fn(() => { dead = true })
  }
  return {
    wire, sent,
    reqs: () => sent.filter((f): f is Extract<WireFrame, { type: 'req' }> => f.type === 'req')
      .map(f => ({ id: f.id, method: f.method, params: f.params })),
    push: (f) => frameCb?.(f),
    exit: (c) => { dead = true; exitCb?.(c) },
    killed: () => dead
  }
}

export interface FakeScheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
  /** Fire every armed timer once (clearing them), returning how many fired. */
  fire(): number
  pending(): number
}

export function mkScheduler(): FakeScheduler {
  let seq = 0
  const timers = new Map<number, () => void>()
  return {
    setTimeout: (fn: () => void) => { const id = ++seq; timers.set(id, fn); return id },
    clearTimeout: (t: unknown) => { timers.delete(t as number) },
    fire: () => { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); return fns.length },
    pending: () => timers.size
  }
}

export interface Harness {
  mgr: RemoteWorkspaceManager
  sends: Array<[string, ...unknown[]]>
  /** Wires in creation order (one per successful connect). */
  wires: StubWire[]
  connect: ReturnType<typeof vi.fn>
  scheduler: FakeScheduler
  lastSignal(): AbortSignal | undefined
  sendsOn(channel: string): Array<unknown[]>
}

export function mkHarness(over: Partial<RemoteManagerDeps> & {
  wireOpts?: Parameters<typeof mkWire>[0]
  connectResults?: RemoteConnectResult[]      // shifted per attempt; default: fresh ok wire each time
} = {}): Harness {
  const sends: Array<[string, ...unknown[]]> = []
  const wires: StubWire[] = []
  const signals: AbortSignal[] = []
  const scheduler = over.scheduler as FakeScheduler ?? mkScheduler()
  const defaultImpl = async (): Promise<RemoteConnectResult> => {
    if (over.connectResults && over.connectResults.length > 0) {
      const r = over.connectResults.shift() as RemoteConnectResult
      if (!r.ok) return r // failure presets short-circuit; an ok preset means "mint a fresh wire"
    }
    const w = mkWire(over.wireOpts)
    wires.push(w)
    return { ok: true, session: w.wire } as RemoteConnectResult
  }
  // AMENDED at the 2026-07-04 implement→tests loopback (TEST-AUTHORING defect, the 0021 TEST-2105
  // class): a test-supplied `over.connect` used to REPLACE this spy via the `...over` spread, so
  // `h.connect` counted zero invocations no matter what the manager did (TEST-2227 could never see
  // its one real attempt). The spy now WRAPS whichever impl is in effect — override or default —
  // so invocation counting always measures the manager. Assertion intents are byte-unchanged.
  const impl = (over.connect as RemoteConnectFn | undefined) ?? defaultImpl
  const connect = vi.fn(async (opts: { agent: NamedAgent; version: string; artifactPath: string; signal: AbortSignal }) => {
    signals.push(opts.signal)
    return impl(opts)
  })
  const deps: RemoteManagerDeps = {
    send: (ch, ...a) => sends.push([ch, ...a]),
    loadAgents: async () => AGENTS,
    version: '9.9.9',
    artifactPath: 'C:/x/termhalla-agent.cjs',
    scheduler,
    ackQuietMs: 200,
    ...over,
    connect: connect as unknown as RemoteManagerDeps['connect']
  }
  const mgr = new RemoteWorkspaceManager(deps)
  return {
    mgr, sends, wires, connect, scheduler,
    lastSignal: () => signals[signals.length - 1],
    sendsOn: (channel: string) => sends.filter(([ch]) => ch === channel).map(([, ...a]) => a)
  }
}

/** Let queued microtasks + macrotask-0 work settle. */
export const settle = async (rounds = 4): Promise<void> => {
  for (let i = 0; i < rounds; i++) await new Promise(r => setTimeout(r, 0))
}
