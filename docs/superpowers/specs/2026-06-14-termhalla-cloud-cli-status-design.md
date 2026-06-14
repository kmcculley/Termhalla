# Termhalla — Cloud CLI Status (AWS/Azure) — Design Spec

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phases 1–3 + CWD awareness (A) + SSH/favorites (B) + child-process tracking (C), all merged to `main`.

## 1. Summary

A **global** bottom **status bar** showing AWS and Azure CLI login status — whether
you're authenticated and as which account/profile — refreshed periodically by probing
the CLIs, with a manual refresh and a "Log in" action. This is sub-project D of the
post-launch roadmap.

Detection is **global** (the ambient default identity), not per-terminal; per-terminal
profile awareness is an explicit later follow-up (§7).

## 2. Decisions (from brainstorming, 2026-06-14)

| Decision | Choice |
|---|---|
| Scope | **Global** indicator (one AWS + one Azure status), not per-terminal. |
| Providers | **AWS + Azure**, behind a small pluggable provider abstraction (probe command + parser + login command) so others (gcloud) are easy to add later. |
| Placement | **New bottom status bar** (a thin persistent footer strip). |
| Interactivity | **Status + manual refresh + "Log in"** (opens a terminal running the provider's login command, reusing the sub-project B `launch` override). |
| Detection | **A — Periodic CLI probe** (~60s timer + manual refresh + on window focus), `execFile` JSON, stale-while-revalidate. |

## 3. Architecture & data flow

A new main-process **`CloudStatusService`** (`src/main/cloud/`):

- Holds a list of **providers** (AWS, Azure).
- On a **~60s timer**, plus a **manual refresh** (`cloud:refresh` IPC) and on **window
  focus** (`win.on('focus')`, debounced ~5s so rapid refocus doesn't spam), it probes
  each provider by running its CLI identity command via `execFile` (timeout + `windowsHide`),
  maps each result to a `CloudStatus`, and emits the array over the `cloud:status` channel.
- **Stale-while-revalidate:** the last result stays visible during a re-check; the
  `checking` state shows only on first load (no prior result).
- **No overlapping probe cycles:** an in-flight guard skips a tick while a cycle runs.

This mirrors the existing status/cwd/procs → store → UI pattern (`safeSend` guarded).

## 4. Providers (pluggable)

Each provider is a small module exposing a `CloudProvider`:
```ts
interface CloudProvider {
  id: string             // 'aws' | 'azure'
  label: string          // 'AWS' | 'Azure'
  bin: string            // executable, e.g. 'aws' / 'az'
  probeArgs: string[]    // identity command args
  parse(stdout: string): { account: string; detail: Record<string, string> }  // throws if unparseable
  login: { command: string; args: string[]; title: string }   // for the Log in button
}
```

- **AWS** — `aws sts get-caller-identity --output json` → `{ UserId, Account, Arn }`.
  This is a **real network call that fails on expired/invalid credentials → true
  validation.** `account` = the `Account` id; `detail` = Account / Arn / Profile
  (`AWS_PROFILE` or `default`) / Region (`AWS_REGION`/`AWS_DEFAULT_REGION` if set).
  Login = `aws sso login` (SSO-oriented; noted as a convenience — non-SSO setups have no
  "login" command).
- **Azure** — `az account show --output json` → `{ name, id, user, tenantId, state }`.
  This reads the **cached login** (reflects the last `az login`); it does **not**
  re-validate token expiry the way the AWS call does — a **documented asymmetry**,
  acceptable for v1. `account` = subscription `name`; `detail` = Subscription / Id /
  User / Tenant / State. Login = `az login`.

The pure `parse*` functions are unit-tested.

## 5. CloudStatusService — state mapping & error handling

A **pure** `classifyProbe(result, parse) → CloudStatus` maps a probe outcome to state:
- CLI absent (`execFile` error code `ENOENT`) → **`not-installed`**.
- non-zero exit → **`logged-out`** (e.g. `aws sts` with no creds, `az account show` when
  not logged in).
- success + `parse` succeeds → **`logged-in`** (with `account` + `detail`).
- timeout, spawn error, or `parse` throwing → **`error`** (the service keeps the previous
  result for that provider if one exists).

`classifyProbe` never throws. Probe timeout ~8s (Azure's `az` has a slow Python start,
~1–2s). The service maps `ENOENT` by inspecting the `execFile` error's `code`.

## 6. Types & IPC

```ts
type CloudState = 'checking' | 'logged-in' | 'logged-out' | 'not-installed' | 'error'
interface CloudStatus {
  id: string
  label: string
  state: CloudState
  account?: string                    // short identity (account id / subscription name)
  detail?: Record<string, string>     // popover rows
  checkedAt: number
}
```
- New channel **`cloud:status`** (main → renderer, carries `CloudStatus[]`).
- New channel **`cloud:refresh`** (renderer → main, invoke; triggers an immediate probe cycle).
- The **Log in** button reuses the **existing terminal `launch` override** (sub-project B):
  a generic renderer store action `launchCommand({ command, args, title })` spawns a
  terminal running the login command (split off the active workspace, or first pane when
  empty — same target logic as `launchConnection`/`launchDir`). **No new login IPC.**
- Runtime-only; nothing is persisted.

## 7. Renderer — bottom status bar

A new **`StatusBar`** component rendered at the bottom of `App` (below the mosaic area,
inside the outer flex column). For each provider it shows a compact indicator: a state
glyph (✓ logged-in / ⚠ logged-out / ∅ not-installed / ⟳ checking / ! error) + the label +
the `account` (or the state text). Clicking an indicator opens a **detail popover** with:
- the `detail` rows (Subscription/Account/Arn/Tenant/etc.),
- a **Refresh** button (`cloud:refresh`),
- a **Log in** button that calls `launchCommand(provider.login)` — hidden/disabled for
  `not-installed` providers.

The store gains `cloud: CloudStatus[]` (updated on `cloud:status`), `refreshCloud()`, and
`launchCommand(...)`. `App` subscribes to `cloud:status` (mirroring the `onPtyProcs` effect).

## 8. Testing & verification

- **Unit (vitest, pure):**
  - `parseAwsIdentity` — valid JSON → account/detail; missing/extra fields handled.
  - `parseAzureIdentity` — valid JSON → subscription/detail; nested `user.name`.
  - `classifyProbe` — ENOENT → not-installed; non-zero exit → logged-out; success → logged-in;
    parse-throw / timeout → error.
- **e2e (Playwright, hermetic):** launch → assert the status bar shows the AWS + Azure
  indicators (in the test box they will be `not-installed` or `logged-out`, exercising the
  graceful paths) → click an indicator → the popover shows **Refresh** and (when applicable)
  **Log in** → clicking **Log in** opens a terminal pane running the provider's login command.

## 9. Non-goals (this sub-project)

- No per-terminal profile/identity awareness (the layered follow-up).
- No profile / subscription switching from the UI.
- No providers beyond AWS + Azure yet (the abstraction makes adding gcloud etc. easy later).
- No credential storage or parsing of secrets.
- No re-validation of Azure token expiry beyond what `az account show` reports.
