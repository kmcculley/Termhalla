/**
 * The pure detached-spawn-spec builder (REQ-004/REQ-011): builds the `child_process.spawn`
 * argv/options for launching `node <ownArtifactPath> --daemon --pty=<backend> [--ws=<token>]
 * [--socket=<path>] [--idle-timeout-ms=<n>]`, detached (POSIX `setsid` semantics), with stdin
 * ignored and stdout/stderr routed to the daemon LOG fd — never inherited from the spawning ssh
 * exec channel (a retained fd would wedge every disconnect and could leak daemon output onto the
 * frames-only stdout), and never discarded to `ignore` so an uncaught crash of the long-lived
 * headless daemon leaves a forensic trace (FINDING-011). A pure builder so the detach shape is
 * unit-testable without a real spawn (`bridge.ts` is the impure caller that opens the log fd).
 */

export interface DaemonSpawnSpecInput {
  /** The version-embedded artifact path — the daemon is launched from the SAME artifact file so
   *  module resolution (e.g. the 0023 co-provisioned node-pty) still starts in the agent dir. */
  artifactPath: string
  ptyBackend: 'node-pty' | 'fake'
  /** An open file descriptor for the daemon log — the child's stdout/stderr target it. */
  logFd: number
  /** The workspace scope, forwarded verbatim when given (REQ-011); omitted otherwise. */
  wsToken?: string
  /** Forwarded verbatim when given; omitted otherwise (REQ-001/REQ-011). */
  socketPath?: string
  idleTimeoutMs?: number
}

export interface DaemonSpawnSpec {
  command: string
  args: string[]
  options: {
    detached: true
    stdio: ['ignore', number, number]
  }
}

export const buildDaemonSpawnSpec = (input: DaemonSpawnSpecInput): DaemonSpawnSpec => {
  const args = [input.artifactPath, '--daemon', `--pty=${input.ptyBackend}`]
  if (input.wsToken !== undefined) args.push(`--ws=${input.wsToken}`)
  if (input.socketPath !== undefined) args.push(`--socket=${input.socketPath}`)
  if (input.idleTimeoutMs !== undefined) args.push(`--idle-timeout-ms=${input.idleTimeoutMs}`)
  return {
    command: process.execPath,
    args,
    options: { detached: true, stdio: ['ignore', input.logFd, input.logFd] }
  }
}
