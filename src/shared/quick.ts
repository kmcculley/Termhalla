import type { SshConnection } from './types'

/** Build the argv after the `ssh` program: `[-p PORT] [-i IDENTITY] user@host`. */
export function buildSshArgs(c: SshConnection): string[] {
  const args: string[] = []
  if (c.port && c.port !== 22) args.push('-p', String(c.port))
  if (c.identityFile && c.identityFile.length > 0) args.push('-i', c.identityFile)
  args.push(`${c.user}@${c.host}`)
  return args
}

/** MRU: move/insert `value` at the front, de-dupe (strict equality), cap length. */
export function pushRecent<T>(list: T[], value: T, cap: number): T[] {
  return [value, ...list.filter(v => v !== value)].slice(0, cap)
}

export const RECENT_DIR_CAP = 20

const normDir = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()

/** MRU for directories: skip empty + the home dir, de-dupe case/trailing-slash-insensitively. */
export function nextRecentDirs(
  recent: string[], dir: string, home: string, cap: number = RECENT_DIR_CAP
): string[] {
  if (!dir) return recent
  if (home && normDir(dir) === normDir(home)) return recent
  const filtered = recent.filter(d => normDir(d) !== normDir(dir))
  return [dir, ...filtered].slice(0, cap)
}
