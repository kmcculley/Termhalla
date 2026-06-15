/** Encode an absolute path the way Claude Code names its project dir: every
 *  non-alphanumeric character becomes '-'. e.g. C:\dev\Termhalla -> C--dev-Termhalla */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** The `.jsonl` entry with the greatest mtime (the active session), or null. */
export function pickNewestTranscript(entries: { name: string; mtimeMs: number }[]): string | null {
  let best: { name: string; mtimeMs: number } | null = null
  for (const e of entries) {
    if (!e.name.endsWith('.jsonl')) continue
    if (!best || e.mtimeMs > best.mtimeMs) best = e
  }
  return best ? best.name : null
}
