import { existsSync } from 'node:fs'
import type { ShellInfo } from '@shared/types'

const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'

export const DEFAULT_SHELL_CANDIDATES: ShellInfo[] = [
  { id: 'pwsh', label: 'PowerShell 7',
    path: `${programFiles}\\PowerShell\\7\\pwsh.exe`, args: [] },
  { id: 'powershell', label: 'Windows PowerShell',
    path: `${sysRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: [] },
  { id: 'gitbash', label: 'Git Bash',
    path: `${programFiles}\\Git\\bin\\bash.exe`, args: ['--login', '-i'] },
  { id: 'wsl', label: 'WSL',
    path: `${sysRoot}\\System32\\wsl.exe`, args: [] },
  { id: 'cmd', label: 'Command Prompt',
    path: `${sysRoot}\\System32\\cmd.exe`, args: [] }
]

/** Pure given an `exists` probe — returns candidates that resolve, plus a guaranteed cmd fallback. */
export function detectShells(
  candidates: ShellInfo[] = DEFAULT_SHELL_CANDIDATES,
  exists: (p: string) => boolean = existsSync
): ShellInfo[] {
  const found = candidates.filter(c => exists(c.path))
  if (found.length > 0) return found
  const cmd = candidates.find(c => c.id === 'cmd')
  return cmd ? [cmd] : [{ id: 'cmd', label: 'Command Prompt',
    path: `${sysRoot}\\System32\\cmd.exe`, args: [] }]
}
