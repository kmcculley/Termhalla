import { win32 } from 'node:path'
import type { ShellInfo, TerminalLaunch } from '@shared/types'
import { shellInjection } from '../status/shell-integration'
import { resolveBin } from '../resolve-bin'

export interface SpawnSpec {
  file: string
  args: string[]
  env?: Record<string, string>
}

/** Decide what to actually spawn: a launch override (e.g. ssh) runs verbatim with no
 *  shell-integration injection; otherwise the shell's integrated args/env (or its own args).
 *
 *  A relative launch command is resolved to a full path first: node-pty's Windows resolver
 *  matches the bare name verbatim against PATH (no PATHEXT), so "ssh"/"aws" never find
 *  ssh.exe/aws.exe and spawn fails with "File not found". `resolve` (injectable for tests)
 *  applies PATH + PATHEXT; if it can't find the command we keep the bare name so node-pty's
 *  error still surfaces, now genuinely meaning "not installed". */
export function resolveSpawnSpec(
  shell: ShellInfo, scriptDir: string,
  launch?: TerminalLaunch,
  resolve: (bin: string) => string | null = (bin) => resolveBin(bin)
): SpawnSpec {
  if (launch) {
    const file = win32.isAbsolute(launch.command)
      ? launch.command
      : (resolve(launch.command) ?? launch.command)
    return { file, args: launch.args }
  }
  const inj = shellInjection(shell, scriptDir)
  return { file: shell.path, args: inj ? inj.args : shell.args, env: inj?.env }
}
