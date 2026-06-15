# Cloud CLI Status

> A global bottom status bar showing AWS and Azure CLI login state, with a detail popover and a "Log in" action. No secrets stored.

**Status:** Shipped · **Spec:** [spec](../superpowers/specs/2026-06-14-termhalla-cloud-cli-status-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-14-termhalla-cloud-cli-status.md)

## What it does

Termhalla shows a thin persistent footer (`StatusBar`) with one compact indicator per cloud provider (AWS, Azure). Each indicator reports the **global** ambient login state — not per-terminal — as a glyph plus the account/subscription it resolved. Clicking an indicator opens a detail popover with the identity rows, a **Refresh** button, and (when applicable) a **Log in** button.

Detection is by **periodic CLI probe**: the main process runs each provider's identity command (`aws sts get-caller-identity`, `az account show`) every ~60s, on manual refresh, and on debounced window focus. Nothing is persisted — state is runtime-only and no credentials/secrets are read or stored ([decisions: No secrets persisted](../decisions.md)).

## How it works

The main-process `cloud-status-service.ts:CloudStatusService` owns the loop; the renderer mirrors emitted state into the store and renders `StatusBar.tsx:StatusBar`.

- **Providers (`providers.ts:CloudProvider`)** — pluggable `{ id, label, bin, probeArgs, parse, login }`. `parse` is pure and throws on unparseable input.
  - `providers.ts:awsProvider` runs `aws sts get-caller-identity --output json`; `providers.ts:parseAwsIdentity` extracts the `Account` id (+ Arn, and Profile/Region read from `AWS_PROFILE`/`AWS_DEFAULT_PROFILE` and `AWS_REGION`/`AWS_DEFAULT_REGION`). This is a **real network call that fails on expired/invalid credentials → true validation**. Login = `aws sso login`.
  - `providers.ts:azureProvider` runs `az account show --output json`; `providers.ts:parseAzureIdentity` extracts the subscription `name` (+ Id, nested `user.name`, Tenant, State). This reads the **cached login** and does **not** re-validate token expiry — a documented asymmetry vs AWS, acceptable for v1. Login = `az login`.
- **Bin resolution (`resolve-bin.ts:resolveBin`)** — pure PATH/PATHEXT lookup that returns the full path or `null`. It tries the bare name then each `PATHEXT` extension per PATH dir (so Windows `.cmd`/`.CMD` shims like `az.cmd` resolve), and falls back to a lowercase `Path` env key. Used **before spawning** to distinguish "not installed" (no path) from "logged out" (path exists, command exits non-zero).
- **Probe (`probe.ts:runCliProbe`)** — resolves to a `classify.ts:ProbeResult`, never rejects. If `resolveBin` finds nothing (or the signal is already aborted) it returns `ENOENT`/`ABORT_ERR` without spawning. Otherwise it `execFile`s with `shell:true` (so `.cmd` shims run), `windowsHide`, an ~8s `timeout`, `killSignal: 'SIGKILL'`, and the passed `AbortSignal`; the child is `unref()`'d. A numeric non-zero exit is reported as `code` (→ logged-out); any string error code (timeout/abort/spawn) is reported as `errorCode` (→ error).
- **Classify (`classify.ts:classifyProbe`)** — pure, never throws. `ENOENT` → `not-installed`; any other `errorCode` (timeout/abort/spawn) → `error`; non-zero `code` → `logged-out`; `code === 0` with a successful `parse` → `logged-in`; `parse` throwing → `error`.
- **Service (`cloud-status-service.ts:CloudStatusService`)** — on `start()` it refreshes immediately then on a `setInterval` (~60s, `unref()`'d). `refresh()` is guarded by a `refreshing` flag so cycles never overlap; it shows `checking` only on first load (no prior result), probes all providers in parallel with a shared `AbortController` signal, and applies **stale-while-revalidate** — a fresh `error` keeps the prior non-error/non-checking result. `emit()` dedups via a content signature so identical state isn't re-sent. `stop()` clears the timer and `abort()`s in-flight probes, then arms a fresh controller.
- **Channels** — `ipc-contract.ts` defines `cloud:status` (main → renderer event, `CloudStatus[]`) and `cloud:refresh` (renderer → main invoke). `register.ts` constructs the service with `safeSend(CH.cloudStatus, …)`, calls `start()`, registers the `cloud:refresh` handler, refreshes on `win.on('focus')` (debounced 5s), and calls `cloud.stop()` on `win.on('closed')`. The preload exposes `onCloudStatus` / `cloudRefresh`.
- **UI (`StatusBar.tsx`)** — per provider, a `cloud-<id>` button shows `GLYPH[state]` + label + account (or `(state)`). The `cloud-menu-<id>` popover lists `detail` rows and offers `cloud-refresh-<id>` (calls `store.ts:refreshCloud` → `cloud:refresh`) and `cloud-login-<id>`, hidden for `not-installed`. **Log in** calls `store.ts:launchCommand`, the generic launch override (sub-project B) that opens a terminal pane running `provider.login` — no dedicated login IPC.

## Key files

| File | Responsibility |
|---|---|
| `src/main/cloud/providers.ts` | `CloudProvider` shape, pure `parseAwsIdentity`/`parseAzureIdentity`, AWS/Azure providers, `DEFAULT_PROVIDERS` |
| `src/main/cloud/resolve-bin.ts` | Pure PATH/PATHEXT lookup; not-installed vs logged-out discrimination |
| `src/main/cloud/classify.ts` | `ProbeResult` type + pure `classifyProbe` state mapping |
| `src/main/cloud/probe.ts` | `runCliProbe` — `execFile` (`shell:true`) + AbortSignal + `unref()` |
| `src/main/cloud/cloud-status-service.ts` | Timer, refresh cycle, stale-while-revalidate, dedup emit, abort on stop |
| `src/shared/types.ts` | `CloudState`, `CloudStatus` (runtime-only) |
| `src/shared/ipc-contract.ts` | `cloud:status` / `cloud:refresh` channels + API methods |
| `src/main/ipc/register.ts` | Service construction, timer/focus/refresh wiring, abort on window close |
| `src/renderer/store.ts` | `cloud` state, `setCloud`, `refreshCloud`, `launchCommand` |
| `src/renderer/components/StatusBar.tsx` | Bottom bar, glyph/account indicators, detail popover, Refresh + Log in |

## Behaviors & edge cases

- **Not-installed vs logged-out.** `resolveBin` runs first: no resolved path → `ENOENT` → `not-installed` (Log in hidden). A resolved CLI that exits non-zero (no creds / not logged in) → `logged-out` (Log in shown). This avoids misreading a missing binary as a credentials failure.
- **Abort + unref shutdown hazard.** A long-lived probe child (notably `az`'s slow Python start) that is neither abortable nor `unref()`'d keeps Electron's main process alive and hangs `app.close()`. `runCliProbe` `unref()`s the child and honors an `AbortSignal`; `CloudStatusService.stop()` (wired to `win.on('closed')`) aborts in-flight probes. See [decisions: Long-lived child processes must be abortable + unref'd](../decisions.md).
- **Stale-while-revalidate.** During a re-check the last good result stays visible; `checking` shows only on first load. A transient `error` (timeout/parse failure) retains the prior `logged-in`/`logged-out`/`not-installed` value rather than flapping.
- **Focus refresh debounce.** `win.on('focus')` triggers a refresh but only once per 5s window, so rapid refocus doesn't spam the CLIs.
- **No overlap / dedup.** The `refreshing` guard skips a tick while a cycle is running; `emit()` compares a content signature and suppresses identical re-emits.
- **AWS vs Azure validation asymmetry.** AWS `sts get-caller-identity` is a live call (catches expired creds); Azure `account show` reflects cached login state only. Documented and accepted for v1.

## Testing

- `tests/main/cloud-core.test.ts` (vitest) — pure core. Covers `parseAwsIdentity` (account/detail, `AWS_PROFILE`/`AWS_REGION` defaults, throw on missing Account), `parseAzureIdentity` (subscription + nested `user.name`, throw on missing name), `resolveBin` (`.CMD` shim, bare name, null when absent), and `classifyProbe` (ENOENT→not-installed, non-zero→logged-out, parse-ok→logged-in, parse-fail→error).
- `tests/main/cloud-status-service.test.ts` (vitest) — `CloudStatusService.refresh`: emits `checking` first then resolved state; ENOENT→not-installed; stale-while-revalidate retains last good on transient error; no overlapping cycles; passes an `AbortSignal` to the probe and aborts it on `stop()`.
- `tests/e2e/cloud.spec.ts` (Playwright/Electron, hermetic) — launches the app, asserts the `status-bar` plus `cloud-aws`/`cloud-azure` indicators render, opens a popover, asserts `cloud-refresh-aws` is present and clicking it doesn't crash, and conditionally exercises Log in (opens a terminal pane) when a provider offers it. (`probe.ts` itself is not unit-tested — it spawns real CLIs.)

## Related

- [Architecture](../architecture.md) — main/preload/renderer layering and the status → store → UI pattern this mirrors.
- [Decisions](../decisions.md) — abortable+unref'd children; no secrets persisted; pure core + thin impure shell.
- [SSH favorites](ssh-favorites.md) — sub-project B, whose generic `launch` override the **Log in** button reuses.
- [AI session awareness](ai-session-awareness.md) — sibling main-process awareness pipeline (status → store → UI).
