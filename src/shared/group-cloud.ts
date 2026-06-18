import type { CloudStatus, CloudState } from './types'

export interface CloudGroup {
  family: string
  label: string
  members: CloudStatus[]
  summary: CloudState
  loggedIn: number
  total: number
}

/** Aggregate one family's member states into the chip's summary state.
 *  Precedence: all not-installed -> not-installed; nothing resolved (only checking) -> checking;
 *  any logged-in -> logged-in; any logged-out -> logged-out; else error. */
function summarize(states: CloudState[]): CloudState {
  if (states.every(s => s === 'not-installed')) return 'not-installed'
  if (states.every(s => s === 'checking' || s === 'not-installed')) return 'checking'
  if (states.includes('logged-in')) return 'logged-in'
  if (states.includes('logged-out')) return 'logged-out'
  return 'error'
}

/** Collapse a flat CloudStatus[] into per-family groups, preserving first-seen family + member order. */
export function groupCloudStatuses(statuses: CloudStatus[]): CloudGroup[] {
  const order: string[] = []
  const byFamily = new Map<string, CloudStatus[]>()
  for (const s of statuses) {
    const fam = s.family ?? s.id
    if (!byFamily.has(fam)) { byFamily.set(fam, []); order.push(fam) }
    byFamily.get(fam)!.push(s)
  }
  return order.map(fam => {
    const members = byFamily.get(fam)!
    return {
      family: fam,
      label: members[0].label,
      members,
      summary: summarize(members.map(x => x.state)),
      loggedIn: members.filter(x => x.state === 'logged-in').length,
      total: members.length
    }
  })
}
