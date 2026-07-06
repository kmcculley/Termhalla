# Intake — 0023-remote-node-pty-prebuilt

**Captured:** 2026-07-05
**Source:** Direct user report — a released v0.13.0 install failed to connect a remote workspace to a
stock Linux host (`OpsHub`) because `node-pty` was absent on the remote. User decided the fix
strategy (ship prebuilts, not remote `npm install`) and to run it through the Orky pipeline.

## The idea (verbatim)

> Auto-provision node-pty onto the remote host so remote workspaces work with zero manual remote setup.
>
> Problem: The Remote Agent v1 uploads a single-file agent bundle (out/agent/termhalla-agent.cjs) to
> the remote, but that bundle cannot contain node-pty (a native .node module). The agent lazily does
> `import('node-pty')` (src/agent/node-pty-backend.ts), which resolves a bare specifier from the
> remote host. On a host without node-pty installed, the agent launches then dies before hello with:
> "failed to load the node-pty backend: ERR_MODULE_NOT_FOUND: Cannot find package 'node-pty'". Today
> the only fix is manually installing node-pty on each remote host, which is unacceptable.
>
> Chosen solution (decided with the user): SHIP PREBUILTS. Do NOT auto-run `npm install` on the
> remote (node-pty@1.1.0-beta34 has no prebuilds and compiles from source via node-gyp postinstall,
> so it would require a C++ toolchain + npm registry access on every remote — fails on
> locked-down/offline hosts). Instead:
> - Produce prebuilt node-pty native binaries for Linux targets in CI/release (node-pty is N-API
>   based — depends on node-addon-api ^7.1.0 — so ONE prebuilt per (os, arch, libc) is portable
>   across Node versions; no per-Node-ABI matrix). Target at least linux-x64-glibc; likely also
>   linux-arm64-glibc; consider musl/Alpine.
> - Ship these prebuilts inside the installer alongside the agent artifact (extend
>   electron-builder.yml extraResources; extend the release.yml build to generate the linux
>   prebuilts).
> - At connect/provision time, the client probes the remote's platform/arch/libc (a new small exec
>   channel, e.g. `node -e` printing process.platform/process.arch + a glibc/musl detection), selects
>   the matching prebuilt, and uploads node-pty (the .node plus the minimal JS wrapper node-pty needs)
>   into ~/.termhalla/agent/node_modules/node-pty so the agent's bare `import('node-pty')` resolves.
>   Same dir as the versioned agent bundle so it survives version bumps.
> - If no prebuilt matches the remote (unknown arch/libc), fail with a clear, actionable diagnostic
>   (do NOT silently fall back to a compile in v1 — out of scope unless brainstorm decides otherwise).
>
> Constraints / must-preserve: honor the existing client-provisioned, version-locked,
> size-verified-atomic-upload discipline in src/remote-client/bootstrap.ts (retry-exactly-once,
> indeterminate-on-abort, caller-owned cancellation via AbortSignal); no secrets persisted; keep the
> system-ssh stdio exec channel transport (never an ssh library); keep the src/remote-client scope
> guards; the pinned node-pty version must stay in lockstep with the app's node-pty version. Primary
> areas: src/remote-client/ (bootstrap/provision + a new arch/libc probe + prebuilt selection),
> electron-builder.yml extraResources, release.yml CI (generate linux prebuilts),
> src/main/remote/agent-artifact.ts (resolve prebuilt paths), and tests (extend the fake-ssh shim +
> gold test). Feature doc: docs/features/remote-bootstrap.md.
>
> Goal: from a released install, creating a remote workspace against a stock Linux host with only
> `node` present (no compiler, no npm access) Just Works — the client uploads a matching prebuilt
> node-pty automatically and the agent completes its hello.

## Observed failure (the triggering bug)

Real error surfaced to the user in the Remote Agent picker/banner:

> Connecting to OpsHub failed — the agent launch ended before a hello (exit 1) — stderr: failed to
> load the node-pty backend: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'node-pty' imported
> from /home/xadmin/.termhalla/agent/termhalla-agent-0.13.0.cjs - the v1 real backend targets Linux;
> use --pty=fake for the scripted backend

Root cause confirmed in code: `src/agent/node-pty-backend.ts:39` does `await import('node-pty')`
(a bare specifier, the load-bearing lazy load TEST-755 pins). The uploaded `.cjs` bundle
(`vite.agent.config.ts`) deliberately excludes `node-pty` (a native module cannot be bundled), so
the specifier resolves against the remote host's `node_modules` — which on a fresh host is empty.
`out/agent/termhalla-agent.cjs` is ~52 KB, confirming no native payload rides along.

Key enabling fact verified locally: `node_modules/node-pty/package.json` — version `1.1.0-beta34`,
no `prebuilds/` dir, no `binary` field, `postinstall` = `node scripts/post-install.js` (compiles via
node-gyp), deps include `node-addon-api ^7.1.0` (→ N-API, so a compiled `.node` is portable across
Node major versions; the prebuilt matrix is (os, arch, libc) only).

## Concern tags (inferred — to be committed in the spec, not here)

Likely reviewer lenses this feature will route to:

- **security** — uploading an executable native binary to a remote host over ssh; path/argv
  injection surfaces in the new arch/libc probe and prebuilt-selection exec channels; size/integrity
  verification of the uploaded `.node`; no-secrets posture preserved.
- **networking** — the new probe + prebuilt-upload exec channels over the system-ssh stdio transport;
  reuse of the size-verified atomic-upload + retry-once + abort/indeterminate discipline.
- **determinism** — reproducible prebuilt selection from a probed (os, arch, libc) triple; stable,
  version-locked install paths; deterministic tests via the fake-ssh shim (no real ssh/network ever).
- **packaging / build** — CI must generate the Linux prebuilts and ship them in `extraResources`;
  version lockstep between the shipped prebuilt and the app's node-pty; artifact-path resolution in
  dev vs packaged.
- **devils-advocate / quality** — glibc-version portability of a prebuilt (build-on-oldest), musl
  vs glibc detection correctness, the no-match diagnostic path, artifact accumulation/GC.

## Locked design decisions carried in (human-confirmed 2026-07-05)

1. **Ship prebuilts, do NOT `npm install` on the remote.** Rationale recorded above (no-toolchain /
   offline hosts must work). A remote compile fallback is explicitly out of scope for v1 unless the
   brainstorm reopens it.
2. **N-API portability is the design lever:** one prebuilt per (os, arch, libc), not per Node ABI.
3. **Version lockstep:** the shipped prebuilt's node-pty version equals the app's pinned node-pty
   version equals the agent bundle's `AGENT_VERSION` pairing discipline. Upload target stays the
   versioned agent dir (`~/.termhalla/agent/node_modules/node-pty`) so it survives version bumps and
   rides the same atomic-promote posture.
4. **Preserve the F19 provisioning contract** (`src/remote-client/bootstrap.ts`): client-provisioned,
   size-verified atomic upload, retry-exactly-once, indeterminate-on-abort, caller-owned cancellation
   via `AbortSignal`, system-ssh stdio exec channel (NEVER an ssh library).
5. **No-match = a clear, actionable fatal diagnostic**, never a silent local-shell fallback and never
   a silent partial install.

## Pre-existing structural anchors (the spec must honor these)

- **F19 bootstrap/provision** (`src/remote-client/bootstrap.ts`, `classify.ts`, `ssh-command.ts`,
  `ssh-spawn.ts`, `agents-store.ts`) is the layer to extend. The classify truth table
  (`absent` / `version-mismatch` provisionable; everything else fatal) and the size-verified atomic
  upload shape (`mkdir -p … && cat > tmp && [ wc -c = n ] && mv … || { rm -f tmp; exit 93; }`) are
  the patterns to reuse for the new prebuilt upload.
- **Scope guards** (`tests/remote-client-structure.test.ts`): `src/remote-client/` imports no
  electron/renderer/preload/main module; no `src/preload`/`src/renderer` file imports `remote-client`
  (F21 moved the sanctioned consumer into `src/main/`); remote-client never references `package.json`
  (the caller injects version); no ssh-library dependency; the fake-ssh shim imports no network
  module. These must survive.
- **`src/main/remote/agent-artifact.ts`** resolves the agent artifact path (dev = `out/agent/…`,
  packaged = `resources/agent/…`). The prebuilt bundle paths need the analogous resolver, injected
  into the manager (`src/main/remote/remote-workspace-manager.ts`) — the same electron-free-by-
  injection posture.
- **Packaging** (`electron-builder.yml` `extraResources`): today ships
  `out/agent/termhalla-agent.cjs` → `resources/agent/termhalla-agent.cjs` OUTSIDE the asar. The
  prebuilts ship the same way (readable as plain files by the upload stream).
- **CI/release** (`.github/workflows/ci.yml` = typecheck+test on windows-latest, NO build;
  `release.yml` = `npm run package` on a tag push). Producing Linux prebuilts is a NEW build-side
  concern — tests must NOT require real prebuilts/native builds (the CI reality: no `npm run build`,
  windows-latest). The fake-ssh shim + a scenario harness must exercise selection + upload + a
  re-launch that resolves `node-pty` deterministically without a real native module.
- **Agent stdio contract** (`src/agent/main.ts`, `node-pty-backend.ts`): the agent speaks first;
  `--pty=node-pty` loads node-pty lazily on selection; `--pty=fake` is the CI backend. TEST-755 pins
  the lazy `import('node-pty')` — this feature must not convert it to a static import; it makes that
  import RESOLVE on the remote by placing a matching module next to the agent.
- **No `SCHEMA_VERSION` bump expected** (no persisted-shape change — connection config unchanged; the
  prebuilt is a build artifact + a wire upload, not persisted app state). Confirm in spec.

## Explicit non-goals (candidate — brainstorm to confirm)

- No macOS/Windows-remote support (Remote Agent v1 = Linux remote only, decision carried from F19/F21).
- No on-remote compilation / `npm install` fallback in v1.
- No agent daemonization / session survival changes (unrelated; still F18/F20/open-question territory).
- No change to the running local app's behavior when no remote workspace is used.
- No renderer/preload import of `remote-client` (the scope guard stays).
- No new persisted app state / no `SCHEMA_VERSION` bump (to confirm).
- No real ssh, no real network, no real native build in tests.

## Open questions for brainstorm (phase 1)

1. **Prebuilt target set for v1:** linux-x64-glibc only, or also linux-arm64-glibc and/or musl? What
   is the no-match behavior's exact wording, and does arm64/musl ship now or as a fast-follow?
2. ~~What exactly gets uploaded for node-pty~~ **RESOLVED by verification 2026-07-05 — see
   "Verified: node-pty runtime require graph" below.** (Remaining sub-question for brainstorm: ship
   the whole `lib/` for safety vs the traced 5-file minimum — recommendation is the whole `lib/`.)
3. **glibc portability:** build prebuilts on an oldest-supported base (e.g. an old-glibc container)
   so they run on older hosts; decide the floor.
4. **libc detection method** on the remote (via the probe) that is robust and injection-safe.
5. **Integrity of the uploaded `.node`:** size-verify (as F19 does) — is a stronger checksum wanted?
6. **Artifact accumulation / GC** for the uploaded prebuilt (mirrors F19 FINDING-007).
7. **How CI produces the prebuilts** without breaking the windows-latest, no-build test lane
   (release-only build step vs a separate prebuild job vs vendored checked-in prebuilts).

## Verified: node-pty runtime require graph (2026-07-05, resolves open question #2)

Traced against the pinned `node-pty@1.1.0-beta34` in `node_modules/` (JS wrapper is
platform-identical; only the native binary differs per target). **The Linux remote needs exactly ONE
native file — no `spawn-helper`.**

**Native artifacts — Linux needs `pty.node` ONLY:**
- `lib/index.js:50` and `lib/unixTerminal.js:24` both `require('../build/Release/pty.node')` (same
  cached module) — the N-API addon. This is the ONE native file.
- `lib/unixTerminal.js:25` sets `helperPath = '../build/Release/spawn-helper'` and passes it to
  `pty.fork(...)`, BUT `spawn-helper` is **macOS-only**: `binding.gyp` builds the `spawn-helper`
  target only under `OS=="mac"` (lines 96–108), and `src/unix/pty.cc` execs it only under
  `#if defined(__APPLE__)` (lines 353–370). The `#else` branch (Linux) uses `forkpty()` + `execvp()`
  directly (lines 375–446) and NEVER touches `helper_path`. So an absent `spawn-helper` on Linux is
  fine — no second binary, no exec-bit/`chmod` step (the F19 `cat > tmp && mv` 0644 upload posture is
  sufficient for `pty.node`).
- `node-addon-api` is **build-time only** — a C++ `include_dir` in `binding.gyp` (lines 4, 53–54);
  `grep` finds zero `require('node-addon-api')` in `lib/`. It is NOT uploaded.

**Runtime JS closure on Linux (5 files):** `index.js` → `unixTerminal.js` → {`terminal.js`,
`utils.js`}; `terminal.js` → `eventEmitter2.js`; `eventEmitter2.js`/`utils.js` have no requires
(builtins `path`/`tty`/`events` aside). Everything else in `lib/` (`windows*.js`,
`conpty_console_list_agent.js`, `shared/conout.js`, `worker/`, `types.js`, `interfaces.js`, all
`.test.js`/`.map`) is never required on Linux — the Windows files are behind
`process.platform === 'win32'` guards.

**Minimal on-remote layout (paths are load-bearing — the requires are relative to `lib/`):**
```
~/.termhalla/agent/node_modules/node-pty/
├── package.json            # main: "./lib/index.js" — makes bare import('node-pty') resolve (CJS, no exports map)
├── lib/                    # ship the whole dir (RECOMMENDED, ~15 tiny files) or the traced 5-file minimum
│   ├── index.js
│   ├── unixTerminal.js
│   ├── terminal.js
│   ├── eventEmitter2.js
│   └── utils.js
└── build/Release/
    └── pty.node            # the ONE native prebuilt — the only per-target build artifact
```

**Consequences for the prebuilt matrix / CI:**
- The ONLY thing CI must build per-target is a single file, `build/Release/pty.node`.
- `pty.node` is N-API (`node-addon-api ^7`) → portable across ALL modern Node versions; the matrix
  is **(arch, libc)** only — `linux-x64-glibc`, `linux-arm64-glibc`, optional musl. No per-Node-ABI
  builds.
- Portability floor is **glibc version** (`pty.cc` links `-lutil`) → build the prebuilt on an
  oldest-supported glibc base (manylinux / Ubuntu-20.04-class container) so it runs on older hosts.
- The agent's lazy dynamic `import('node-pty')` (TEST-755) works unchanged — this feature only makes
  that specifier RESOLVE on the remote by placing the module next to the agent.
- OpsHub (x64 glibc) is unblocked by a single `linux-x64-glibc/pty.node`.

**Recommendation:** ship the whole `lib/` (a few extra KB; eliminates the risk of a missed lazy
`require` in a future node-pty bump; Windows files are inert on Linux) rather than hand-pruning to
the 5-file minimum. The per-target prebuilt remains just `pty.node`.
