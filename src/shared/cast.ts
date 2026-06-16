/** asciinema cast v2 header line. */
export function castHeader(cols: number, rows: number, timestampSec: number): string {
  return JSON.stringify({ version: 2, width: cols, height: rows, timestamp: timestampSec })
}
/** asciinema cast v2 event line: [elapsedSec, 'o'|'r', data]. */
export function castEvent(elapsedSec: number, code: 'o' | 'r', data: string): string {
  return JSON.stringify([elapsedSec, code, data])
}
