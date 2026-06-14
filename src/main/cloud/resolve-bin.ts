import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

type Env = Record<string, string | undefined>

/** Find `bin` on PATH (trying PATHEXT extensions). Returns the full path, or null if absent.
 *  Used to distinguish "CLI not installed" from "logged out" before spawning. */
export function resolveBin(
  bin: string,
  env: Env = process.env,
  exists: (p: string) => boolean = existsSync
): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)   // Path: some Windows setups surface it lowercase
  const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const dir of dirs) {
    const bare = join(dir, bin)
    if (exists(bare)) return bare
    for (const ext of exts) {
      const cand = join(dir, bin + ext)
      if (exists(cand)) return cand
    }
  }
  return null
}
