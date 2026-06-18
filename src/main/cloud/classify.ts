import type { CloudStatus } from '@shared/types'
import type { CloudProvider } from './providers'

export interface ProbeResult {
  errorCode?: string      // a spawn-failure code like 'ENOENT' (CLI not found)
  code?: number | null    // process exit code (0 = success)
  stdout: string
}

/** Pure: map one probe outcome to a CloudStatus. Never throws. */
export function classifyProbe(provider: CloudProvider, r: ProbeResult, now: number): CloudStatus {
  const base = { id: provider.id, label: provider.label, family: provider.family, profile: provider.profile, checkedAt: now, login: provider.login }
  if (r.errorCode === 'ENOENT') return { ...base, state: 'not-installed' }
  if (r.errorCode) return { ...base, state: 'error' }   // other spawn failure / timeout
  if (r.code !== 0) return { ...base, state: 'logged-out' }
  try {
    const { account, detail } = provider.parse(r.stdout)
    return { ...base, state: 'logged-in', account, detail }
  } catch (e) {
    // A zero exit but unparseable output usually means the CLI changed its output format. Surface it
    // (low noise — only fires on malformed output) so the cause is diagnosable, not just an 'error' chip.
    console.warn('[cloud] failed to parse probe output for', provider.id, '-', (e as Error).message)
    return { ...base, state: 'error' }
  }
}
