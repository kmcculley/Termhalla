import { describe, it, expect } from 'vitest'
import { parseAwsProfiles, AWS_PROFILE_CAP } from '../../src/main/cloud/aws-profiles'

describe('parseAwsProfiles', () => {
  it('extracts default + profile sections, ignoring sso-session/services/comments', () => {
    const cfg = [
      '[default]', 'region = us-east-1', '',
      '# a comment', '[profile bedrock]', 'sso_session = x',
      '[profile AdministratorAccess-123]', '',
      '[sso-session compucg]', 'sso_start_url = https://x',
      '[services foo]'
    ].join('\n')
    expect(parseAwsProfiles(cfg)).toEqual(['default', 'bedrock', 'AdministratorAccess-123'])
  })
  it('dedupes and preserves first-seen order', () => {
    expect(parseAwsProfiles('[profile a]\n[profile a]\n[profile b]')).toEqual(['a', 'b'])
  })
  it('returns [] for config with no profile sections', () => {
    expect(parseAwsProfiles('[sso-session only]\nkey = v')).toEqual([])
  })
  it('exposes a sane cap', () => {
    expect(AWS_PROFILE_CAP).toBe(8)
  })
})
