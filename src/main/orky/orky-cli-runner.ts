import { execFile } from 'node:child_process'
import { DEFAULT_CLI_TIMEOUT_MS } from '@shared/orky-action-result'

export { DEFAULT_CLI_TIMEOUT_MS }

/**
 * The abortable/`unref()`'d `execFile` wrapper for invoking Orky's CLIs (feature 0007, TASK-004;
 * REQ-010/REQ-011). Mirrors `src/main/cloud/probe.ts`'s `runCliProbe`: argument ARRAY only (no shell
 * option enabled at all, no string concatenation — no shell-injection surface), `child.unref()`
 * immediately after spawn so a still-running child never blocks the event loop on exit, and an
 * `AbortSignal` so an in-flight child can be aborted on service `dispose()` / owning-window close.
 *
 * NEVER rejects — always resolves, even on timeout/abort/spawn error, so a hung CLI can neither wedge
 * the IPC round-trip nor keep the main process alive at shutdown.
 *
 * Error CLASSIFICATION (REQ-014/FINDING-009): `timedOut:true` is RESERVED for the genuine elapsed-time
 * class — the execFile timeout kill (`killed:true, signal:'SIGTERM'`) and an AbortSignal abort
 * (`AbortError`, `code:'ABORT_ERR'`) — where the child DID run and its write may or may not have
 * completed (the honest INDETERMINATE that maps to `cli-timeout`). A SPAWN-class failure is different
 * in kind: the child NEVER executed (ENAMETOOLONG/E2BIG/EINVAL — an oversized command line is exactly
 * what F12's uncapped `--json` item can trigger), so NOTHING can have been written and the verdict is
 * DEFINITE. Such a failure is delivered two ways: thrown SYNCHRONOUSLY from `execFile` (Windows
 * ENAMETOOLONG) or via the callback (Linux E2BIG); BOTH resolve `timedOut:false` so the byte-unchanged
 * `mapCliRunToResult` surfaces them as a definite `cli-error`/`cli-unparseable`, never the indeterminate
 * `cli-timeout`. The sync path is wrapped so the never-rejects contract holds for the spawn class too.
 * The spawn signal is `err.syscall` referencing 'spawn' — abort carries a STRING `code` ('ABORT_ERR')
 * too but has no spawn syscall, so it stays in the elapsed-time class.
 */
function isSpawnFailure(e: NodeJS.ErrnoException): boolean {
  return typeof e.syscall === 'string' && e.syscall.startsWith('spawn')
}

export function runOrkyCli(
  cliPath: string,
  args: string[],
  opts?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<{ exitCode: number | null; stdout: string; timedOut: boolean }> {
  const timeout = opts?.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
  return new Promise((resolve) => {
    try {
      const child = execFile(
        process.execPath,
        [cliPath, ...args],
        { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, signal: opts?.signal },
        (err, stdout) => {
          if (!err) { resolve({ exitCode: 0, stdout: stdout ?? '', timedOut: false }); return }
          const e = err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean; signal?: string | null }
          if (typeof e.code === 'number') {
            resolve({ exitCode: e.code, stdout: stdout ?? '', timedOut: false }) // thrown-CLI nonzero exit
            return
          }
          if (isSpawnFailure(e)) {
            // The child never ran (spawn-class errno): a DEFINITE non-execution, never the
            // indeterminate timeout (REQ-014).
            resolve({ exitCode: null, stdout: '', timedOut: false })
            return
          }
          // genuine elapsed-time class (timeout kill / abort): never hang, never reject.
          resolve({ exitCode: null, stdout: '', timedOut: true })
        }
      )
      child.unref()
    } catch {
      // execFile threw SYNCHRONOUSLY — the Windows oversized-command-line spawn class. The child
      // never ran, so honor the never-rejects contract AND classify it as a DEFINITE failure
      // (timedOut:false), never the indeterminate timeout (REQ-014).
      resolve({ exitCode: null, stdout: '', timedOut: false })
    }
  })
}
