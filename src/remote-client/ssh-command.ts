/**
 * Pure ssh command builders for the F19 exec channel (REQ-005/006/008/009/012/013).
 *
 * These exact strings are a WIRE CONTRACT three ways: the frozen unit suite pins them
 * (tests/remote-client-command.test.ts), the fake ssh shim parses them
 * (tests/fixtures/fake-ssh.mjs), and a real Linux login shell executes them. Change the
 * shape only through a sanctioned tests-phase amendment — never casually.
 *
 * Injection posture (REQ-006): the CLIENT side passes an argv ARRAY to spawn (no shell),
 * so the two attack surfaces are (a) ssh OPTION injection — a seeded field beginning with
 * `-` becoming an option — and (b) the REMOTE shell evaluating interpolated paths. Every
 * seeded field is validated here, with specific, actionable errors (CONV-001), before any
 * argv exists.
 */

export const DEFAULT_REMOTE_AGENT_DIR = '~/.termhalla/agent'

/** Launch-probe sentinel: the artifact is absent at the install path (REQ-009). */
export const LAUNCH_ABSENT_EXIT = 127

/** Upload sentinel: the received byte count mismatched — temp removed, nothing promoted
 *  (REQ-012). Any remote-write failure in the chain lands here too; the final path is
 *  never occupied by a partial artifact. */
export const UPLOAD_SIZE_MISMATCH_EXIT = 93

export interface SshExecSeed {
  host: string
  user: string
  port?: number          // omit / 0 / 22 → no -p (mirrors buildSshArgs in @shared/quick)
  identityFile?: string  // local path; passed as one argv token, no shell involved
  remoteAgentDir?: string
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
/** Charset for every path interpolated into a REMOTE command string: single-quote-free,
 *  space-free, shell-inert (REQ-006). */
const SAFE_REMOTE_PATH = /^[A-Za-z0-9._/~-]+$/
const SAFE_VERSION = /^[0-9A-Za-z.-]+$/
const SAFE_NONCE = /^[A-Za-z0-9]+$/

const reject = (field: string, value: unknown, why: string): never => {
  throw new Error(
    `invalid ${field} (${JSON.stringify(value)}): ${why} — fix the ${field} on the named agent / seed before connecting`
  )
}

const checkHost = (host: string): void => {
  if (typeof host !== 'string' || host.length === 0) reject('host', host, 'must be a non-empty string')
  if (host.startsWith('-')) reject('host', host, 'must not start with "-" (ssh option injection)')
  if (/\s/.test(host) || CONTROL_CHARS.test(host)) reject('host', host, 'must not contain whitespace or control characters')
  if (host.includes('@')) reject('host', host, 'must not contain "@" (the destination is composed as user@host)')
}

const checkUser = (user: string): void => {
  if (typeof user !== 'string' || user.length === 0) reject('user', user, 'must be a non-empty string')
  if (user.startsWith('-')) reject('user', user, 'must not start with "-" (ssh option injection)')
  if (/\s/.test(user) || CONTROL_CHARS.test(user)) reject('user', user, 'must not contain whitespace or control characters')
  if (user.includes('@')) reject('user', user, 'must not contain "@" (the destination is composed as user@host)')
}

const checkIdentityFile = (identityFile: string): void => {
  if (identityFile.startsWith('-')) reject('identityFile', identityFile, 'must not start with "-" (ssh option injection)')
  if (CONTROL_CHARS.test(identityFile)) reject('identityFile', identityFile, 'must not contain control characters')
}

const checkRemotePath = (field: string, p: string): void => {
  if (typeof p !== 'string' || p.length === 0) reject(field, p, 'must be a non-empty remote path')
  if (!SAFE_REMOTE_PATH.test(p)) {
    reject(field, p, `must match ${String(SAFE_REMOTE_PATH)} (it is interpolated into a remote shell command)`)
  }
  // Defense-in-depth (FINDING-002): no traversal segments — the install root is the
  // configured user's own home, and nothing legitimate needs to climb out of it.
  if (p === '..' || p.startsWith('../') || p.includes('/../') || p.endsWith('/..')) {
    reject(field, p, 'must not contain ".." path segments')
  }
}

/** The argv AFTER the `ssh` program for the exec channel:
 *  `[-p PORT] [-i IDENTITY] user@host <remoteCommand>` (REQ-005).
 *  Never `-t` (stdout must stay 8-bit clean for frames) and never a BatchMode override —
 *  inheriting interactive auth (2FA / hardware keys) is the point of locked decision 1. */
export function buildSshExecArgv(seed: SshExecSeed, remoteCommand: string): string[] {
  checkHost(seed.host)
  checkUser(seed.user)
  if (seed.port !== undefined && seed.port !== 0 &&
      !(Number.isInteger(seed.port) && seed.port >= 1 && seed.port <= 65535)) {
    reject('port', seed.port, 'must be an integer in 1..65535 (or 0/absent for the default 22)')
  }
  if (seed.identityFile !== undefined && seed.identityFile.length > 0) checkIdentityFile(seed.identityFile)
  if (typeof remoteCommand !== 'string' || remoteCommand.length === 0) {
    reject('remoteCommand', remoteCommand, 'must be a non-empty command string')
  }

  const args: string[] = []
  if (seed.port && seed.port !== 22) args.push('-p', String(seed.port))
  if (seed.identityFile && seed.identityFile.length > 0) args.push('-i', seed.identityFile)
  args.push(`${seed.user}@${seed.host}`)
  args.push(remoteCommand)
  return args
}

/** `<dir>/termhalla-agent-<version>.cjs` — the version lives in the FILE NAME so an upload
 *  for version V can never overwrite the artifact a running version-W agent was launched
 *  from (REQ-008). */
export function remoteAgentInstallPath(dir: string | undefined, version: string): string {
  const base = dir ?? DEFAULT_REMOTE_AGENT_DIR
  checkRemotePath('remoteAgentDir', base)
  if (typeof version !== 'string' || version.length === 0 || !SAFE_VERSION.test(version)) {
    reject('version', version, `must be a non-empty string matching ${String(SAFE_VERSION)} (it enters a remote command string)`)
  }
  return `${base}/termhalla-agent-${version}.cjs`
}

/** The launch probe (REQ-009): absent → exit 127 with NOTHING on stdout; present → exec
 *  the agent under `node` with the explicit backend flag (the F16 agent CLI contract). */
export function buildAgentLaunchCommand(installPath: string, ptyBackend: 'node-pty' | 'fake'): string {
  checkRemotePath('installPath', installPath)
  if (ptyBackend !== 'node-pty' && ptyBackend !== 'fake') {
    reject('ptyBackend', ptyBackend, 'must be "node-pty" or "fake" (the F16 agent --pty contract)')
  }
  return `test -f ${installPath} && exec node ${installPath} --pty=${ptyBackend} || exit ${LAUNCH_ABSENT_EXIT}`
}

/** The upload (REQ-012): stream stdin to a nonce-suffixed temp file IN the install dir,
 *  verify the byte count, and only then atomically `mv` onto the final path. On any
 *  failure in that chain the temp file is removed and the sentinel 93 is returned — the
 *  final path is never occupied by a partial artifact (CONV-014/CONV-003). */
export function buildAgentUploadCommand(installPath: string, byteCount: number, nonce: string): string {
  checkRemotePath('installPath', installPath)
  if (!Number.isInteger(byteCount) || byteCount <= 0) {
    reject('byteCount', byteCount, 'must be a positive integer — the enforced upload size check (CONV-003)')
  }
  if (typeof nonce !== 'string' || nonce.length === 0 || !SAFE_NONCE.test(nonce)) {
    reject('nonce', nonce, `must be a non-empty string matching ${String(SAFE_NONCE)} (it enters a remote command string)`)
  }
  const slash = installPath.lastIndexOf('/')
  if (slash <= 0) reject('installPath', installPath, 'must contain its install directory (a "/" before the file name)')
  const dir = installPath.slice(0, slash)
  const tmp = `${installPath}.${nonce}.tmp`
  return (
    `mkdir -p ${dir} && cat > ${tmp} && [ "$(wc -c < ${tmp})" -eq ${byteCount} ] && ` +
    `mv ${tmp} ${installPath} || { rm -f ${tmp}; exit ${UPLOAD_SIZE_MISMATCH_EXIT}; }`
  )
}
