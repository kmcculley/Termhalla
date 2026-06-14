import { join } from 'node:path'
import type { ShellInfo } from '@shared/types'
import { PS_FILE, SH_FILE } from './integration-scripts'

export const PS_SCRIPT = PS_FILE
export const SH_SCRIPT = SH_FILE

export interface Injection { args: string[]; env: Record<string, string> }

/** Map a shell to the spawn args/env that inject OSC 133 markers, or null for heuristics-only. */
export function shellInjection(shell: ShellInfo, scriptDir: string): Injection | null {
  if (shell.id === 'pwsh' || shell.id === 'powershell') {
    const path = join(scriptDir, PS_FILE)
    return { args: ['-NoExit', '-Command', `. '${path.replace(/'/g, "''")}'`], env: {} }
  }
  if (shell.id === 'gitbash' || shell.id === 'wsl') {
    const path = join(scriptDir, SH_FILE)
    return { args: ['--rcfile', path, '-i'], env: {} }
  }
  return null
}
