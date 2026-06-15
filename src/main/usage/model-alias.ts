import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The user's selected Claude model alias (e.g. `opus[1m]`), read from the first settings file
 *  that declares one: project `.claude/settings.local.json` → project `.claude/settings.json` →
 *  global `<claudeHome>/settings.json`. The alias carries the `[1m]` flag the transcript omits.
 *  Returns '' when none is found or all reads fail. */
export async function readModelAlias(cwd: string, claudeHome: string): Promise<string> {
  const candidates = [
    join(cwd, '.claude', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(claudeHome, 'settings.json')
  ]
  for (const p of candidates) {
    try {
      const j = JSON.parse(await readFile(p, 'utf8')) as { model?: unknown }
      if (typeof j.model === 'string' && j.model) return j.model
    } catch { /* missing or malformed — try the next candidate */ }
  }
  return ''
}
