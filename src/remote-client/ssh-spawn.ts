/**
 * The system-ssh spawn seam (REQ-007). The transport IS the user's `ssh` binary — spawned
 * as a child process with an argv ARRAY (never a shell, never an SSH library — locked
 * decision 1) so it inherits ~/.ssh/config, jump hosts, hardware keys, and 2FA prompting.
 * Tests inject `{ program: process.execPath, prefixArgs: [fake-ssh shim] }` and run the
 * IDENTICAL protocol path with no network.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** Resolved via PATH at spawn time — the system OpenSSH client. */
export const DEFAULT_SSH_PROGRAM = 'ssh'

export interface SshProgramOverride {
  program?: string
  prefixArgs?: string[]
}

export function spawnSsh(
  override: SshProgramOverride | undefined, argv: string[]
): ChildProcessWithoutNullStreams {
  const program = override?.program ?? DEFAULT_SSH_PROGRAM
  const prefix = override?.prefixArgs ?? []
  const child = spawn(program, [...prefix, ...argv], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  // The parent (eventually the Electron main process, via F21) must never be kept alive
  // by a lingering tunnel child — the repo's long-lived-child gotcha. The live pipes
  // still ref the loop while open; kill()/stream teardown is the real release.
  child.unref()
  return child
}
