// Feature 0013 — OS-level needs-you notifications (the pure observer half, TASK-001..TASK-004).
//
// A main-process observer over the cross-project registry aggregate (feature 0005). It derives its
// needs-a-human-now set from the shared, pure `buildDecisionQueue` selector — the SAME membership F6
// renders from, never a second gate implementation (REQ-002) — and turns transitions INTO needs-you
// into notifications, deduped by `(projectRoot, featureSlug, reason)` (REQ-003) and rate-bounded by a
// tumbling window with a coalesced digest (REQ-004).
//
// Everything here is PURE and TOTAL: no Electron, no clock read, no disk/registry access. Every
// ambient — the clock, the opt-in gate, the two notification sinks, and the timer scheduler — is
// injected via `NeedsYouDeps`, so the diff/dedupe/throttle logic is unit-testable with stubs (the
// production sinks that construct the real `Notification`, dispatch the focus channel, and drive the
// window-close flush with the real setTimeout/clearTimeout live in the composition root, NOT here).
// Malformed input never throws (the shared selector's totality, CONV-002). State stays bounded: dedupe
// keys are pruned for roots that leave membership (REQ-011), and the window buffer + its armed timer
// are cleared on every window close / flush / dispose (FINDING-005 — no leak, no double-fire).
import { buildDecisionQueue, type DecisionQueueItem } from '@shared/decision-queue'
import type { OrkyRegistrySnapshot } from '@shared/types'

/** The tumbling coalesce window: opens at the first transition emitted while no window is open, and
 *  closes exactly `COALESCE_WINDOW_MS` later (REQ-004 / CONV-003). */
export const COALESCE_WINDOW_MS = 4000
/** Individual toasts per window before further transitions coalesce into one digest (REQ-004). */
export const DIGEST_THRESHOLD = 3

/** The injected ambients — the ONLY seam through which the observer touches the outside world
 *  (REQ-001/REQ-005). Retained even in production so the pure logic stays testable with stubs. */
export interface NeedsYouDeps {
  /** Injected clock (ms). The throttle's window arithmetic is a pure function of these values. */
  now: () => number
  /** App-wide opt-in gate (REQ-005). Consulted at notification-construction time, PER ITEM: a denied
   *  item is neither shown individually nor counted in the digest (spec risk note #2 — this placement
   *  is load-bearing for the throttle arithmetic). The production source is a main-side in-memory
   *  mirror of the app-wide opt-in preference (!== false), live-refreshed off the quickSave payload. */
  shouldNotify: (projectRoot: string) => boolean
  /** Individual per-project toast sink. */
  notifyOne: (n: { title: string; body: string; projectRoot: string }) => void
  /** Coalesced digest sink (app-wide; no single project root). */
  notifyDigest: (n: { title: string; body: string; projectCount: number }) => void
  /** FINDING-005 timer seam. Arms the window-close flush at `windowOpenedAt + COALESCE_WINDOW_MS` when
   *  a window opens; cleared on window roll / flush() / dispose(). Injected so the boundary flush is
   *  driven (not lazy) yet testable with a fake scheduler and no real clock — the shipped observer
   *  armed nothing, so a burst-then-quiet digest stranded until the next transition or teardown.
   *  Production wires the real setTimeout/clearTimeout (register.ts). Optional: a caller that never
   *  drives the quiet-elapse path (e.g. the live-refresh mirror seam) may omit them — the observer then
   *  falls back to the lazy roll/flush/dispose window close, exactly as before. */
  setTimer?: (fn: () => void, ms: number) => unknown   // returns an opaque handle
  clearTimer?: (handle: unknown) => void
}

/** The dedupe identity for a needs-you feature: the aggregate's own canonical root (CONV-010), the
 *  feature slug, and the reason. A reason change is a fresh identity → a re-notify (REQ-003).
 *  FINDING-014: a POSIX path segment or a feature slug may legally contain any byte except '/' and NUL,
 *  so a printable separator (a newline join) can collapse two distinct (root, slug, reason) tuples into
 *  one key — a false-dedupe that silently suppresses a genuine transition. A STRUCTURAL key
 *  (`JSON.stringify` of the tuple) is provably collision-free: the field boundaries are unambiguous and
 *  every field is quote-escaped, so no in-field character can forge a boundary. */
function keyOf(item: DecisionQueueItem): string {
  return JSON.stringify([item.projectRoot, item.featureSlug, String(item.status?.reason)])
}

/** Escape the Pango-significant characters (`& < >`) in an on-disk-derived name before it is
 *  interpolated into a notification body (FINDING-012). On Linux the notification server (libnotify /
 *  Pango) parses a limited markup set in the body, so a crafted project/feature directory name from an
 *  adopted repo could inject a tag or, worse, an unbalanced tag that makes a strict server drop the
 *  whole body. Entity-encoding keeps the text plain and intact on every platform (macOS/Windows render
 *  it verbatim). `&` MUST be encoded first so the `<`/`>` entities are not double-encoded. */
function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Basename of a root path, tolerant of both separators and trailing separators (REQ-010 copy). */
function basenameOf(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root
}

/** Human, honest reason phrasing (REQ-010): never a completeness word, never the literal "null". */
function reasonPhrase(reason: unknown): string {
  switch (reason) {
    case 'escalation': return 'open escalation'
    case 'stalled': return 'stalled — waiting on you'
    case 'human-review': return 'awaiting human review'
    default: return 'needs a decision'
  }
}

/** Main-process observer: subscribe its `onSnapshot` to the registry aggregate's snapshot event,
 *  `flush()` on a window boundary you want forced, and `dispose()` on teardown (flushes any pending
 *  digest, clears all state, and goes inert). Idempotent and safe if a snapshot/flush arrives after
 *  dispose. */
export class OrkyNeedsYouNotifier {
  private readonly deps: NeedsYouDeps
  /** Root-scoped dedupe: `root -> set of active (root,slug,reason) keys`. Root-scoping makes
   *  vanished-project pruning an O(1) delete rather than a full-map scan (REQ-003/REQ-011). */
  private readonly dedupe = new Map<string, Set<string>>()
  // Tumbling-window state (all reset on window close / flush / dispose).
  private windowOpenedAt: number | null = null
  private individualCount = 0
  private shownRoots = new Set<string>()      // roots surfaced individually this window
  private bufferedRoots = new Set<string>()   // distinct roots coalesced into the pending digest
  private flushTimer: unknown = null          // the armed window-close flush handle (FINDING-005)
  private disposed = false

  constructor(deps: NeedsYouDeps) {
    this.deps = deps
  }

  /** The diff + dedupe + throttle entry point. Pure w.r.t. everything but the injected ambients. */
  onSnapshot(snapshot: OrkyRegistrySnapshot): void {
    if (this.disposed) return
    // Needs-you set for this snapshot, off the shared selector (total: malformed → []).
    const groups = buildDecisionQueue(snapshot as never)
    const currentByRoot = new Map<string, Map<string, DecisionQueueItem>>()
    for (const g of groups) {
      const m = new Map<string, DecisionQueueItem>()
      for (const it of g.items) m.set(keyOf(it), it)
      currentByRoot.set(g.projectRoot, m)
    }

    // Live members = roots present in the raw snapshot carrying a status object. A root that has left
    // membership (absent) OR whose status is null (not-yet-read / unreadable) is NOT live, so ALL its
    // dedupe keys are pruned (REQ-003 vanished-project vector / REQ-011 bounded state).
    const liveMembers = new Set<string>()
    if (Array.isArray(snapshot)) {
      for (const e of snapshot) {
        if (e && typeof e === 'object' && typeof (e as { root?: unknown }).root === 'string' &&
            (e as { root: string }).root.length > 0) {
          const status = (e as { status?: unknown }).status
          if (status && typeof status === 'object') liveMembers.add((e as { root: string }).root)
        }
      }
    }
    for (const root of [...this.dedupe.keys()]) {
      if (!liveMembers.has(root)) this.dedupe.delete(root)
    }

    // Transition candidates: any current key NOT already active for its root. Order follows the
    // selector's deterministic group/item order, so a replayed sequence yields identical output.
    const candidates: DecisionQueueItem[] = []
    for (const [root, m] of currentByRoot) {
      const prev = this.dedupe.get(root)
      const nextSet = new Set<string>()
      for (const [key, item] of m) {
        nextSet.add(key)
        if (!prev || !prev.has(key)) candidates.push(item)
      }
      this.dedupe.set(root, nextSet)
    }
    // A live member whose features all resolved this push has no current keys — drop its stale set so
    // a later genuine re-entry re-notifies (REQ-003 resolved→re-notify).
    for (const root of liveMembers) {
      if (!currentByRoot.has(root)) this.dedupe.delete(root)
    }

    if (candidates.length === 0) return
    const now = this.deps.now()
    for (const item of candidates) this.admit(item, now)
  }

  /** Route one transition through the tumbling window + the per-item opt-in gate (REQ-004/REQ-005). */
  private admit(item: DecisionQueueItem, now: number): void {
    this.manageWindow(now)
    const root = item.projectRoot
    if (this.individualCount < DIGEST_THRESHOLD) {
      // Individual zone: gate at construction time. A denied item consumes no slot (it is simply not
      // shown), so a later allowed item in the same window still gets its individual toast.
      if (this.deps.shouldNotify(root)) {
        this.deps.notifyOne(this.individualCopy(item))
        this.individualCount++
        this.shownRoots.add(root)
      }
      return
    }
    // Buffer zone: coalesce into the pending digest — but only allowed items, and only roots not
    // already surfaced individually this window (REQ-004's "never re-counted" rule).
    if (this.deps.shouldNotify(root) && !this.shownRoots.has(root)) {
      this.bufferedRoots.add(root)
    }
  }

  /** Open a fresh window, or roll (close→flush→open) when `now` is at/past the current window close. */
  private manageWindow(now: number): void {
    if (this.windowOpenedAt === null) {
      this.openWindow(now)
    } else if (now >= this.windowOpenedAt + COALESCE_WINDOW_MS) {
      this.closeWindow()
      this.openWindow(now)
    }
  }

  private openWindow(now: number): void {
    this.windowOpenedAt = now
    this.individualCount = 0
    this.shownRoots = new Set<string>()
    this.bufferedRoots = new Set<string>()
    this.armFlushTimer()
  }

  /** Arm the single window-close flush at `windowOpenedAt + COALESCE_WINDOW_MS` (FINDING-005). The
   *  injected scheduler is given a RELATIVE delay of `COALESCE_WINDOW_MS` at open time, so it fires at
   *  the absolute boundary. One-shot: the callback nulls its own handle, then closes the window (which
   *  is a no-op re-clear on that handle). If no scheduler is injected the window still closes lazily on
   *  the next roll / flush() / dispose(). */
  private armFlushTimer(): void {
    this.clearFlushTimer()
    if (this.deps.setTimer) {
      this.flushTimer = this.deps.setTimer(() => {
        this.flushTimer = null
        if (!this.disposed) this.closeWindow()
      }, COALESCE_WINDOW_MS)
    }
  }

  /** Clear any armed window-close timer (window roll / flush / dispose). Idempotent. */
  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      this.deps.clearTimer?.(this.flushTimer)
      this.flushTimer = null
    }
  }

  /** Emit the pending digest (if any) and reset window state. The count is the number of DISTINCT
   *  buffered roots that are STILL gate-allowed at emit time — FINDING-015: the app-wide opt-in is
   *  re-consulted here, so a mute that lands AFTER roots were buffered but BEFORE the window closes
   *  suppresses the pending digest too (the individual path already gates at admit time). Each buffered
   *  root was also NOT already shown individually this window (REQ-004's "never re-counted" rule). */
  private closeWindow(): void {
    this.clearFlushTimer()
    const allowed = [...this.bufferedRoots].filter(root => this.deps.shouldNotify(root))
    if (allowed.length > 0) {
      this.deps.notifyDigest(this.digestCopy(allowed.length))
    }
    this.windowOpenedAt = null
    this.individualCount = 0
    this.shownRoots = new Set<string>()
    this.bufferedRoots = new Set<string>()
  }

  private individualCopy(item: DecisionQueueItem): { title: string; body: string; projectRoot: string } {
    // The basename and the feature slug are on-disk-derived (attacker-influenceable) strings, so they
    // are markup-escaped before interpolation (FINDING-012). The reason phrasing is a fixed vocabulary.
    const projectName = escapeMarkup(basenameOf(item.projectRoot))
    const featureSlug = escapeMarkup(item.featureSlug)
    return {
      title: `${projectName} needs you`,
      body: `${featureSlug}: ${reasonPhrase(item.status?.reason)}`,
      projectRoot: item.projectRoot
    }
  }

  private digestCopy(projectCount: number): { title: string; body: string; projectCount: number } {
    const plural = projectCount === 1 ? 'project' : 'projects'
    return {
      title: `${projectCount} ${plural} need you`,
      body: `${projectCount} ${plural} need a decision.`,
      projectCount
    }
  }

  /** Emit any pending coalesced digest immediately and reset the window (used at a forced boundary and
   *  by dispose). No-op after dispose. */
  flush(): void {
    if (this.disposed) return
    this.closeWindow()
  }

  /** Flush a pending digest exactly once, then go inert: clear all dedupe/window state, clear any armed
   *  window-close timer (via closeWindow), and ignore any later snapshot/flush (REQ-012). Idempotent —
   *  no leak, no double-fire (FINDING-005). */
  dispose(): void {
    if (this.disposed) return
    this.closeWindow()
    this.disposed = true
    this.dedupe.clear()
  }
}
