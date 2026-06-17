import { execFile } from 'node:child_process'

const GIT_TIMEOUT_MS = 8000
const MAX_BUFFER = 4 * 1024 * 1024

/** Run a git subcommand. Resolves to stdout, or null on ANY failure (not installed, not a repo,
 *  timeout, abort, signal). Never rejects. The child is unref'd so a slow git can't keep the main
 *  process alive and stall app shutdown; `signal` aborts an in-flight call on stop(). */
function runGit(args: string[], signal?: AbortSignal): Promise<string | null> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(null); return }
    const child = execFile(
      'git', args,
      { timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_BUFFER, killSignal: 'SIGKILL', signal },
      (err, stdout) => resolve(err ? null : (stdout ?? ''))
    )
    child.unref()
  })
}

/** Repo root for a cwd (git normalizes to forward slashes), or null if cwd is not in a repo. */
export function resolveGitRoot(cwd: string, signal?: AbortSignal): Promise<string | null> {
  return runGit(['-C', cwd, 'rev-parse', '--show-toplevel'], signal)
    .then(out => { const t = out?.trim(); return t ? t : null })
}

/** Raw `git status --porcelain=v2 --branch` stdout for a root, or null on error. */
export function runGitStatus(root: string, signal?: AbortSignal): Promise<string | null> {
  return runGit(['-C', root, 'status', '--porcelain=v2', '--branch'], signal)
}
