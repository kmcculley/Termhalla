import * as pty from 'node-pty'
import type { ShellInfo } from '@shared/types'

export interface PtySession { id: string; proc: pty.IPty }

export class PtyManager {
  private sessions = new Map<string, PtySession>()

  constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string, code: number) => void
  ) {}

  spawn(id: string, shell: ShellInfo, cwd: string, cols = 80, rows = 24): void {
    if (this.sessions.has(id)) return
    const dir = cwd && cwd.length ? cwd : (process.env.USERPROFILE ?? process.env.HOME ?? process.cwd())
    const proc = pty.spawn(shell.path, shell.args, {
      name: 'xterm-256color', cols, rows,
      cwd: dir, env: process.env as Record<string, string>
    })
    proc.onData(d => this.onData(id, d))
    proc.onExit(({ exitCode }) => { this.onExit(id, exitCode); this.sessions.delete(id) })
    this.sessions.set(id, { id, proc })
  }

  write(id: string, data: string): void { this.sessions.get(id)?.proc.write(data) }
  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.proc.resize(Math.max(cols, 1), Math.max(rows, 1))
  }
  kill(id: string): void { this.sessions.get(id)?.proc.kill(); this.sessions.delete(id) }
  killAll(): void { for (const id of [...this.sessions.keys()]) this.kill(id) }
}
