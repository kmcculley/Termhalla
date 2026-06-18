import type { CloudStatus } from '@shared/types'
import type { CloudProvider } from './providers'
import { resolveProviders as defaultResolveProviders } from './providers'
import { classifyProbe, type ProbeResult } from './classify'
import { runCliProbe } from './probe'

type RunProbe = (provider: CloudProvider, signal?: AbortSignal) => Promise<ProbeResult>

/** Periodically probes each provider's CLI for login status and emits the full array.
 *  Stale-while-revalidate: keeps the last good result on a transient error; shows
 *  'checking' only on first load; never overlaps refresh cycles. */
export class CloudStatusService {
  private last = new Map<string, CloudStatus>()
  private lastSig = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private refreshing = false
  private abort = new AbortController()
  private current: CloudProvider[] = []

  constructor(
    private readonly onStatus: (statuses: CloudStatus[]) => void,
    private readonly resolveProviders: () => CloudProvider[] = defaultResolveProviders,
    private readonly runProbe: RunProbe = runCliProbe,
    private readonly now: () => number = () => Date.now(),
    private readonly intervalMs = 60000
  ) {}

  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, this.intervalMs)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    // Kill any in-flight probe child so a slow CLI can't keep the main process alive
    // and stall app shutdown; arm a fresh controller for any later restart.
    this.abort.abort()
    this.abort = new AbortController()
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      this.current = this.resolveProviders()
      let showedChecking = false
      for (const p of this.current) {
        if (!this.last.has(p.id)) {
          this.last.set(p.id, { id: p.id, label: p.label, family: p.family, profile: p.profile, state: 'checking', checkedAt: this.now(), login: p.login })
          showedChecking = true
        }
      }
      if (showedChecking) this.emit()

      await Promise.all(this.current.map(async p => {
        const result = await this.runProbe(p, this.abort.signal)
        const fresh = classifyProbe(p, result, this.now())
        const prior = this.last.get(p.id)
        const keepStale = fresh.state === 'error' && prior && prior.state !== 'error' && prior.state !== 'checking'
        this.last.set(p.id, keepStale ? prior! : fresh)
      }))
      this.emit()
    } finally {
      this.refreshing = false
    }
  }

  /** The latest known status for every current provider. A renderer that mounts after a push (which
   *  is fire-and-forget and otherwise lost) pulls this so it never gets stuck on the empty state. */
  snapshot(): CloudStatus[] {
    return this.current.map(p => this.last.get(p.id)).filter((s): s is CloudStatus => Boolean(s))
  }

  private emit(): void {
    const statuses = this.snapshot()
    const sig = statuses.map(s =>
      `${s.id}:${s.state}:${s.account ?? ''}:${s.detail ? Object.entries(s.detail).map(([k, v]) => `${k}=${v}`).join(',') : ''}`
    ).join('|')
    if (sig === this.lastSig) return
    this.lastSig = sig
    this.onStatus(statuses)
  }
}
