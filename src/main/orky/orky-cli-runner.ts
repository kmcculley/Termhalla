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
 */
export function runOrkyCli(
  cliPath: string,
  args: string[],
  opts?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<{ exitCode: number | null; stdout: string; timedOut: boolean }> {
  const timeout = opts?.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
  return new Promise((resolve) => {
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
        // timeout / abort / spawn failure: never hang, never reject.
        resolve({ exitCode: null, stdout: '', timedOut: true })
      }
    )
    child.unref()
  })
}
