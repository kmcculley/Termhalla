# Cloud CLI Status (AWS/Azure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global bottom status bar showing AWS and Azure CLI login status (account/profile), refreshed by periodic CLI probes, with manual refresh and a "Log in" action.

**Architecture:** A main-process `CloudStatusService` runs a list of pluggable providers (AWS, Azure); on a ~60s timer + manual refresh + debounced window focus it probes each provider's CLI identity command via `execFile`, classifies the result (logged-in / logged-out / not-installed / error) through pure helpers, and emits `CloudStatus[]` over a new `cloud:status` channel. The renderer holds it in the store and renders a bottom `StatusBar`; the "Log in" button reuses the sub-project B `launch` override to open a terminal running the login command.

**Tech Stack:** Electron + TypeScript (strict), electron-vite, React, zustand, `child_process.execFile`, vitest, @playwright/test (Electron). Path alias `@shared/*` → `src/shared/*`. Windows-only.

**Spec:** `docs/superpowers/specs/2026-06-14-termhalla-cloud-cli-status-design.md`

---

## File Structure

**New files:**
- `src/main/cloud/providers.ts` — `CloudProvider`/`CloudIdentity` types, pure `parseAwsIdentity`/`parseAzureIdentity`, `awsProvider`/`azureProvider`, `DEFAULT_PROVIDERS`.
- `src/main/cloud/resolve-bin.ts` — pure `resolveBin(bin, env?, exists?)` (PATH/PATHEXT lookup; detects not-installed).
- `src/main/cloud/classify.ts` — `ProbeResult`, pure `classifyProbe(provider, result, now)`.
- `src/main/cloud/probe.ts` — `runCliProbe` (`resolveBin` + `execFile` with `shell:true`; not unit-tested).
- `src/main/cloud/cloud-status-service.ts` — `CloudStatusService` (timer, refresh cycle, stale-while-revalidate, no-overlap).
- `src/renderer/components/StatusBar.tsx` — the bottom bar + per-provider popover.
- `tests/main/cloud-core.test.ts`, `tests/main/cloud-status-service.test.ts`, `tests/e2e/cloud.spec.ts`.

**Modified files:**
- `src/shared/types.ts` — `CloudState`, `CloudStatus`.
- `src/shared/ipc-contract.ts` — `cloud:status` / `cloud:refresh` channels + API methods.
- `src/preload/index.ts` — expose `onCloudStatus` / `cloudRefresh`.
- `src/main/ipc/register.ts` — construct + wire `CloudStatusService` (emit, refresh handler, focus, start/stop).
- `src/renderer/store.ts` — `cloud` state, `setCloud`, `refreshCloud`, `launchCommand`.
- `src/renderer/App.tsx` — subscribe to `cloud:status`; render `<StatusBar />`.

---

## Task 1: Pure cloud core (types, parsers, bin resolution, classify)

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/cloud/providers.ts`, `src/main/cloud/resolve-bin.ts`, `src/main/cloud/classify.ts`
- Test: `tests/main/cloud-core.test.ts`

- [ ] **Step 1: Add `CloudState` / `CloudStatus` to `src/shared/types.ts`**

Append after the `ProcInfo` interface (before `export const SCHEMA_VERSION = 3`):

```ts
export type CloudState = 'checking' | 'logged-in' | 'logged-out' | 'not-installed' | 'error'

/** Global login status for one cloud provider (AWS/Azure). Runtime-only, never persisted. */
export interface CloudStatus {
  id: string
  label: string
  state: CloudState
  account?: string                    // short identity (account id / subscription name)
  detail?: Record<string, string>     // popover rows
  checkedAt: number
  login?: TerminalLaunch              // command for the "Log in" button (reuses the launch shape)
}
```

(`TerminalLaunch` is already defined earlier in this file — no new import needed.)

- [ ] **Step 2: Write the failing test `tests/main/cloud-core.test.ts`**

```ts
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
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- cloud-core`
Expected: FAIL — `Cannot find module '../../src/main/cloud/providers'`.

- [ ] **Step 4: Create `src/main/cloud/providers.ts`**

```ts
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
```

- [ ] **Step 5: Create `src/main/cloud/resolve-bin.ts`**

```ts
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
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const dir of dirs) {
    if (exists(join(dir, bin))) return join(dir, bin)
    for (const ext of exts) {
      const cand = join(dir, bin + ext)
      if (exists(cand)) return cand
    }
  }
  return null
}
```

- [ ] **Step 6: Create `src/main/cloud/classify.ts`**

```ts
import type { CloudStatus } from '@shared/types'
import type { CloudProvider } from './providers'

export interface ProbeResult {
  errorCode?: string      // a spawn-failure code like 'ENOENT' (CLI not found)
  code?: number | null    // process exit code (0 = success)
  stdout: string
}

/** Pure: map one probe outcome to a CloudStatus. Never throws. */
export function classifyProbe(provider: CloudProvider, r: ProbeResult, now: number): CloudStatus {
  const base = { id: provider.id, label: provider.label, checkedAt: now, login: provider.login }
  if (r.errorCode === 'ENOENT') return { ...base, state: 'not-installed' }
  if (r.code !== 0) return { ...base, state: 'logged-out' }
  try {
    const { account, detail } = provider.parse(r.stdout)
    return { ...base, state: 'logged-in', account, detail }
  } catch {
    return { ...base, state: 'error' }
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- cloud-core`
Expected: PASS (all groups green).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/cloud/providers.ts src/main/cloud/resolve-bin.ts src/main/cloud/classify.ts tests/main/cloud-core.test.ts
git commit -m "feat(cloud): pure core - providers, parsers, bin resolution, classify"
```

---

## Task 2: CLI probe + CloudStatusService

**Files:**
- Create: `src/main/cloud/probe.ts`, `src/main/cloud/cloud-status-service.ts`
- Test: `tests/main/cloud-status-service.test.ts`

- [ ] **Step 1: Create `src/main/cloud/probe.ts`** (no unit test — it spawns a real CLI)

```ts
import { execFile } from 'node:child_process'
import type { CloudProvider } from './providers'
import { resolveBin } from './resolve-bin'
import type { ProbeResult } from './classify'

/** Run a provider's identity command. Resolves to a ProbeResult; never rejects.
 *  Uses resolveBin to report not-installed (ENOENT) without a misleading non-zero exit,
 *  and shell:true so Windows .cmd shims (e.g. az.cmd) execute. */
export function runCliProbe(provider: CloudProvider, timeoutMs = 8000): Promise<ProbeResult> {
  return new Promise(resolve => {
    if (!resolveBin(provider.bin)) {
      resolve({ errorCode: 'ENOENT', code: null, stdout: '' })
      return
    }
    execFile(
      provider.bin, provider.probeArgs,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, shell: true, killSignal: 'SIGKILL' },
      (err, stdout) => {
        if (!err) { resolve({ code: 0, stdout: stdout ?? '' }); return }
        const e = err as NodeJS.ErrnoException & { code?: string | number }
        if (typeof e.code === 'string') { resolve({ errorCode: e.code, code: null, stdout: stdout ?? '' }); return }
        resolve({ code: typeof e.code === 'number' ? e.code : 1, stdout: stdout ?? '' })
      }
    )
  })
}
```

- [ ] **Step 2: Write the failing test `tests/main/cloud-status-service.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { CloudStatusService } from '../../src/main/cloud/cloud-status-service'
import { awsProvider } from '../../src/main/cloud/providers'
import type { ProbeResult } from '../../src/main/cloud/classify'

const okAws: ProbeResult = { code: 0, stdout: JSON.stringify({ Account: '111', Arn: 'a' }) }
const provs = [awsProvider]

describe('CloudStatusService.refresh', () => {
  it('emits a checking status first, then the resolved status', async () => {
    const emit = vi.fn()
    const svc = new CloudStatusService(emit, provs, () => Promise.resolve(okAws), () => 1)
    await svc.refresh()
    const states = emit.mock.calls.map(c => (c[0] as { state: string }[])[0].state)
    expect(states[0]).toBe('checking')
    expect(states[states.length - 1]).toBe('logged-in')
  })

  it('maps a missing CLI to not-installed', async () => {
    const emit = vi.fn()
    const svc = new CloudStatusService(emit, provs, () => Promise.resolve({ errorCode: 'ENOENT', code: null, stdout: '' }), () => 1)
    await svc.refresh()
    expect((emit.mock.calls.at(-1)![0] as { state: string }[])[0].state).toBe('not-installed')
  })

  it('retains the last good result on a transient error (stale-while-revalidate)', async () => {
    const emit = vi.fn()
    const results: ProbeResult[] = [okAws, { code: 0, stdout: 'broken json' }]
    let i = 0
    const svc = new CloudStatusService(emit, provs, () => Promise.resolve(results[i++]), () => 1)
    await svc.refresh()   // logged-in
    await svc.refresh()   // parse error -> retain logged-in
    const last = (emit.mock.calls.at(-1)![0] as { state: string }[])[0]
    expect(last.state).toBe('logged-in')
  })

  it('does not run overlapping refresh cycles', async () => {
    const probe = vi.fn(() => new Promise<ProbeResult>(r => setTimeout(() => r(okAws), 5)))
    const svc = new CloudStatusService(vi.fn(), provs, probe, () => 1)
    await Promise.all([svc.refresh(), svc.refresh()])
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- cloud-status-service`
Expected: FAIL — `Cannot find module '../../src/main/cloud/cloud-status-service'`.

- [ ] **Step 4: Create `src/main/cloud/cloud-status-service.ts`**

```ts
import type { CloudStatus } from '@shared/types'
import type { CloudProvider } from './providers'
import { DEFAULT_PROVIDERS } from './providers'
import { classifyProbe, type ProbeResult } from './classify'
import { runCliProbe } from './probe'

type RunProbe = (provider: CloudProvider) => Promise<ProbeResult>

/** Periodically probes each provider's CLI for login status and emits the full array.
 *  Stale-while-revalidate: keeps the last good result on a transient error; shows
 *  'checking' only on first load; never overlaps refresh cycles. */
export class CloudStatusService {
  private last = new Map<string, CloudStatus>()
  private timer: ReturnType<typeof setInterval> | null = null
  private refreshing = false

  constructor(
    private readonly onStatus: (statuses: CloudStatus[]) => void,
    private readonly providers: CloudProvider[] = DEFAULT_PROVIDERS,
    private readonly runProbe: RunProbe = runCliProbe,
    private readonly now: () => number = () => Date.now(),
    private readonly intervalMs = 60000
  ) {}

  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, this.intervalMs)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      let showedChecking = false
      for (const p of this.providers) {
        if (!this.last.has(p.id)) {
          this.last.set(p.id, { id: p.id, label: p.label, state: 'checking', checkedAt: this.now(), login: p.login })
          showedChecking = true
        }
      }
      if (showedChecking) this.emit()

      await Promise.all(this.providers.map(async p => {
        const result = await this.runProbe(p)
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

  private emit(): void {
    this.onStatus(this.providers.map(p => this.last.get(p.id)).filter((s): s is CloudStatus => Boolean(s)))
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- cloud-status-service`
Expected: PASS (4 cases green).

- [ ] **Step 6: Build + full unit suite**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — bundles typecheck; new cloud suites green; no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/main/cloud/probe.ts src/main/cloud/cloud-status-service.ts tests/main/cloud-status-service.test.ts
git commit -m "feat(cloud): CLI probe + CloudStatusService (stale-while-revalidate)"
```

---

## Task 3: IPC channels + main wiring

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/register.ts`

- [ ] **Step 1: Add channels + API methods to `src/shared/ipc-contract.ts`**

Add `CloudStatus` to the type import on line 1 (append to the existing `from './types'` list):

```ts
import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch, QuickStore, ProcInfo, CloudStatus } from './types'
```

Add two channels to the `CH` object (after `ptyProcs: 'pty:procs'` — add a comma after it):

```ts
  ptyProcs: 'pty:procs',           // main -> renderer event
  cloudStatus: 'cloud:status',     // main -> renderer event
  cloudRefresh: 'cloud:refresh'
} as const
```

(Keep the existing inline comment on `ptyProcs`; just ensure it ends with a comma and add the two new keys before `} as const`.)

Add the methods to the `TermhallaApi` interface (after `onPtyProcs(...)`):

```ts
  onCloudStatus(cb: (statuses: CloudStatus[]) => void): () => void
  cloudRefresh(): Promise<void>
```

- [ ] **Step 2: Expose them in `src/preload/index.ts`**

Add to the `api` object (after the `onPtyProcs` block):

```ts
  onCloudStatus: (cb) => {
    const h = (_e: unknown, statuses: import('@shared/types').CloudStatus[]) => cb(statuses)
    ipcRenderer.on(CH.cloudStatus, h as never)
    return () => ipcRenderer.removeListener(CH.cloudStatus, h as never)
  },
  cloudRefresh: () => ipcRenderer.invoke(CH.cloudRefresh),
```

- [ ] **Step 3: Wire the service in `src/main/ipc/register.ts`**

Add the import near the other main imports:

```ts
import { CloudStatusService } from '../cloud/cloud-status-service'
```

After the `tracker = new ProcessTracker(...)` block (around line 45), construct and start the service, register the refresh handler, and refresh on window focus (debounced):

```ts
  const cloud = new CloudStatusService((statuses) => safeSend(CH.cloudStatus, statuses))
  cloud.start()
  ipcMain.handle(CH.cloudRefresh, () => cloud.refresh())

  let lastFocusRefresh = 0
  win.on('focus', () => {
    const t = Date.now()
    if (t - lastFocusRefresh > 5000) { lastFocusRefresh = t; void cloud.refresh() }
  })
  win.on('closed', () => cloud.stop())
```

- [ ] **Step 4: Build + full unit suite**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — bundles typecheck; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/register.ts
git commit -m "feat(cloud): cloud:status/cloud:refresh IPC + service wiring (timer, focus)"
```

---

## Task 4: Renderer store (cloud state, refresh, launchCommand)

**Files:**
- Modify: `src/renderer/store.ts`
- Modify: `src/renderer/App.tsx`

No unit test (store/App depend on the Electron `api`); verified by build + the Task 6 e2e.

- [ ] **Step 1: Extend imports + the `State` interface in `src/renderer/store.ts`**

Add `CloudStatus` and `TerminalLaunch` to the existing `@shared/types` type import. In the `State` interface, after the `procs` / `setProcs` members add:

```ts
  cloud: CloudStatus[]
  setCloud: (statuses: CloudStatus[]) => void
  refreshCloud: () => void
  launchCommand: (launch: TerminalLaunch) => void
```

- [ ] **Step 2: Add the initial value + actions**

Add the initial value next to `procs: {}`:

```ts
    cloud: [],
```

Add the actions (near `setProcs` / `launchDir`):

```ts
    setCloud: (statuses) => set({ cloud: statuses }),

    refreshCloud: () => { void api.cloudRefresh() },

    launchCommand: (launch) => {
      const wsId = get().activeId
      if (!wsId) return
      const ws = get().workspaces[wsId]
      const target = ws.layout ? Object.keys(ws.panes)[0] : null
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      const cfg: TerminalConfig = { kind: 'terminal', shellId, cwd: '', name: launch.title, launch }
      const r = ws.layout === null || target === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, target, 'row', cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
      scheduleAutosave()
    },
```

- [ ] **Step 3: Subscribe to `cloud:status` in `src/renderer/App.tsx`**

Add the import:

```tsx
import { StatusBar } from './components/StatusBar'
```

Add an effect next to the existing `onPtyProcs` effect:

```tsx
  useEffect(() => {
    const off = api.onCloudStatus((statuses) => useStore.getState().setCloud(statuses))
    return off
  }, [])
```

Render `<StatusBar />` as the last row of the outer flex column (after the mosaic-area `div`, before the `<CommandPalette />` overlay):

```tsx
      <div style={{ flex: 1, position: 'relative' }} className="mosaic-blueprint-theme">
        {active ? <WorkspaceView ws={active} /> : <div data-testid="app-title">Termhalla</div>}
      </div>
      <StatusBar />
      <CommandPalette />
```

- [ ] **Step 4: Build + full unit suite**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — no TypeScript errors; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store.ts src/renderer/App.tsx
git commit -m "feat(cloud): renderer cloud state, refresh, launchCommand + StatusBar mount"
```

---

## Task 5: StatusBar component

**Files:**
- Create: `src/renderer/components/StatusBar.tsx`

Verified by build + the Task 6 e2e. Keep the `data-testid`s exactly.

- [ ] **Step 1: Create `src/renderer/components/StatusBar.tsx`**

```tsx
import { useState } from 'react'
import { useStore } from '../store'
import type { CloudState } from '@shared/types'

const GLYPH: Record<CloudState, string> = {
  'checking': '…', 'logged-in': '✓', 'logged-out': '⚠', 'not-installed': '∅', 'error': '!'
}
const COLOR: Record<CloudState, string> = {
  'checking': '#888', 'logged-in': '#7ec97e', 'logged-out': '#d6a14a', 'not-installed': '#666', 'error': '#d6694a'
}

export function StatusBar() {
  const cloud = useStore(s => s.cloud)
  const refreshCloud = useStore(s => s.refreshCloud)
  const launchCommand = useStore(s => s.launchCommand)
  const [openFor, setOpenFor] = useState<string | null>(null)

  return (
    <div data-testid="status-bar"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '2px 10px', background: '#1e1e1e',
        borderTop: '1px solid #333', fontSize: 12, color: '#bbb', minHeight: 22 }}>
      {cloud.length === 0 && <span style={{ opacity: 0.5 }}>cloud status…</span>}
      {cloud.map(c => (
        <div key={c.id} style={{ position: 'relative' }}>
          <button data-testid={`cloud-${c.id}`} type="button"
            onClick={() => setOpenFor(openFor === c.id ? null : c.id)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit',
              color: COLOR[c.state], padding: 0, whiteSpace: 'nowrap' }}>
            {GLYPH[c.state]} {c.label}{c.account ? `: ${c.account}` : c.state === 'logged-in' ? '' : ` (${c.state})`}
          </button>
          {openFor === c.id && (
            <div data-testid={`cloud-menu-${c.id}`} onClick={e => e.stopPropagation()}
              style={{ position: 'absolute', bottom: 24, left: 0, zIndex: 20, background: '#252526', color: '#eee',
                border: '1px solid #444', borderRadius: 4, padding: 8, minWidth: 240, display: 'flex',
                flexDirection: 'column', gap: 4, fontFamily: 'Consolas, monospace' }}>
              {c.detail && Object.entries(c.detail).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
                  <span style={{ opacity: 0.6, minWidth: 92 }}>{k}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
                </div>
              ))}
              {(!c.detail || Object.keys(c.detail).length === 0) && <div style={{ opacity: 0.6 }}>{c.state}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button data-testid={`cloud-refresh-${c.id}`} type="button"
                  onClick={() => refreshCloud()}>Refresh</button>
                {c.state !== 'not-installed' && c.login && (
                  <button data-testid={`cloud-login-${c.id}`} type="button"
                    onClick={() => { const l = c.login!; launchCommand(l); setOpenFor(null) }}>Log in</button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Build to typecheck**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/StatusBar.tsx
git commit -m "feat(cloud): bottom status bar with per-provider detail popover"
```

---

## Task 6: End-to-end test + full verification

**Files:**
- Create: `tests/e2e/cloud.spec.ts`

Hermetic, mirrors `tests/e2e/cwd.spec.ts` (launch flags, `killTree`). READ `tests/e2e/cwd.spec.ts` first. The cloud CLIs may not be installed in the test box, so providers will most likely be `not-installed` or `logged-out` — the test asserts the bar + indicators + popover + Refresh deterministically, and conditionally exercises Log in when a provider offers it.

- [ ] **Step 1: Write `tests/e2e/cloud.spec.ts`**

```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('shows the cloud status bar with AWS + Azure indicators and a detail popover', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-cloud-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()

  // The bottom status bar renders, with both provider indicators (whatever their state).
  await expect(win.getByTestId('status-bar')).toBeVisible({ timeout: 15_000 })
  await expect(win.getByTestId('cloud-aws')).toBeVisible({ timeout: 20_000 })
  await expect(win.getByTestId('cloud-azure')).toBeVisible({ timeout: 20_000 })

  // Clicking an indicator opens its detail popover with a Refresh button.
  await win.getByTestId('cloud-aws').click()
  await expect(win.getByTestId('cloud-menu-aws')).toBeVisible()
  await expect(win.getByTestId('cloud-refresh-aws')).toBeVisible()
  await win.getByTestId('cloud-refresh-aws').click()           // refresh must not crash
  await expect(win.getByTestId('cloud-menu-aws')).toBeVisible()

  // If a provider offers Log in (installed-but-logged-out), it opens a terminal pane.
  const loginAws = win.getByTestId('cloud-login-aws')
  if (await loginAws.count()) {
    await loginAws.click()
    await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  }

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
```

- [ ] **Step 2: Build so e2e runs against fresh `out/`**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 3: Run the new e2e**

Run: `npm run e2e -- cloud`
Expected: PASS — status bar + both indicators visible, popover opens with Refresh, refresh doesn't crash. (The Log in branch runs only if the box has the CLI installed but logged out; it's skipped otherwise.) Run it twice to confirm stability. Do NOT weaken the bar/indicator/popover/refresh assertions.

- [ ] **Step 4: Full regression gate**

Run: `npm test && npm run e2e`
Expected: PASS — all vitest suites and all Playwright specs (smoke, persistence, editor, explorer, status, cwd, ssh-quick, procs, cloud) green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/cloud.spec.ts
git commit -m "test(cloud): e2e for status bar, indicators, popover, refresh"
```

---

## Self-Review

**1. Spec coverage:**
- §3 architecture (CloudStatusService, providers, ~60s timer + refresh + focus, stale-while-revalidate, no-overlap, emit) → Task 2 (service) + Task 3 (timer start, refresh IPC, focus). ✓
- §4 providers (AWS validated via sts, Azure cached via account show; pluggable; parse; login commands) → Task 1 (`providers.ts`). ✓
- §5 classify (ENOENT→not-installed, non-zero→logged-out, success→logged-in, parse/timeout→error; never throws) → Task 1 (`classifyProbe`) + Task 2 (probe maps ENOENT/exit; service keeps stale on error). ✓
- §6 types `CloudState`/`CloudStatus` (+login), channels `cloud:status`/`cloud:refresh`, login reuses `launch` via `launchCommand`, runtime-only → Task 1 (types) + Task 3 (channels) + Task 4 (`launchCommand`). ✓
- §7 bottom StatusBar (glyph + account, detail popover, Refresh, Log in hidden for not-installed), store `cloud`/`refreshCloud`/`launchCommand`, App subscription → Task 4 + Task 5. ✓
- §8 unit (parsers, classify) + e2e (bar/indicators/popover/refresh) → Task 1 + Task 2 tests + Task 6. ✓
- §9 non-goals respected (no per-terminal, no switching, no extra providers, no secrets, no Azure token re-validation). ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. Task 6 Step 3's Log-in branch is an explicit, bounded conditional (run-if-present), not a placeholder.

**3. Type consistency:** `CloudStatus {id,label,state,account?,detail?,checkedAt,login?}` and `CloudState` are defined once (Task 1) and used identically in `classifyProbe` (Task 1), the service (Task 2), the channel/preload (`CloudStatus[]`, Task 3), the store `cloud`/`setCloud` (Task 4), and `StatusBar` (`c.state`/`c.account`/`c.detail`/`c.login`, Task 5). `ProbeResult {errorCode?,code?,stdout}` is shared between `classify.ts`, `probe.ts`, and both tests. `CloudProvider`/`parseAwsIdentity`/`parseAzureIdentity`/`resolveBin`/`classifyProbe` signatures match between definition (Task 1) and use (Task 2). `login` is a `TerminalLaunch`, consumed by `launchCommand(launch: TerminalLaunch)` (Task 4) and `StatusBar` (Task 5). Channels `cloudStatus: 'cloud:status'` / `cloudRefresh: 'cloud:refresh'` and `onCloudStatus`/`cloudRefresh` align across contract/preload/register/App.
