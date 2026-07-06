# Concept — 0023-remote-node-pty-prebuilt

**Phase:** 1 (brainstorm) — human-driven.
**Date:** 2026-07-05
**Intake:** `00-intake.md` (carries the verified node-pty require-graph analysis).

## Problem (one line)

A released Termhalla uploads the version-locked agent `.cjs` to a remote host, but the agent's lazy
`import('node-pty')` fails (`ERR_MODULE_NOT_FOUND`) on any host without node-pty installed — so remote
workspaces don't work without manually installing a native module on every host. Real failure hit on
host `OpsHub` (v0.13.0).

## Strategy (locked)

Ship prebuilt node-pty **inside the installer** and have the client provisioner **upload the matching
prebuilt to the remote on connect** — zero manual remote setup, no compiler/registry needed on the
host. Reuses the F19 client-provisioned, version-locked, atomic-upload discipline.

## Decisions (settled in brainstorm)

### D1 — v1 target set: **linux-x64-glibc only**
Ship exactly `linux-x64-glibc/pty.node`. Unblocks OpsHub and the large majority of cloud Linux hosts
immediately with the smallest CI surface. `linux-arm64-glibc` and `musl`/Alpine are clean additive
fast-follows (each = one more prebuilt + one selection-table row), explicitly **out of scope** for
this feature. A remote that is not `(linux, x64, glibc)` gets a **fatal, actionable no-match
diagnostic** (names the detected triple, states v1 ships linux-x64-glibc only, points at the manual
`npm install node-pty` escape hatch) — never a silent local-shell fallback, never a partial install.

### D2 — CI production: **release-time Docker build job (old-glibc base)**
`release.yml` gains a Linux job that builds node-pty (the pinned version) **inside an old-glibc
container** and extracts `build/Release/pty.node`, which electron-builder ships via `extraResources`.
Nothing native is committed to git; the binary is reproducible from source at release time. The
windows-latest **CI test lane is untouched** (it stays typecheck+test, no `npm run build`, no native
build) — tests must not depend on a real prebuilt (see Testing).
- **glibc floor:** build on an **Ubuntu-20.04-class base (glibc ≤ 2.31)**; use `manylinux_2_28`
  (glibc 2.28) if a lower floor is wanted. Final base is a spec/plan detail; the *principle*
  (build-on-oldest so it runs on older hosts) is locked.

### D3 — integrity: **SHA-256 baked at build + verified on the remote before launch**
Compute the prebuilt's sha256 at package time and ship it beside the binary. After upload, run
`sha256sum` on the remote and compare before the agent is launched. Stronger than F19's size-only
check — this is an executable native binary that will be `dlopen`'d, so corruption/tampering matters,
not just truncation. Size-verify still gates the atomic promote (F19 shape); sha256 is the additional
pre-launch gate.

### D4 — GC: **clean reinstall on version change**
node-pty installs at the **stable** path `~/.termhalla/agent/node_modules/node-pty` (so the agent's
bare specifier resolves and it survives agent-version bumps). A small **version marker** written
beside the install lets the probe detect a stale/mismatched node-pty; on mismatch the client
`rm -rf`s the node-pty dir and re-uploads fresh (clean install), so old artifacts never accumulate
and a partial/old install can't shadow a new agent.

### D5 — node-pty is part of the version-locked install set (provisioning model)
Treat node-pty as a **co-provisioned** artifact alongside the agent `.cjs`, not a reactive repair.
On connect the client runs ONE probe exec channel that reports, in a single injection-safe `node -e`:
the platform/arch/libc triple **and** whether a version-matching node-pty is already installed
(via the marker). Provision node-pty (upload `lib/` + `build/Release/pty.node` + `package.json`,
verify sha256, write marker) when it is absent or marker-mismatched — mirroring the agent's
absent/version-mismatch → provision → retry-once → give-up-with-diagnostic flow. Never loops.
- **libc detection (resolved approach):** derive libc from Node itself —
  `process.report.getReport().header.glibcVersionRuntime` present ⇒ glibc, absent ⇒ musl/unknown —
  so detection needs only the `node` we already require, no shell/`ldd` dependency and no injection
  surface. Exact probe wording is a spec detail; the *method* is settled.

### D6 — upload file set (resolved by verification, see intake)
Linux needs exactly **one** native file, `build/Release/pty.node` (N-API, portable across Node
versions; **no `spawn-helper`** — macOS-only; **no `node-addon-api`** — build-time only). Upload the
whole `lib/` dir (a few tiny KB; immunizes against a future missed lazy `require`) + `package.json`
(so bare `import('node-pty')` resolves `main`) + the per-target `pty.node`. Layout preserved exactly
(`node-pty/lib/…` + `node-pty/build/Release/pty.node`) because the requires are relative.

## Concerns (reviewer routing tags for later phases)

- **security** — uploading + `dlopen`ing an executable native binary over ssh; argv/path-injection
  guards on the new probe + upload exec channels (reuse F19's validators); sha256 integrity of the
  binary; no-secrets posture unchanged.
- **networking** — new probe + prebuilt-upload channels over the system-ssh stdio transport; reuse of
  size-verified atomic upload + retry-once + abort/indeterminate; never an ssh library.
- **determinism** — reproducible selection from the probed (os,arch,libc) triple; stable install path
  + version marker; deterministic tests via the fake-ssh shim (no real ssh/network/native build).
- **packaging/build** — the release-time Docker job; version lockstep (prebuilt ⇔ pinned node-pty ⇔
  app); dev-vs-packaged prebuilt-path resolution (mirror `agent-artifact.ts`); glibc floor.
- **devils-advocate/quality** — glibc-floor correctness, musl/arm64 no-match path, the version-marker
  staleness logic, GC correctness (no TOCTOU wiping a live install), diagnostic clarity.

## Testing posture (locked constraints)

No real ssh, no real network, **no real native build in the CI test lane**. Extend the F19
`tests/fixtures/fake-ssh.mjs` shim to emulate the new probe + prebuilt-upload command shapes against
a fake remote home, and drive selection/upload/marker/GC/sha256-mismatch scenarios deterministically.
A relaunch that must *resolve* node-pty is exercised with a stub module (the `--pty=fake` backend and
canned modules — never a real `.node`) so the resolution + version-marker logic is proven without a
platform-native binary. The gold path (a real prebuilt end-to-end) is release-job territory, kept out
of the windows-latest lane.

## Non-goals (confirmed)

- arm64 / musl / macOS / Windows-remote prebuilts (fast-follow; Remote Agent v1 remote = Linux).
- On-remote compilation / `npm install` fallback.
- Agent daemonization / session-survival changes.
- Any change to local-only app behavior; renderer/preload still never import `remote-client`.
- No `SCHEMA_VERSION` bump (no persisted app-state shape change; the version marker lives on the
  remote host, not in Termhalla's persisted state) — to be confirmed in spec.

## Open questions

| # | Question | Status | Note |
|---|----------|--------|------|
| 1 | Minimal node-pty upload set | **resolved** | Verified require graph — D6 / intake. |
| 2 | v1 target set | **resolved** | D1 — x64-glibc only. |
| 3 | CI production mechanism | **resolved** | D2 — release-time Docker job. |
| 4 | Integrity strength | **resolved** | D3 — sha256 + post-upload verify. |
| 5 | Artifact GC | **resolved** | D4 — clean reinstall on version change. |
| 6 | Provisioning model (co-provision vs reactive) | **resolved** | D5 — co-provisioned install set. |
| 7 | libc detection method | **resolved** | D5 — Node `process.report` glibc header. |
| 8 | Exact glibc build base (20.04 vs manylinux_2_28) | **deferred** | Spec/plan detail; principle locked. |
| 9 | Version-marker exact shape + SCHEMA_VERSION confirmation | **deferred** | Spec detail; no app-state bump expected. |

**No blocking open questions.** Awaiting human confirmation to record the brainstorm gate.
