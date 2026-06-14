import type { ShellInfo } from '@shared/types'
import { shellInjection } from '../status/shell-integration'

export interface SpawnSpec {
  file: string
  args: string[]
  env?: Record<string, string>
}

/** Decide what to actually spawn: a launch override (e.g. ssh) runs verbatim with no
 *  shell-integration injection; otherwise the shell's integrated args/env (or its own args). */
export function resolveSpawnSpec(
  shell: ShellInfo, scriptDir: string,
  launch?: { command: string; args: string[] }
): SpawnSpec {
  if (launch) return { file: launch.command, args: launch.args }
  const inj = shellInjection(shell, scriptDir)
  return { file: shell.path, args: inj ? inj.args : shell.args, env: inj?.env }
}
