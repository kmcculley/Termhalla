import * as pty from 'node-pty'
import type { ShellInfo, TerminalLaunch } from '@shared/types'
import { StatusEngine } from '../status/status-engine'
import { resolveSpawnSpec } from './spawn-spec'
import { sanitizeShellEnv } from './env'

export interface PtySession { id: string; proc: pty.IPty }

export class PtyManager {
  private sessions = new Map<string, PtySession>()

  constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string, code: number) => void,
    private readonly engine: StatusEngine,
    private readonly scriptDir: string
  ) {}

  spawn(id: string, shell: ShellInfo, cwd: string, cols = 80, rows = 24, launch?: TerminalLaunch): void {
    if (this.sessions.has(id)) return
    const dir = cwd && cwd.length ? cwd : (process.env.USERPROFILE ?? process.env.HOME ?? process.cwd())
    const spec = resolveSpawnSpec(shell, this.scriptDir, launch)
    this.engine.register(id)

    let proc: pty.IPty
    try {
      proc = pty.spawn(spec.file, spec.args, {
        name: 'xterm-256color', cols, rows, cwd: dir,
        env: sanitizeShellEnv({ ...process.env, ...(spec.env ?? {}) })
      })
    } catch (e) {
      // A bad launch command (e.g. ssh not on PATH) must not crash main. Surface it
      // to the pane like a process that exited, and unwind the engine registration.
      this.onData(id, `\r\n[failed to launch ${spec.file}: ${(e as Error).message}]\r\n`)
      this.engine.markExit(id, 1); this.engine.unregister(id)
      this.onExit(id, 1)
      return
    }

    proc.onData(d => { this.engine.feed(id, d); this.onData(id, d) })
    proc.onExit(({ exitCode }) => {
      this.engine.markExit(id, exitCode); this.engine.unregister(id)
      this.onExit(id, exitCode); this.sessions.delete(id)
    })
    this.sessions.set(id, { id, proc })
  }

  pidOf(id: string): number | undefined { return this.sessions.get(id)?.proc.pid }
  write(id: string, data: string): void { this.sessions.get(id)?.proc.write(data) }
  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.proc.resize(Math.max(cols, 1), Math.max(rows, 1))
  }
  kill(id: string): void {
    this.sessions.get(id)?.proc.kill(); this.engine.unregister(id); this.sessions.delete(id)
  }
  killAll(): void { for (const id of [...this.sessions.keys()]) this.kill(id) }
}
