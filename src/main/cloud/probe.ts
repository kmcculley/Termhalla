import { execFile } from 'node:child_process'
import type { CloudProvider } from './providers'
import { resolveBin } from './resolve-bin'
import type { ProbeResult } from './classify'

/** Run a provider's identity command. Resolves to a ProbeResult; never rejects.
 *  - resolveBin reports not-installed (ENOENT) without spawning.
 *  - shell:true so Windows .cmd shims (e.g. az.cmd) execute.
 *  - A numeric non-zero exit is a real "logged-out"; any other failure (timeout, abort,
 *    signal, spawn error) is reported as an errorCode so classifyProbe maps it to 'error'.
 *  - `signal` lets the caller abort an in-flight probe (e.g. on window close) so a slow
 *    CLI (az's Python start) can't keep the main process alive and stall app shutdown.
 *  - The child is unref'd so a still-running probe never blocks the event loop on exit. */
export function runCliProbe(provider: CloudProvider, signal?: AbortSignal, timeoutMs = 8000): Promise<ProbeResult> {
  return new Promise(resolve => {
    if (signal?.aborted || !resolveBin(provider.bin)) {
      resolve({ errorCode: signal?.aborted ? 'ABORT_ERR' : 'ENOENT', code: null, stdout: '' })
      return
    }
    const child = execFile(
      provider.bin, provider.probeArgs,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, shell: true, killSignal: 'SIGKILL', signal },
      (err, stdout) => {
        if (!err) { resolve({ code: 0, stdout: stdout ?? '' }); return }
        const e = err as NodeJS.ErrnoException & { code?: string | number }
        if (typeof e.code === 'number') { resolve({ code: e.code, stdout: stdout ?? '' }); return }  // real non-zero exit -> logged-out
        resolve({ errorCode: typeof e.code === 'string' ? e.code : 'ESPAWN', code: null, stdout: stdout ?? '' })  // abort/timeout/signal -> error
      }
    )
    child.unref()
  })
}
