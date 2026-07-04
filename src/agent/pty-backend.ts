/**
 * The injectable pty backend partition (REQ-011).
 *
 * The agent core depends ONLY on these interfaces. Two implementations ship:
 * `node-pty-backend.ts` (the real thing — POSIX, Linux-only in v1, lazily loads node-pty) and
 * `fake-backend.ts` (the deterministic scripted pseudo-shell CI drives via `--pty=fake`).
 * The protocol path above the backend is identical either way — that is the point.
 */

/** What the session hands a backend for one pane. `cwd` arrives already resolved (an empty
 *  wire cwd was replaced by the agent's home dir — REQ-007); `shellId` is passed through
 *  verbatim and RESOLUTION is the backend's own concern (v1: any id maps to the single
 *  default shell, mirroring the local `shells.find(...) ?? shells[0]` fallback). */
export interface AgentSpawnOpts {
  id: string
  cwd: string
  cols: number
  rows: number
  shellId: string
}

/** One live pane. Handles buffer their emissions until the corresponding callback attaches
 *  (the session attaches right after `spawn` returns), then deliver synchronously in order. */
export interface AgentPtyHandle {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
}

export interface AgentPtyBackend {
  /** Spawn a pane. Throws on failure — the session maps a throw to a `spawn-failed` res. */
  spawn(opts: AgentSpawnOpts): AgentPtyHandle
}
