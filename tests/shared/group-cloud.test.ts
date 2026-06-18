import { describe, it, expect } from 'vitest'
import { groupCloudStatuses } from '../../src/shared/group-cloud'
import type { CloudStatus } from '../../src/shared/types'

const m = (over: Partial<CloudStatus>): CloudStatus =>
  ({ id: 'x', label: 'AWS', family: 'aws', state: 'logged-out', checkedAt: 0, ...over })

describe('groupCloudStatuses', () => {
  it('groups by family, AWS members in order, Azure single', () => {
    const groups = groupCloudStatuses([
      m({ id: 'aws:default', profile: 'default', state: 'logged-in' }),
      m({ id: 'aws:bedrock', profile: 'bedrock', state: 'logged-out' }),
      m({ id: 'azure', family: 'azure', label: 'Azure', state: 'logged-in' })
    ])
    const aws = groups.find(g => g.family === 'aws')!
    expect(aws.members.map(x => x.profile)).toEqual(['default', 'bedrock'])
    expect(aws.loggedIn).toBe(1); expect(aws.total).toBe(2)
    expect(aws.summary).toBe('logged-in')         // any logged-in
    expect(groups.find(g => g.family === 'azure')!.total).toBe(1)
  })
  it('summary precedence', () => {
    const g = (states: CloudStatus['state'][]) =>
      groupCloudStatuses(states.map((s, i) => m({ id: `aws:${i}`, profile: String(i), state: s })))[0].summary
    expect(g(['not-installed', 'not-installed'])).toBe('not-installed')
    expect(g(['checking', 'checking'])).toBe('checking')
    expect(g(['logged-out', 'logged-in'])).toBe('logged-in')
    expect(g(['logged-out', 'error'])).toBe('logged-out')
    expect(g(['error', 'error'])).toBe('error')
  })
})
