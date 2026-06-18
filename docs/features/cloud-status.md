# Cloud CLI Status

> A global bottom status bar showing AWS (all configured profiles) and Azure CLI login state, with a grouped chip, per-profile detail popover, and per-profile "Log in" action. No secrets stored.

**Status:** Shipped · **Spec:** [spec](../superpowers/specs/2026-06-14-termhalla-cloud-cli-status-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-14-termhalla-cloud-cli-status.md) · **Multi-profile plan:** [plan](../superpowers/plans/2026-06-18-multi-profile-aws-status.md)

## What it does

Termhalla shows a thin persistent footer (`StatusBar`) with one compact indicator per cloud provider family (AWS, Azure). The **AWS chip** groups all configured profiles under one button (showing `N/M` logged-in count when there is more than one profile). Clicking it opens a popover listing each profile as a separate row with its own login state and a per-profile **Log in** button. Azure is unchanged — a single chip and popover row.

Detection is by **periodic CLI probe**: the main process runs each provider's identity command (`aws sts get-caller-identity --profile X`, `az account show`) every ~60s, on manual refresh, and on debounced window focus. Nothing is persisted — state is runtime-only and no credentials/secrets are read or stored ([decisions: No secrets persisted](../decisions.md)).

## How it works

The main-process `cloud-status-service.ts:CloudStatusService` owns the loop; the renderer mirrors emitted state into the store and renders `StatusBar.tsx:StatusBar`.

- **AWS profile discovery (`aws-profiles.ts`)** — `parseAwsProfiles(configText)` (pure) scans `~/.aws/config` for `[default]` and `[profile X]` sections, ignoring `[sso-session X]`/`[services X]`/comments; `discoverAwsProfiles(env?)` reads the file (honouring `AWS_CONFIG_FILE`), dedupes, and returns at most `AWS_PROFILE_CAP = 8` profiles. Falls back to `['default']` when the file is missing, unreadable, or has no profile sections. A warning is logged (not silent) when profiles are dropped by the cap.
- **Providers (`providers.ts:CloudProvider`)** — pluggable `{ id, label, bin, family, profile?, probeArgs, parse, login }`. `parse` is pure and throws on unparseable input. `family` groups providers into chips; `profile` is the AWS profile name.
  - `providers.ts:awsProbeForProfile(profile)` builds one provider per profile: runs `aws sts get-caller-identity --profile X --output json`; `providers.ts:parseAwsIdentity(stdout, profile, env?)` extracts the `Account` id (+ Arn, stamps `Profile: X`, and reads `Region` from `AWS_REGION`/`AWS_DEFAULT_REGION`). This is a **real network call that fails on expired/invalid credentials → true validation**. Login = `aws sso login --profile X`.
  - `providers.ts:azureProvider` runs `az account show --output json`; `providers.ts:parseAzureIdentity` extracts the subscription `name` (+ Id, nested `user.name`, Tenant, State). This reads the **cached login** and does **not** re-validate token expiry — a documented asymmetry vs AWS, acceptable for v1. Login = `az login`.
  - `providers.ts:resolveProviders(discover?)` — called once per refresh cycle — discovers current AWS profiles and returns one `awsProbeForProfile` per profile, followed by `azureProvider`. Provider list is dynamic (profile additions/removals take effect on the next refresh).
- **Bin resolution (`resolve-bin.ts:resolveBin`)** — pure PATH/PATHEXT lookup that returns the full path or `null`. It tries the bare name then each `PATHEXT` extension per PATH dir (so Windows `.cmd`/`.CMD` shims like `az.cmd` resolve), and falls back to a lowercase `Path` env key. Used **before spawning** to distinguish "not installed" (no path) from "logged out" (path exists, command exits non-zero).
- **Probe (`probe.ts:runCliProbe`)** — resolves to a `classify.ts:ProbeResult`, never rejects. If `resolveBin` finds nothing (or the signal is already aborted) it returns `ENOENT`/`ABORT_ERR` without spawning. Otherwise it `execFile`s with `shell:true` (so `.cmd` shims run), `windowsHide`, an ~8s `timeout`, `killSignal: 'SIGKILL'`, and the passed `AbortSignal`; the child is `unref()`'d. A numeric non-zero exit is reported as `code` (→ logged-out); any string error code (timeout/abort/spawn) is reported as `errorCode` (→ error).
- **Classify (`classify.ts:classifyProbe`)** — pure, never throws. `ENOENT` → `not-installed`; any other `errorCode` (timeout/abort/spawn) → `error`; non-zero `code` → `logged-out`; `code === 0` with a successful `parse` → `logged-in`; `parse` throwing → `error`. Copies `family` and `profile` from the provider into the emitted `CloudStatus`.
- **Service (`cloud-status-service.ts:CloudStatusService`)** — on `start()` it refreshes immediately then on a `setInterval` (~60s, `unref()`'d). `refresh()` calls `resolveProviders()` at the top of each cycle (dynamic list), is guarded by a `refreshing` flag so cycles never overlap, shows `checking` only on first load (no prior result), probes all providers in parallel with a shared `AbortController` signal, and applies **stale-while-revalidate** — a fresh `error` keeps the prior non-error/non-checking result. `emit()` dedups via a content signature so identical state isn't re-sent. `stop()` clears the timer and `abort()`s in-flight probes, then arms a fresh controller.
- **Grouping (`group-cloud.ts:groupCloudStatuses`)** — pure helper consumed by the renderer. Collapses a flat `CloudStatus[]` into `CloudGroup[]`, one per `family`, preserving first-seen order of both families and members. `summary` precedence: all `not-installed` → `not-installed`; only `checking`/`not-installed` → `checking`; any `logged-in` → `logged-in`; any `logged-out` → `logged-out`; else `error`.
- **Channels** — `ipc-contract.ts` defines `cloud:status` (main → renderer event, `CloudStatus[]`) and `cloud:refresh` (renderer → main invoke). `register.ts` constructs the service with `safeSend(CH.cloudStatus, …)`, calls `start()`, registers the `cloud:refresh` handler, refreshes on `win.on('focus')` (debounced 5s), and calls `cloud.stop()` on `win.on('closed')`. The preload exposes `onCloudStatus` / `cloudRefresh`.
- **UI (`StatusBar.tsx`)** — calls `groupCloudStatuses(cloud)` and renders one chip per group. Each chip is a `cloud-<family>` button (e.g. `cloud-aws`, `cloud-azure`). The `cloud-menu-<family>` popover lists each member as a `cloud-profile-<profile>` row (or `cloud-profile-<family>` for single-member families) with its state glyph, account label, detail rows, and an optional per-profile login button (`cloud-login-<id>`, e.g. `cloud-login-aws:default`). The `cloud-refresh-<family>` button triggers a full refresh. **Log in** calls `store.ts:launchCommand`, the generic launch override that opens a terminal pane running `provider.login` — no dedicated login IPC.

## Key files

| File | Responsibility |
|---|---|
| `src/main/cloud/aws-profiles.ts` | `parseAwsProfiles` (pure), `discoverAwsProfiles`, `AWS_PROFILE_CAP` |
| `src/main/cloud/providers.ts` | `CloudProvider` shape, `parseAwsIdentity`/`parseAzureIdentity`, `awsProbeForProfile`, `azureProvider`, `resolveProviders` |
| `src/main/cloud/resolve-bin.ts` | Pure PATH/PATHEXT lookup; not-installed vs logged-out discrimination |
| `src/main/cloud/classify.ts` | `ProbeResult` type + pure `classifyProbe` state mapping (copies `family`/`profile`) |
| `src/main/cloud/probe.ts` | `runCliProbe` — `execFile` (`shell:true`) + AbortSignal + `unref()` |
| `src/main/cloud/cloud-status-service.ts` | Timer, `resolveProviders` per refresh, stale-while-revalidate, dedup emit, abort on stop |
| `src/shared/types.ts` | `CloudState`, `CloudStatus` (+ `family?`, `profile?`, runtime-only) |
| `src/shared/group-cloud.ts` | `CloudGroup`, `groupCloudStatuses` — pure per-family grouping + summary |
| `src/shared/ipc-contract.ts` | `cloud:status` / `cloud:refresh` channels + API methods |
| `src/main/ipc/register.ts` | Service construction, timer/focus/refresh wiring, abort on window close |
| `src/renderer/store.ts` | `cloud` state, `setCloud`, `refreshCloud`, `launchCommand` |
| `src/renderer/components/StatusBar.tsx` | Bottom bar, grouped chips, per-profile popover rows, Refresh + Log in |

## Behaviors & edge cases

- **Not-installed vs logged-out.** `resolveBin` runs first: no resolved path → `ENOENT` → `not-installed` (Log in hidden). A resolved CLI that exits non-zero (no creds / not logged in) → `logged-out` (Log in shown). This avoids misreading a missing binary as a credentials failure.
- **Abort + unref shutdown hazard.** A long-lived probe child (notably `az`'s slow Python start) that is neither abortable nor `unref()`'d keeps Electron's main process alive and hangs `app.close()`. `runCliProbe` `unref()`s the child and honors an `AbortSignal`; `CloudStatusService.stop()` (wired to `win.on('closed')`) aborts in-flight probes. See [decisions: Long-lived child processes must be abortable + unref'd](../decisions.md).
- **Stale-while-revalidate.** During a re-check the last good result stays visible; `checking` shows only on first load. A transient `error` (timeout/parse failure) retains the prior `logged-in`/`logged-out`/`not-installed` value rather than flapping.
- **Focus refresh debounce.** `win.on('focus')` triggers a refresh but only once per 5s window, so rapid refocus doesn't spam the CLIs.
- **No overlap / dedup.** The `refreshing` guard skips a tick while a cycle is running; `emit()` compares a content signature and suppresses identical re-emits.
- **AWS vs Azure validation asymmetry.** AWS `sts get-caller-identity` is a live call (catches expired creds); Azure `account show` reflects cached login state only. Documented and accepted for v1.
- **AWS profile cap.** At most 8 profiles are probed (`AWS_PROFILE_CAP`). If `~/.aws/config` lists more, a warning is logged and the extras are silently dropped from the chip. The `['default']` fallback ensures a probe always runs even on machines with no `~/.aws/config`.
- **Dynamic provider list.** AWS profiles are re-discovered at the start of every refresh cycle, so adding or removing a profile in `~/.aws/config` takes effect on the next poll or manual refresh — no restart needed. Azure is always included as a single provider regardless of config.
- **AWS chip summary.** The grouped AWS chip shows the highest-priority state across all profiles: `logged-in` beats `logged-out` beats `error`; `not-installed` shows only when all profiles are not-installed. The `N/M` suffix (e.g. `AWS 1/3`) shows how many profiles are logged in when there is more than one.

## Testing

- `tests/main/aws-profiles.test.ts` (vitest) — `parseAwsProfiles`: extracts `[default]` + `[profile X]`, ignores `[sso-session]`/`[services]`/comments, dedupes, returns `[]` for no profiles, verifies `AWS_PROFILE_CAP = 8`.
- `tests/main/cloud-core.test.ts` (vitest) — pure core. Covers `parseAwsIdentity` (account/detail, profile arg, `AWS_REGION` env, throw on missing Account), `parseAzureIdentity` (subscription + nested `user.name`, throw on missing name), `resolveBin` (`.CMD` shim, bare name, null when absent), and `classifyProbe` (ENOENT→not-installed, non-zero→logged-out, parse-ok→logged-in, parse-fail→error; `family`/`profile` carried through).
- `tests/shared/group-cloud.test.ts` (vitest) — `groupCloudStatuses`: groups by family, AWS members in order, Azure single; summary precedence (all not-installed, all checking, mixed logged-in/logged-out/error).
- `tests/main/cloud-status-service.test.ts` (vitest) — `CloudStatusService.refresh`: emits `checking` first then resolved state; ENOENT→not-installed; stale-while-revalidate retains last good on transient error; no overlapping cycles; passes an `AbortSignal` to the probe and aborts it on `stop()`.
- `tests/e2e/cloud.spec.ts` (Playwright/Electron, hermetic) — launches the app, asserts the `status-bar` plus grouped `cloud-aws`/`cloud-azure` chips render, opens the AWS popover, asserts at least one `[data-testid^="cloud-profile-"]` row and `cloud-refresh-aws` are present, clicking Refresh doesn't crash, and conditionally exercises per-profile Log in (opens a terminal pane) when a `[data-testid^="cloud-login-aws:"]` button is visible. (`probe.ts` itself is not unit-tested — it spawns real CLIs.)

## Related

- [Architecture](../architecture.md) — main/preload/renderer layering and the status → store → UI pattern this mirrors.
- [Decisions](../decisions.md) — abortable+unref'd children; no secrets persisted; pure core + thin impure shell.
- [SSH favorites](ssh-favorites.md) — sub-project B, whose generic `launch` override the **Log in** button reuses.
- [AI session awareness](ai-session-awareness.md) — sibling main-process awareness pipeline (status → store → UI).
