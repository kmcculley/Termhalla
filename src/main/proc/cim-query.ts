import { execFile } from 'node:child_process'
import { parseCimRows, type CimRow } from './proc-tree'

const PS_CMD =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress'

/** One Windows process-table snapshot. Resolves to [] on any failure/timeout (never rejects). */
export function queryProcesses(timeoutMs = 2000): Promise<CimRow[]> {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_CMD],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        if (err) {
          // Degrade to empty (never reject) but log: a silent [] makes every busy pane's proc chip
          // blank with no clue whether it was a timeout, a permissions issue, or a real empty table.
          console.warn('[proc] process query failed:', err.message, (stderr ?? '').trim())
          resolve([])
          return
        }
        resolve(parseCimRows(stdout))
      }
    )
  })
}
