import { join } from 'node:path'
import type { ShellInfo } from '@shared/types'
import { PS_FILE, SH_FILE } from './integration-scripts'

export const PS_SCRIPT = PS_FILE
export const SH_SCRIPT = SH_FILE

// cmd.exe has no PROMPT_COMMAND hook, but it expands codes in the PROMPT env var on every
// prompt: $E=ESC, $P=cwd, $G='>'. We prefix the normal `path>` prompt with `OSC 9;9;<cwd> ST`
// so CwdParser can read the cwd — without this, cmd panes never report a cwd and so never
// persist/restore one. ST (ESC '\') terminates the OSC because cmd's PROMPT can emit ESC but
// not BEL; the scanner accepts both. This is the mechanism Windows Terminal documents for cmd.
export const CMD_PROMPT = '$E]9;9;$P$E\\$P$G'

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
  if (shell.id === 'cmd') {
    // No args swap: cmd keeps its own args and reports cwd purely via the PROMPT env var.
    return { args: shell.args, env: { PROMPT: CMD_PROMPT } }
  }
  return null
}
