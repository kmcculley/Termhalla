import type { ProcInfo } from '@shared/types'
import { buildProcInfo, type CimRow } from './proc-tree'
import { queryProcesses } from './cim-query'

type RunQuery = () => Promise<CimRow[]>

const CLEARED = '∅' // sentinel signature meaning "emitted null"

/** Parse a proc-poll interval override (ms) from an env value, falling back to 1000.
 *  e2e sets this high to stop the busy-gated CIM poll from spawning a powershell.exe
 *  every second and starving concurrent node-pty spawns. Rejects non-positive/garbage. */
export function procPollIntervalMs(raw: string | undefined, fallback = 1000): number {
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Polls the OS process table (only while a session is busy) and emits each busy
 *  terminal's foreground/tree. Idle sessions get a single null (chip falls back to shell name). */
export class ProcessTracker {
  private sessions = new Map<string, { busy: boolean }>()
  private lastSig = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private querying = false

  constructor(
    private readonly pidOf: (id: string) => number | undefined,
    private readonly onProcs: (id: string, info: ProcInfo | null) => void,
    private readonly runQuery: RunQuery = queryProcesses,
    private readonly intervalMs = 1000
  ) {}

  register(id: string): void {
    if (this.sessions.has(id)) return
    this.sessions.set(id, { busy: false })
    this.ensureTimer()
  }

  unregister(id: string): void {
    if (this.sessions.delete(id)) {
      this.lastSig.delete(id)
      this.onProcs(id, null)
    }
    if (this.sessions.size === 0) this.stopTimer()
  }

  setBusy(id: string, busy: boolean): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.busy = busy
    if (!busy) this.clear(id) // back to shell-name fallback immediately
  }

  /** One query+emit cycle. No-op when nothing is busy or a query is already in flight. */
  async pollOnce(): Promise<void> {
    if (this.querying) return
    const busyIds = [...this.sessions.entries()].filter(([, s]) => s.busy).map(([id]) => id)
    if (busyIds.length === 0) return
    this.querying = true
    let rows: CimRow[]
    try { rows = await this.runQuery() } finally { this.querying = false }
    for (const id of busyIds) {
      if (!this.sessions.get(id)?.busy) continue // may have gone idle during the await
      const pid = this.pidOf(id)
      if (pid === undefined) { this.clear(id); continue }
      const info = buildProcInfo(rows, pid)
      const sig = info.foreground + '|' + info.tree.map(n => n.pid).join(',')
      if (this.lastSig.get(id) !== sig) {
        this.lastSig.set(id, sig)
        this.onProcs(id, info)
      }
    }
  }

  dispose(): void {
    this.sessions.clear()
    this.lastSig.clear()
    this.stopTimer()
  }

  private clear(id: string): void {
    if (!this.sessions.has(id)) return
    if (this.lastSig.get(id) !== CLEARED) {
      this.lastSig.set(id, CLEARED)
      this.onProcs(id, null)
    }
  }

  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.pollOnce() }, this.intervalMs)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  private stopTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }
}
