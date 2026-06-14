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
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(err ? [] : parseCimRows(stdout))
    )
  })
}
