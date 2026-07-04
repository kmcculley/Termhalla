/**
 * The real pty backend over node-pty (REQ-011) — POSIX-shaped, Linux-only in v1 (locked
 * decision 9; macOS stays nearly free later). NO Windows branches by design.
 *
 * node-pty is loaded LAZILY, only when this backend is actually selected: dev checkouts carry
 * an Electron-ABI node-pty binary that a plain-Node agent process cannot load, and CI never
 * selects this backend (`--pty=fake` drives the identical protocol path). The dynamic
 * `import('node-pty')` below is the load-bearing guard TEST-755 pins — never convert it to a
 * static import.
 *
 * Shell resolution (REQ-007): the v1 registry is the single POSIX default — `$SHELL`, else
 * `/bin/sh`. ANY `shellId` maps to it, mirroring the local `shells.find(...) ?? shells[0]`
 * fallback semantics.
 */
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from './pty-backend'

/** Structural mirror of the node-pty surface the backend touches (a static `import type` of
 *  the real declarations would trip TEST-755's static-import pin). */
interface NodePtyProc {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(cb: (data: string) => void): void
  onExit(cb: (ev: { exitCode: number }) => void): void
}
interface NodePtyModule {
  spawn(
    file: string,
    args: string[] | string,
    options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string | undefined> }
  ): NodePtyProc
}

/** Load node-pty once and return the backend. Async so the module load happens at backend
 *  SELECTION time; `spawn` itself stays synchronous for the session. */
export const createNodePtyBackend = async (): Promise<AgentPtyBackend> => {
  const pty = (await import('node-pty')) as unknown as NodePtyModule
  const defaultShell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : '/bin/sh'

  return {
    spawn(opts: AgentSpawnOpts): AgentPtyHandle {
      // v1: every shellId resolves to the default POSIX shell (see module header).
      const proc = pty.spawn(defaultShell, [], {
        name: 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        env: process.env
      })
      return {
        write: (data) => proc.write(data),
        resize: (cols, rows) => proc.resize(cols, rows),
        kill: () => proc.kill(),
        onData: (cb) => proc.onData(cb),
        onExit: (cb) => proc.onExit(({ exitCode }) => cb(exitCode))
      }
    }
  }
}
