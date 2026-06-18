# Multi-profile AWS cloud status — design

**Date:** 2026-06-18
**Feature:** Surface the login state of *every* configured AWS profile in the cloud status bar,
not just the default profile. Azure stays single-account.

## Problem

The cloud-status feature probes one hard-wired `aws sts get-caller-identity` against the **default**
credential chain and shows a single "AWS" chip. A user logged in only on a non-default profile (e.g.
`--profile bedrock`) sees "logged out," because the app never looks at that profile.

## Goal

Auto-discover AWS profiles from `~/.aws/config`, probe each, and show them under **one grouped AWS
chip** whose popover lists every profile's state with a per-profile login. Reuse the existing
abortable/unref'd probe + `CloudStatusService` poll/dedup machinery.

## Architecture & data flow

The provider list goes from fixed (`[aws, azure]`) to **resolved each refresh**:

```
refresh() (~60s / window focus / manual):
  resolveProviders() = [ azureProvider, ...discoverAwsProfiles().map(awsProbeForProfile) ]
        │   (re-reads ~/.aws/config each refresh → new profiles appear, removed ones drop out)
        ▼   Promise.all over the existing runCliProbe (abortable, unref'd, shell:true)
  aws sts get-caller-identity --profile <p> --output json     (one per profile)
  az  account show --output json                              (unchanged)
        │   classifyProbe (stamps family + profile)
        ▼   signature dedup → onStatus
  CloudStatus[]  →  cloud:status  →  store.cloud  →  StatusBar (groups via pure helper)
```

### New / changed units (main)

| File | Change |
|---|---|
| `src/main/cloud/aws-profiles.ts` | **New.** Pure `parseAwsProfiles(configText): string[]` (extracts `[default]` + `[profile X]`; ignores `[sso-session]`/`[services]`; dedupes; caps at `AWS_PROFILE_CAP = 8`). Thin reader `discoverAwsProfiles()` loads `~/.aws/config` (honoring `AWS_CONFIG_FILE`), returns parsed names, and falls back to `['default']` when the file is missing or yields none. |
| `src/main/cloud/providers.ts` | Add `awsProbeForProfile(profile): CloudProvider` (`id: "aws:<profile>"`, `family: 'aws'`, `profile`, `probeArgs: ['sts','get-caller-identity','--profile',profile,'--output','json']`, `login: aws sso login --profile <profile>`, `parse` stamps the profile). Add `family` (+ optional `profile`) to the `CloudProvider` interface. `azureProvider` gains `family: 'azure'`. The fixed `DEFAULT_PROVIDERS` is replaced by `resolveProviders(discover = discoverAwsProfiles)`. |
| `src/main/cloud/classify.ts` | `classifyProbe` copies `family`/`profile` from the provider into the `CloudStatus`. |
| `src/main/cloud/cloud-status-service.ts` | Constructor takes an injectable `resolveProviders: () => CloudProvider[]` instead of a fixed array; calls it at the top of each `refresh()`. `last`/`lastSig` maps stay keyed by `id`; `emit()` iterates the freshly-resolved list so add/remove is handled. The "checking" seeding + stale-while-revalidate logic is unchanged. |

### New / changed units (shared + renderer)

| File | Change |
|---|---|
| `src/shared/types.ts` | `CloudStatus` gains `family?: string` and `profile?: string`. |
| `src/shared/group-cloud.ts` | **New, pure.** `groupCloudStatuses(statuses): CloudGroup[]` (see below). Shared so it's unit-testable without the renderer. |
| `src/renderer/components/StatusBar.tsx` | Render `groupCloudStatuses(cloud)` → one chip per group. AWS = grouped summary chip + per-profile popover rows; Azure = single member (looks identical to today). |

## Grouping & display

```ts
// src/shared/group-cloud.ts
export interface CloudGroup {
  family: string            // 'aws' | 'azure'
  label: string             // 'AWS' | 'Azure'
  members: CloudStatus[]    // per-profile (aws) or single (azure), in stable order
  summary: CloudState       // aggregate state for the chip glyph/color
  loggedIn: number          // count of members in 'logged-in'
  total: number
}

export function groupCloudStatuses(statuses: CloudStatus[]): CloudGroup[]
```

**Summary-state precedence** (the chip glyph): if every member is `not-installed` → `not-installed`;
else if nothing has resolved yet (only `checking`) → `checking`; else if any member is `logged-in`
→ `logged-in`; else if any `logged-out` → `logged-out`; else `error`. The chip shows `loggedIn/total`
when `total > 1`. Color: green when `loggedIn === total`, amber when `0 < loggedIn < total` or any
`logged-out`, red on `error`, dim on `not-installed`.

**StatusBar:** one chip per group (Azure unchanged; AWS now grouped):
- Chip testid `cloud-<family>` (`cloud-aws` / `cloud-azure` — preserved). AWS chip label e.g.
  `✓ AWS 1/2`.
- Popover testid `cloud-menu-<family>` (preserved). For each member, a row
  (`cloud-profile-<profile>` for AWS) showing glyph + profile/subscription + account/arn detail, and
  a per-member **Log in** button `cloud-login-<id>` (`cloud-login-aws:<profile>` / `cloud-login-azure`)
  shown when that member is `logged-out`/`error` and offers `login`. A group **Refresh** button
  `cloud-refresh-<family>` (preserved) refreshes all.
- If profiles were capped, the popover footer shows "+N more (showing 8)".

## Error handling & edges

- **No `~/.aws/config` / no profiles** → `discoverAwsProfiles()` returns `['default']` → a single
  `aws:default` probe with `--profile default` (env-credential users keep an AWS chip).
- **`aws` not installed** → every AWS member is `not-installed`; the group chip shows `∅ AWS`.
- **Expired / never-logged-in SSO profile** → `get-caller-identity --profile X` exits non-zero (no
  interactive prompt under `execFile`) → that row is `logged-out` with its own Log-in button
  (`aws sso login --profile X`).
- **> 8 profiles** → capped at 8; the popover footer notes the remainder (never silently truncated).
- **Cost** → up to 8 concurrent `aws` calls per poll; bounded by the cap, gated by the existing
  `refreshing` guard, aborted on shutdown, deduped before emit.
- **Privacy** → unchanged; account id / ARN already shown in the popover, nothing newly persisted.

## Testing

### Unit (vitest)
- `aws-profiles.test.ts` — parse `[default]` + `[profile X]`; ignore `[sso-session X]`/`[services X]`
  and comments; dedupe; cap at 8; empty/garbage → `['default']` fallback.
- `group-cloud.test.ts` — summary precedence (all-in, mixed, all-out, all-checking, all-not-installed),
  `loggedIn`/`total` counts, member ordering, single-member (Azure) group.
- `cloud-providers.test.ts` (extend existing `parseAwsIdentity` coverage) — `parseAwsIdentity` stamps
  the profile from the provided name (not env); `awsProbeForProfile` builds the right `--profile`
  args + `aws sso login --profile X` login.

### E2E (Playwright) — extend `tests/e2e/cloud.spec.ts`
The probes shell out to the real `aws`/`az` CLIs, so the test stays **credential-agnostic** (asserts
the chips/popover render in whatever state, as today). Updated assertions: the `cloud-aws` group chip
is visible; its popover (`cloud-menu-aws`) lists **at least one** `cloud-profile-*` row; Refresh
works; a per-row `cloud-login-aws:*` opens a terminal when present. (The default-fallback guarantees
at least one AWS profile row even on a runner with no config.)

## Non-goals (v1)

- Azure multi-subscription (Azure stays single-account).
- Editing/saving a curated profile list (auto-discovery only; opt-out deferred).
- Region/role switching from the popover.
- Probing profiles in parallel beyond the cap, or per-profile poll intervals.
