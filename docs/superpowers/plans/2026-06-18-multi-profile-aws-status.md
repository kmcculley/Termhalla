# Multi-profile AWS Cloud Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Probe every configured AWS profile (auto-discovered from `~/.aws/config`) and surface each one's login state under a single grouped AWS chip + per-profile popover. Azure unchanged.

**Architecture:** The cloud provider list becomes resolved-per-refresh: Azure + one probe per discovered AWS profile (`--profile X`). `CloudStatus` gains `family`/`profile`; a pure `groupCloudStatuses` collapses the flat array into per-family groups the `StatusBar` renders.

**Tech Stack:** Electron main, TypeScript, React, zustand, vitest, Playwright.

## Global Constraints

- **Path alias:** `@shared/...`.
- **TDD:** failing test first for pure logic (`aws-profiles`, `group-cloud`, `parseAwsIdentity`); service change covered by updating its existing vitest; StatusBar by the e2e.
- **`noUnusedLocals`/`noUnusedParameters` = true.**
- **Reuse** the existing abortable/unref'd `runCliProbe`, the `CloudStatusService` poll/dedup/stale-while-revalidate machinery, and the `launchCommand` login path. Don't reinvent them.
- **`CloudProvider.parse(stdout)` signature stays `(stdout) => CloudIdentity`** — the AWS profile is baked into the per-profile provider's `parse` closure, so `classifyProbe` is unchanged in shape.
- **Cap** discovered profiles at `AWS_PROFILE_CAP = 8`; `console.warn` in main if exceeded (no silent truncation, no UI footer).
- **Preserve testids** `cloud-aws` / `cloud-azure` (group chips), `cloud-menu-<family>`, `cloud-refresh-<family>`; add `cloud-profile-<profile>` rows and `cloud-login-<id>` per-row login.

---

## Task 1: `aws-profiles.ts` (discover profiles)

**Files:**
- Create: `src/main/cloud/aws-profiles.ts`
- Test: `tests/main/aws-profiles.test.ts`

**Interfaces:**
- Produces: `AWS_PROFILE_CAP` (8); `parseAwsProfiles(configText: string): string[]` (pure); `discoverAwsProfiles(env?): string[]` (reads `~/.aws/config`).

- [ ] **Step 1: Write the failing test**

Create `tests/main/aws-profiles.test.ts`:
```ts
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
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run tests/main/aws-profiles.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/main/cloud/aws-profiles.ts`:
```ts
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
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run tests/main/aws-profiles.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cloud/aws-profiles.ts tests/main/aws-profiles.test.ts
git commit -m "feat(cloud): discover AWS profiles from ~/.aws/config"
```

---

## Task 2: per-profile providers + CloudStatus family/profile

**Files:**
- Modify: `src/shared/types.ts` (`CloudStatus` += `family?`, `profile?`)
- Modify: `src/main/cloud/providers.ts` (CloudProvider += `family`/`profile`; `parseAwsIdentity(stdout, profile, env)`; `awsProbeForProfile`; `resolveProviders`; azure `family`; drop `awsProvider`/`DEFAULT_PROVIDERS`)
- Modify: `src/main/cloud/classify.ts` (copy `family`/`profile` into the status)
- Test: update `tests/main/cloud-core.test.ts`

**Interfaces:**
- Consumes: `discoverAwsProfiles` (Task 1).
- Produces: `awsProbeForProfile(profile): CloudProvider`; `resolveProviders(discover?): CloudProvider[]`; `parseAwsIdentity(stdout, profile, env?)`.

- [ ] **Step 1: Types**

In `src/shared/types.ts`, add to `CloudStatus`:
```ts
  family?: string                     // provider family: 'aws' | 'azure'
  profile?: string                    // AWS profile name (aws members only)
```

- [ ] **Step 2: providers.ts**

Replace the AWS pieces. Add `family` (and optional `profile`) to the `CloudProvider` interface:
```ts
export interface CloudProvider {
  id: string
  label: string
  bin: string
  family: string
  profile?: string
  probeArgs: string[]
  parse(stdout: string): CloudIdentity
  login: TerminalLaunch
}
```

Change `parseAwsIdentity` to take the profile explicitly (region still from env):
```ts
export function parseAwsIdentity(stdout: string, profile: string, env: Env = process.env): CloudIdentity {
  const j = JSON.parse(stdout) as { Account?: string; Arn?: string; UserId?: string }
  const account = j.Account ?? ''
  if (!account) throw new Error('aws: no Account in get-caller-identity output')
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? ''
  const detail: Record<string, string> = { Account: account, Profile: profile }
  if (j.Arn) detail.Arn = j.Arn
  if (region) detail.Region = region
  return { account, detail }
}
```

Replace `awsProvider`/`DEFAULT_PROVIDERS` with the factory + resolver (keep `parseAzureIdentity`; give `azureProvider` a family):
```ts
import { discoverAwsProfiles } from './aws-profiles'

/** A probe for one AWS profile: `--profile X`, profile-stamped parse, per-profile sso login. */
export function awsProbeForProfile(profile: string): CloudProvider {
  return {
    id: `aws:${profile}`, label: 'AWS', bin: 'aws', family: 'aws', profile,
    probeArgs: ['sts', 'get-caller-identity', '--profile', profile, '--output', 'json'],
    parse: (stdout) => parseAwsIdentity(stdout, profile),
    login: { command: 'aws', args: ['sso', 'login', '--profile', profile], title: `aws sso login --profile ${profile}` }
  }
}

export const azureProvider: CloudProvider = {
  id: 'azure', label: 'Azure', bin: 'az', family: 'azure',
  probeArgs: ['account', 'show', '--output', 'json'],
  parse: parseAzureIdentity,
  login: { command: 'az', args: ['login'], title: 'az login' }
}

/** The providers to probe this cycle: every discovered AWS profile (first), then Azure. */
export function resolveProviders(discover: () => string[] = discoverAwsProfiles): CloudProvider[] {
  return [...discover().map(awsProbeForProfile), azureProvider]
}
```
(Delete the old `awsProvider` const and `DEFAULT_PROVIDERS` export.)

- [ ] **Step 3: classify.ts**

In `classifyProbe`, carry family/profile from the provider:
```ts
  const base = { id: provider.id, label: provider.label, family: provider.family, profile: provider.profile, checkedAt: now, login: provider.login }
```
(rest of the function unchanged.)

- [ ] **Step 4: Update `tests/main/cloud-core.test.ts`**

- Change the import: `awsProvider` → `awsProbeForProfile` (keep `azureProvider`).
- `parseAwsIdentity` tests now pass the profile arg:
  - `parseAwsIdentity(out, {})` → `parseAwsIdentity(out, 'default', {})`; expect `Profile: 'default'`.
  - The env-profile test becomes a profile-arg test:
    ```ts
    it('stamps the given profile and reads region from env', () => {
      const out = JSON.stringify({ Account: '1', Arn: 'a' })
      const id = parseAwsIdentity(out, 'prod', { AWS_REGION: 'us-east-1' })
      expect(id.detail).toMatchObject({ Profile: 'prod', Region: 'us-east-1' })
    })
    ```
  - throw tests: `parseAwsIdentity('{}', 'default', {})` and `parseAwsIdentity('not json', 'default', {})`.
- `classifyProbe` tests: replace `awsProvider` with `awsProbeForProfile('default')`; update the not-installed assertion to the new id/family:
  ```ts
  const aws = awsProbeForProfile('default')
  const s = classifyProbe(aws, { errorCode: 'ENOENT', code: null, stdout: '' }, now)
  expect(s).toMatchObject({ id: 'aws:default', family: 'aws', state: 'not-installed', checkedAt: now })
  expect(s.login).toEqual(aws.login)
  ```
  (logged-out/logged-in/error cases: swap `awsProvider` → `aws`.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/main/cloud-core.test.ts` → PASS.
Run: `npm run typecheck` → clean (note: `cloud-status-service.ts` still imports `DEFAULT_PROVIDERS` — it's updated in Task 3; if you typecheck before Task 3 it will error, so do Task 3 before the typecheck gate, or temporarily expect that one error).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/cloud/providers.ts src/main/cloud/classify.ts tests/main/cloud-core.test.ts
git commit -m "feat(cloud): per-AWS-profile providers + CloudStatus family/profile"
```

---

## Task 3: resolve providers per refresh in `CloudStatusService`

**Files:**
- Modify: `src/main/cloud/cloud-status-service.ts`
- Test: update `tests/main/cloud-status-service.test.ts`

**Interfaces:**
- Consumes: `resolveProviders` (Task 2).
- Produces: `CloudStatusService(onStatus, resolveProviders?, runProbe?, now?, intervalMs?)`.

- [ ] **Step 1: Service change**

In `src/main/cloud/cloud-status-service.ts`:

Replace the `DEFAULT_PROVIDERS` import with an aliased resolver:
```ts
import { resolveProviders as defaultResolveProviders } from './providers'
```

Change the 2nd constructor param from a fixed array to a resolver, and add a `current` field:
```ts
  private current: CloudProvider[] = []

  constructor(
    private readonly onStatus: (statuses: CloudStatus[]) => void,
    private readonly resolveProviders: () => CloudProvider[] = defaultResolveProviders,
    private readonly runProbe: RunProbe = runCliProbe,
    private readonly now: () => number = () => Date.now(),
    private readonly intervalMs = 60000
  ) {}
```

In `refresh()`, resolve the list once at the top and use it everywhere `this.providers` was used:
```ts
  async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      this.current = this.resolveProviders()
      let showedChecking = false
      for (const p of this.current) {
        if (!this.last.has(p.id)) {
          this.last.set(p.id, { id: p.id, label: p.label, family: p.family, profile: p.profile, state: 'checking', checkedAt: this.now(), login: p.login })
          showedChecking = true
        }
      }
      if (showedChecking) this.emit()

      await Promise.all(this.current.map(async p => {
        const result = await this.runProbe(p, this.abort.signal)
        const fresh = classifyProbe(p, result, this.now())
        const prior = this.last.get(p.id)
        const keepStale = fresh.state === 'error' && prior && prior.state !== 'error' && prior.state !== 'checking'
        this.last.set(p.id, keepStale ? prior! : fresh)
      }))
      this.emit()
    } finally {
      this.refreshing = false
    }
  }
```

In `emit()`, iterate `this.current` instead of `this.providers`:
```ts
  private emit(): void {
    const statuses = this.current.map(p => this.last.get(p.id)).filter((s): s is CloudStatus => Boolean(s))
    const sig = statuses.map(s =>
      `${s.id}:${s.state}:${s.account ?? ''}:${s.detail ? Object.entries(s.detail).map(([k, v]) => `${k}=${v}`).join(',') : ''}`
    ).join('|')
    if (sig === this.lastSig) return
    this.lastSig = sig
    this.onStatus(statuses)
  }
```
(The `checking` seed now includes `family`/`profile` so a still-checking member groups correctly.)

- [ ] **Step 2: Update `tests/main/cloud-status-service.test.ts`**

- Import: `awsProvider` → `awsProbeForProfile`; `const provs = [awsProvider]` → `const provs = [awsProbeForProfile('default')]`.
- Every `new CloudStatusService(emit, provs, ...)` → `new CloudStatusService(emit, () => provs, ...)` (all 5 call sites; the resolver is now a function).

- [ ] **Step 3: Run tests + typecheck + build**

Run: `npx vitest run tests/main/cloud-status-service.test.ts tests/main/cloud-core.test.ts` → PASS.
Run: `npm run typecheck` → clean. Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/main/cloud/cloud-status-service.ts tests/main/cloud-status-service.test.ts
git commit -m "feat(cloud): resolve providers per refresh (dynamic AWS profiles)"
```

---

## Task 4: `group-cloud.ts` (pure grouping)

**Files:**
- Create: `src/shared/group-cloud.ts`
- Test: `tests/shared/group-cloud.test.ts`

**Interfaces:**
- Consumes: `CloudStatus`, `CloudState` (`@shared/types`).
- Produces: `CloudGroup`; `groupCloudStatuses(statuses): CloudGroup[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/group-cloud.test.ts`:
```ts
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
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run tests/shared/group-cloud.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `src/shared/group-cloud.ts`:
```ts
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
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run tests/shared/group-cloud.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/group-cloud.ts tests/shared/group-cloud.test.ts
git commit -m "feat(cloud): pure groupCloudStatuses (per-family summary)"
```

---

## Task 5: StatusBar grouped rendering

**Files:**
- Modify: `src/renderer/components/StatusBar.tsx`

**Interfaces:**
- Consumes: `groupCloudStatuses` (Task 4); `store.cloud`; `launchCommand`/`refreshCloud`.

- [ ] **Step 1: Render groups**

In `src/renderer/components/StatusBar.tsx`, replace the per-status `cloud.map(...)` rendering with per-group rendering. Read groups via the pure helper and render one chip per group, the popover listing each member with a per-member login.

Add the import:
```ts
import { groupCloudStatuses } from '@shared/group-cloud'
```

Replace the `cloud.map(c => …)` block with (preserving the existing `GLYPH`/`COLOR`/`accountLabel` helpers and the `openFor` popover-toggle state, now keyed by family):
```tsx
      {cloud.length === 0 && <span style={{ opacity: 'var(--dimmer)' }}>cloud status…</span>}
      {groupCloudStatuses(cloud).map(g => (
        <div key={g.family} style={{ position: 'relative' }}>
          <button data-testid={`cloud-${g.family}`} type="button" title={`${g.label}: ${g.summary}`}
            onClick={() => setOpenFor(openFor === g.family ? null : g.family)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit',
              color: COLOR[g.summary], padding: 0, whiteSpace: 'nowrap' }}>
            {GLYPH[g.summary]} {g.label}{g.total > 1 ? ` ${g.loggedIn}/${g.total}` : ''}
          </button>
          {openFor === g.family && (
            <div data-testid={`cloud-menu-${g.family}`} onClick={e => e.stopPropagation()}
              style={{ ...SURFACE, position: 'absolute', bottom: 24, left: 0, zIndex: Z.menu, padding: 8, minWidth: 260,
                display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--mono)' }}>
              {g.members.map(c => (
                <div key={c.id} data-testid={`cloud-profile-${c.profile ?? c.family}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid var(--border, #444)', paddingTop: 4 }}>
                  <div style={{ color: COLOR[c.state], whiteSpace: 'nowrap' }}>
                    {GLYPH[c.state]} {c.profile ?? c.label}{accountLabel(c)}
                  </div>
                  {c.detail && Object.entries(c.detail).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap', color: 'var(--fg-dim, #aaa)' }}>
                      <span style={{ minWidth: 80 }}>{k}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
                    </div>
                  ))}
                  {c.state !== 'not-installed' && c.login && (c.state === 'logged-out' || c.state === 'error') && (
                    <button data-testid={`cloud-login-${c.id}`} type="button"
                      onClick={() => { const l = c.login!; launchCommand(l); setOpenFor(null) }}>Log in</button>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button data-testid={`cloud-refresh-${g.family}`} type="button" onClick={() => refreshCloud()}>Refresh</button>
              </div>
            </div>
          )}
        </div>
      ))}
```
(Keep the trailing `tipText` block and the `flex: 1` spacer; remove only the old per-status map. `GLYPH`/`COLOR` are indexed by `CloudState`, which both `g.summary` and `c.state` are.)

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck` → clean. Run: `npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/StatusBar.tsx
git commit -m "feat(cloud): grouped AWS chip + per-profile popover in StatusBar"
```

---

## Task 6: e2e update

**Files:**
- Modify: `tests/e2e/cloud.spec.ts`

- [ ] **Step 1: Build**

Run: `npm run build` → success.

- [ ] **Step 2: Update the spec**

In `tests/e2e/cloud.spec.ts`, keep it credential-agnostic; assert the grouped AWS chip + at least one profile row (the `['default']` fallback guarantees one even on a runner with no `~/.aws/config`). Replace the body's assertions with:
```ts
  await expect(win.getByTestId('status-bar')).toBeVisible({ timeout: 15_000 })
  await expect(win.getByTestId('cloud-aws')).toBeVisible({ timeout: 20_000 })
  await expect(win.getByTestId('cloud-azure')).toBeVisible({ timeout: 20_000 })

  // AWS popover lists at least one profile row + a Refresh.
  await win.getByTestId('cloud-aws').click()
  await expect(win.getByTestId('cloud-menu-aws')).toBeVisible()
  await expect(win.locator('[data-testid^="cloud-profile-"]')).not.toHaveCount(0)
  await expect(win.getByTestId('cloud-refresh-aws')).toBeVisible()
  await win.getByTestId('cloud-refresh-aws').click()
  await expect(win.getByTestId('cloud-menu-aws')).toBeVisible()

  // If any profile offers Log in (installed-but-logged-out), it opens a terminal pane.
  const login = win.locator('[data-testid^="cloud-login-aws:"]').first()
  if (await login.count()) {
    await login.click()
    await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  }
```
(Leave the launch/`killTree` boilerplate unchanged.)

- [ ] **Step 3: Run the e2e**

Run: `npm run e2e -- cloud`
Expected: PASS (chips render in whatever state; ≥1 AWS profile row present).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/cloud.spec.ts
git commit -m "test(cloud): e2e for grouped AWS chip + per-profile rows"
```

---

## Task 7: Docs

**Files:**
- Modify: `docs/features/cloud-status.md`, `CHANGELOG.md`

- [ ] **Step 1: Feature doc**

Update `docs/features/cloud-status.md`: AWS is now multi-profile — profiles auto-discovered from `~/.aws/config` (`[default]`/`[profile X]`, capped at 8, `['default']` fallback), one probe per profile (`--profile X`), grouped under one chip with a per-profile popover + per-profile `aws sso login --profile X`; providers resolved per refresh; Azure unchanged. Note the `family`/`profile` additions to `CloudStatus` and the pure `group-cloud` helper.

- [ ] **Step 2: Changelog**

Add a CHANGELOG entry under the current/unreleased section.

- [ ] **Step 3: Commit**

```bash
git add docs/features/cloud-status.md CHANGELOG.md
git commit -m "docs(cloud): document multi-profile AWS status"
```

---

## Self-Review

**Spec coverage:**
- Auto-discover from `~/.aws/config` (cap 8, default fallback, ignore sso-session/services) → Task 1. ✓
- Per-profile probe `--profile X` + per-profile `aws sso login --profile X` → Task 2 (`awsProbeForProfile`). ✓
- Providers resolved per refresh (dynamic add/remove) → Task 3. ✓
- `CloudStatus` family/profile → Task 2; classify carries them → Task 2. ✓
- Grouped chip + per-profile popover, summary precedence, `N/M` count → Task 4 (pure) + Task 5 (render). ✓
- Preserved testids + new `cloud-profile-*`/`cloud-login-<id>` → Task 5; e2e → Task 6. ✓
- `> 8` warns in main (no silent truncation) → Task 1. ✓
- Azure unchanged → azureProvider kept, single-member group renders as before. ✓
- Tests: unit (aws-profiles, group-cloud, providers/classify) + e2e → Tasks 1,2,4,6. ✓

**Placeholder scan:** none — all steps carry concrete code or exact edits.

**Type consistency:** `CloudProvider` gains `family`/`profile`; `awsProbeForProfile` sets them; `classifyProbe`'s `base` copies them into `CloudStatus` (which declares them). `resolveProviders: () => CloudProvider[]` matches the service's 2nd param (aliased import avoids the param/import name clash). `CloudGroup` fields used in StatusBar (`family`/`label`/`members`/`summary`/`loggedIn`/`total`) match `group-cloud.ts`. `GLYPH`/`COLOR` are keyed by `CloudState`, which both `summary` and member `state` are. Test ids (`cloud-<family>`/`cloud-menu-<family>`/`cloud-refresh-<family>`/`cloud-profile-<profile>`/`cloud-login-<id>`) match between Task 5 and Task 6.

**Cross-task ordering note:** Task 2 removes `DEFAULT_PROVIDERS`, which Task 3 stops importing — typecheck is only fully green after Task 3, so run the typecheck/build gate at Task 3 (Task 2's own gate is its unit test). The plan's Task 2 step 5 notes this.
