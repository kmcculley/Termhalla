import { execFile } from 'node:child_process'
import type { CloudProvider } from './providers'
import { resolveBin } from './resolve-bin'
import type { ProbeResult } from './classify'

/** Run a provider's identity command. Resolves to a ProbeResult; never rejects.
 *  - resolveBin reports not-installed (ENOENT) without spawning.
 *  - shell:true so Windows .cmd shims (e.g. az.cmd) execute.
 *  - A numeric non-zero exit is a real "logged-out"; any other failure (timeout, signal,
 *    spawn error) is reported as an errorCode so classifyProbe maps it to 'error'. */
export function runCliProbe(provider: CloudProvider, timeoutMs = 8000): Promise<ProbeResult> {
  return new Promise(resolve => {
    if (!resolveBin(provider.bin)) {
      resolve({ errorCode: 'ENOENT', code: null, stdout: '' })
      return
    }
    // shell:true runs via cmd.exe; on a timeout SIGKILL terminates cmd.exe and the CLI
    // grandchild may linger briefly, but its output is discarded since we've already resolved.
    execFile(
      provider.bin, provider.probeArgs,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, shell: true, killSignal: 'SIGKILL' },
      (err, stdout) => {
        if (!err) { resolve({ code: 0, stdout: stdout ?? '' }); return }
        const e = err as NodeJS.ErrnoException & { code?: string | number }
        if (typeof e.code === 'number') { resolve({ code: e.code, stdout: stdout ?? '' }); return }  // real non-zero exit -> logged-out
        resolve({ errorCode: typeof e.code === 'string' ? e.code : 'ESPAWN', code: null, stdout: stdout ?? '' })  // ENOENT/timeout/signal -> not-installed/error
      }
    )
  })
}
