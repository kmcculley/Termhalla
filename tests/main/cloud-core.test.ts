import { describe, it, expect } from 'vitest'
import { parseAwsIdentity, parseAzureIdentity, awsProvider, azureProvider } from '../../src/main/cloud/providers'
import { resolveBin } from '../../src/main/cloud/resolve-bin'
import { classifyProbe } from '../../src/main/cloud/classify'

describe('parseAwsIdentity', () => {
  it('extracts account + detail, defaulting the profile when env is unset', () => {
    const out = JSON.stringify({ UserId: 'AIDA', Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/kev' })
    const id = parseAwsIdentity(out, {})
    expect(id.account).toBe('123456789012')
    expect(id.detail).toMatchObject({ Account: '123456789012', Profile: 'default', Arn: 'arn:aws:iam::123456789012:user/kev' })
  })
  it('uses AWS_PROFILE and AWS_REGION from env', () => {
    const out = JSON.stringify({ Account: '1', Arn: 'a' })
    const id = parseAwsIdentity(out, { AWS_PROFILE: 'prod', AWS_REGION: 'us-east-1' })
    expect(id.detail).toMatchObject({ Profile: 'prod', Region: 'us-east-1' })
  })
  it('throws when there is no Account', () => {
    expect(() => parseAwsIdentity('{}', {})).toThrow()
  })
  it('throws on malformed JSON', () => {
    expect(() => parseAwsIdentity('not json', {})).toThrow()
  })
})

describe('parseAzureIdentity', () => {
  it('extracts the subscription name + detail incl. nested user.name', () => {
    const out = JSON.stringify({ name: 'My Sub', id: 'sub-1', user: { name: 'kev@example.com' }, tenantId: 't-1', state: 'Enabled' })
    const id = parseAzureIdentity(out)
    expect(id.account).toBe('My Sub')
    expect(id.detail).toMatchObject({ Subscription: 'My Sub', SubscriptionId: 'sub-1', User: 'kev@example.com', Tenant: 't-1', State: 'Enabled' })
  })
  it('throws when there is no subscription name', () => {
    expect(() => parseAzureIdentity('{}')).toThrow()
  })
  it('throws on malformed JSON', () => {
    expect(() => parseAzureIdentity('not json')).toThrow()
  })
})

describe('resolveBin', () => {
  const env = { PATH: 'C:\\a;C:\\b', PATHEXT: '.EXE;.CMD' }
  it('finds a .CMD shim on PATH', () => {
    const exists = (p: string) => p === 'C:\\b\\az.CMD'
    expect(resolveBin('az', env, exists)).toBe('C:\\b\\az.CMD')
  })
  it('finds a bare/exact name', () => {
    const exists = (p: string) => p === 'C:\\a\\aws'
    expect(resolveBin('aws', env, exists)).toBe('C:\\a\\aws')
  })
  it('returns null when nothing matches', () => {
    expect(resolveBin('nope', env, () => false)).toBeNull()
  })
})

describe('classifyProbe', () => {
  const now = 1000
  it('maps ENOENT to not-installed', () => {
    const s = classifyProbe(awsProvider, { errorCode: 'ENOENT', code: null, stdout: '' }, now)
    expect(s).toMatchObject({ id: 'aws', label: 'AWS', state: 'not-installed', checkedAt: now })
    expect(s.login).toEqual(awsProvider.login)
  })
  it('maps a non-zero exit to logged-out', () => {
    expect(classifyProbe(awsProvider, { code: 255, stdout: '' }, now).state).toBe('logged-out')
  })
  it('maps a successful parse to logged-in', () => {
    const out = JSON.stringify({ Account: '1', Arn: 'a' })
    const s = classifyProbe(awsProvider, { code: 0, stdout: out }, now)
    expect(s.state).toBe('logged-in')
    expect(s.account).toBe('1')
  })
  it('maps a parse failure to error', () => {
    expect(classifyProbe(azureProvider, { code: 0, stdout: 'not json' }, now).state).toBe('error')
  })
  it('maps a non-ENOENT spawn error / timeout to error', () => {
    expect(classifyProbe(awsProvider, { errorCode: 'ETIMEDOUT', code: null, stdout: '' }, now).state).toBe('error')
  })
})
