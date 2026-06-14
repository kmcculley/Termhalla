import type { TerminalLaunch } from '@shared/types'

export interface CloudIdentity { account: string; detail: Record<string, string> }

export interface CloudProvider {
  id: string
  label: string
  bin: string
  probeArgs: string[]
  parse(stdout: string): CloudIdentity
  login: TerminalLaunch
}

type Env = Record<string, string | undefined>

/** `aws sts get-caller-identity` output -> account id + detail (profile/region from env). */
export function parseAwsIdentity(stdout: string, env: Env = process.env): CloudIdentity {
  const j = JSON.parse(stdout) as { Account?: string; Arn?: string; UserId?: string }
  const account = j.Account ?? ''
  if (!account) throw new Error('aws: no Account in get-caller-identity output')
  const profile = env.AWS_PROFILE ?? env.AWS_DEFAULT_PROFILE ?? 'default'
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? ''
  const detail: Record<string, string> = { Account: account, Profile: profile }
  if (j.Arn) detail.Arn = j.Arn
  if (region) detail.Region = region
  return { account, detail }
}

/** `az account show` output -> subscription name + detail. */
export function parseAzureIdentity(stdout: string): CloudIdentity {
  const j = JSON.parse(stdout) as { name?: string; id?: string; user?: { name?: string }; tenantId?: string; state?: string }
  const account = j.name ?? ''
  if (!account) throw new Error('azure: no subscription name in account show output')
  const detail: Record<string, string> = { Subscription: account }
  if (j.id) detail.SubscriptionId = j.id
  if (j.user?.name) detail.User = j.user.name
  if (j.tenantId) detail.Tenant = j.tenantId
  if (j.state) detail.State = j.state
  return { account, detail }
}

export const awsProvider: CloudProvider = {
  id: 'aws', label: 'AWS', bin: 'aws',
  probeArgs: ['sts', 'get-caller-identity', '--output', 'json'],
  parse: parseAwsIdentity,
  login: { command: 'aws', args: ['sso', 'login'], title: 'aws sso login' }
}

export const azureProvider: CloudProvider = {
  id: 'azure', label: 'Azure', bin: 'az',
  probeArgs: ['account', 'show', '--output', 'json'],
  parse: parseAzureIdentity,
  login: { command: 'az', args: ['login'], title: 'az login' }
}

export const DEFAULT_PROVIDERS: CloudProvider[] = [awsProvider, azureProvider]
