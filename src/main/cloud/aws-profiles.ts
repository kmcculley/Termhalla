import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const AWS_PROFILE_CAP = 8

/** Profile names from ~/.aws/config text. `[default]` -> "default"; `[profile X]` -> "X". Ignores
 *  `[sso-session X]`, `[services X]`, comments, blanks. Deduped, first-seen order. Pure. */
export function parseAwsProfiles(configText: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of configText.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('[') || !line.endsWith(']')) continue
    const inner = line.slice(1, -1).trim()
    let name: string | null = null
    if (inner === 'default') name = 'default'
    else if (inner.startsWith('profile ')) name = inner.slice('profile '.length).trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** Read + parse ~/.aws/config (honoring AWS_CONFIG_FILE), capped at AWS_PROFILE_CAP. Falls back to
 *  ['default'] when the file is missing/unreadable or has no profiles, so env-credential users still
 *  get an AWS probe. Logs a warning (not silent) when profiles are dropped by the cap. */
export function discoverAwsProfiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const path = env.AWS_CONFIG_FILE && env.AWS_CONFIG_FILE.length
    ? env.AWS_CONFIG_FILE
    : join(homedir(), '.aws', 'config')
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch { return ['default'] }
  const all = parseAwsProfiles(text)
  if (all.length === 0) return ['default']
  if (all.length > AWS_PROFILE_CAP) {
    console.warn(`[cloud] ${all.length - AWS_PROFILE_CAP} AWS profile(s) beyond the cap of ${AWS_PROFILE_CAP} are not shown`)
  }
  return all.slice(0, AWS_PROFILE_CAP)
}
