# Remote node-pty prebuilt co-provisioning (F22 / 0023)

A released Termhalla installer ships a prebuilt native `node-pty` and the client
**co-provisions** it onto the remote host at connect time, so the agent's lazy
`import('node-pty')` (`src/agent/node-pty-backend.ts`, frozen TEST-755, unamended by this
feature) resolves on a stock `(linux, x64, glibc)` remote that has only `node` installed — zero
manual remote setup. Before this feature, `--pty=node-pty` failed with `ERR_MODULE_NOT_FOUND` on
any remote without a hand-installed node-pty (a real gap in [remote-agent](remote-agent.md)'s
"Pty backends" section). Feature dir: `.orky/features/0023-remote-node-pty-prebuilt`.

## Production and packaging (A)

- **Staging** (`scripts/stage-node-pty-prebuild.mjs`, pure core + thin CLI): given a built
  `pty.node` and the pinned node-pty package dir, produces
  `<prebuiltRoot>/node-pty/linux-x64-glibc/` containing `package.json`, the whole `lib/**`, and
  `build/Release/pty.node`, plus the manifest `.termhalla-prebuilt.json`
  (`{ formatVersion: 1, nodePtyVersion, target, ptyNodeSha256, files }` — `files` is a
  path→sha-256 map for **every** shipped file, read/hashed from actual bytes at generation time;
  `nodePtyVersion` is read from the source package's own manifest, never a source literal —
  CONV-058).
- **`release.yml`** gains a Linux job that builds the pinned node-pty version from source inside a
  container whose glibc is ≤ the v1 floor (**2.31**, `ubuntu:20.04`), smoke-loads the built
  `pty.node` under plain `node`, and hands the artifact to the packaging job, which runs the
  staging + **verification** script (`scripts/verify-node-pty-prebuild.mjs`) before `npm run
  package` — a missing/invalid bundle, any file's sha-256 not matching its manifest entry, or a
  version mismatch fails the release before publish. No `.node` binary is ever committed to the
  repo; `npm run package` locally (no prebuilts staged) still succeeds — the gate is a
  release-workflow step, falling to REQ-019's runtime diagnostic otherwise.
- **`electron-builder.yml`** ships the staged dir via `extraResources`:
  `out/agent/prebuilds` → `resources/agent/prebuilds` (same posture as the agent artifact).
- **`src/main/remote/agent-artifact.ts`** gains `resolvePrebuiltRoot(opts)`, the electron-free
  dev-vs-packaged resolver (`<appRoot>/out/agent/prebuilds` / `<resourcesPath>/agent/prebuilds`),
  wired into `services.ts` alongside the existing artifact/version wiring.

## The remote probe and provision decision (B, C)

`src/remote-client/prebuilt.ts` (pure — no socket, child process, or fs; the impure orchestration
lives in `bootstrap.ts`):

- **Probe.** `buildNodePtyProbeCommand(agentDir)` builds one `node -e '<PROBE_SRC>' <agentDir>`
  remote command (fixed, single-quote-free script; validated `agentDir`). It prints one sentinel
  line (`TERMHALLA_PROBE_V1 <json>`) reporting `platform`, `arch`, `glibc`, the parsed remote
  marker (or `null`), `resolves` (does the bare `node-pty` specifier resolve from `agentDir`?),
  **`actualPtyNodeSha256`** — the ground-truth sha-256 of the bytes *actually on disk* at
  `node_modules/node-pty/build/Release/pty.node`, never the marker's self-claimed value — and
  `node` (diagnostic). `classifyProbeOutcome`/`deriveLibc`/`selectPrebuiltTarget` turn the exec
  result into a `(platform, arch, libc)` triple and select the one v1 target row
  (`linux-x64-glibc`); every other triple is a `no-match`.
- **Decision** (`decideNodePtyProvision`): **skip** only when the target matches, the marker's
  version/target/sha all equal the local manifest, `resolves === true`, **and**
  `actualPtyNodeSha256` equals the local manifest's sha (the ground-truth gate — a
  torn/corrupted/deleted native binary under an intact marker forces **install**, i.e.
  self-repair, never a permanent wedge). **install** covers every other matched-target case;
  **proceed-unmanaged** honors a manually-installed node-pty on an unmatched triple (one
  diagnostic line, no upload); **no-match** fails the connect before any upload or launch, naming
  the detected triple, the shipped target, and the manual-install escape hatch.
- **Upload** (`decision === install`): the entire bundle streams over **one** additional ssh exec
  channel as `node -e '<UNPACK_SRC>' <agentDir> <nonce>`, payload `NODE_PTY_PAYLOAD_V1` (a JSON
  header `{ format, files: [{ path, size, sha256 }...], ptyNodeSha256 }` then the files'
  concatenated bytes — every entry's sha256 sourced from the local manifest, never
  self-computed from the sent bytes). The remote unpacker verifies every file's byte count and
  sha-256 (`pty.node` additionally against `ptyNodeSha256`) before promotion.
- **Promote** is transactional and **race-tolerant**: unpack + verify into a nonce-named temp dir,
  then **rename-first, no prior `rm`** into `node_modules/node-pty` (so a concurrently launching
  agent never observes the final dir absent). A rename collision reads the now-present marker: an
  **equal** sha is a benign lost race (own temp removed, exit 0 — another connect already
  installed the identical, verified bundle); a **different/absent** marker triggers exactly one
  remove-and-retry (the ordinary clean-reinstall path); a **second** collision on the retry means
  a genuinely concurrent divergent installer and exits **95** (destination left untouched,
  reconnect self-heals via the next probe/decision). Any other failure removes the temp dir and
  exits **93** (byte-count/short-read) or **94** (sha-256 mismatch on any file) — a collision is
  never reported as 93.

## Flow integration and recovery (D)

- **Strictly additive.** `BootstrapOptions.nodePty?: { prebuiltRoot: string }` — absent ⇒ the
  exec-channel sequence and every result are byte-identical to pre-0023 (all frozen F19/F21
  suites pass unmodified); `ptyBackend: 'fake'` ⇒ no probe/upload at all.
  `services.ts` always wires `nodePty.prebuiltRoot` from `resolvePrebuiltRoot`.
- **Per connect:** at most ONE probe + ONE install baseline. If co-provisioning ran and the agent
  launch still dies before hello with a node-pty module-resolution stderr, exactly **one recovery
  cycle** runs (re-probe → re-decide → at most one more install → one relaunch); a second failure
  is terminal, with wording that states what this connect *actually* did (never "an install was
  applied" on a skip path).
- **glibc-floor hint.** Any pre-hello launch fatal whose sanitized stderr matches a
  `GLIBC_<x.y>' not found` pattern gets the floor (2.31) + manual-install hint appended,
  independent of the module-resolution detector, and never triggers the recovery cycle
  (reinstalling the same binary can't fix an old glibc).
- **Cancellation.** The caller's existing `AbortSignal` covers the probe and the install
  (including the recovery cycle); abort before a spawn or during the read-only probe is a
  determinate `aborted`; abort mid-install is `aborted, indeterminate: true` (the remote holds
  either the previous install, none, or the complete verified one — never a tear).
- **Bounded probe channel** (REQ-026): the client retains only a bounded trailing window of probe
  stdout and settles as soon as a parseable sentinel line decodes — tearing the ssh child down
  rather than waiting for stream end — so an endless-stdout remote can't wedge the connect or grow
  memory unboundedly.

## Preserved invariants (E)

- No `SCHEMA_VERSION` bump, no new persisted store, no secrets — manifests/markers hold only
  version/target/path/hash strings.
- `src/remote-client/` stays electron/ssh-library/`shell: true`-free (frozen TEST-2001..2006 pass
  unmodified); the upload file set is enumerated **dynamically** (recursive readdir of the staged
  bundle dir) — no hard-coded file list, no `package.json` string literal in the source.
- `tests/fixtures/fake-ssh.mjs` (a frozen F20 fixture) was sanctionedly amended to recognize the
  new probe/install command shapes and gained env-driven rigs for truncation/corruption/
  rc-noise/oversized-stdout/rigged-launch-stderr/self-repair scenarios — existing F19/F21/
  integration suites still pass unedited.
- The CI lane (`ci.yml`) is untouched — every new test runs under plain `npm test` with no build,
  docker, real ssh/network, or native compilation (stub modules + the fake-ssh shim only).

## Public interface

- `src/remote-client/prebuilt.ts`: `buildNodePtyProbeCommand`, `parseProbeStdout`,
  `classifyProbeOutcome`, `deriveLibc`, `selectPrebuiltTarget`, `decideNodePtyProvision`,
  `buildNodePtyInstallCommand`, `encodeNodePtyPayload`; constants `PREBUILT_TARGETS_V1`,
  `NODE_PTY_MARKER_FILE`, `NODE_PTY_BYTES_EXIT` (93), `NODE_PTY_SHA_EXIT` (94),
  `NODE_PTY_RACE_EXIT` (95), the probe sentinel prefix and stdout cap.
- `src/remote-client/bootstrap.ts`: `BootstrapOptions.nodePty?: { prebuiltRoot: string }`
  (additive); the co-provisioning gate is `runCoProvisionPass` (+ `runNodePtyProbe`/
  `runNodePtyInstall`), invoked from `connectWithProvisioning` before the existing F19
  connect/provision-once flow.
- `src/main/remote/agent-artifact.ts`: `resolvePrebuiltRoot(opts: ArtifactPathOpts): string`.
- `scripts/stage-node-pty-prebuild.mjs`, `scripts/verify-node-pty-prebuild.mjs`: unit-testable
  pure cores, invoked by `release.yml`.

## Known limitations / deferred

Deferred at the human-review boundary (non-blocking LOW/MEDIUM; the HIGH findings — ground-truth
skip verification, race-tolerant promote, bounded probe, always-reachable glibc hint, whole-payload
integrity — were fixed in-band through two spec loopbacks, ESC-001/002 and ESC-003):
[`docs/superpowers/0023-remote-node-pty-prebuilt-review-followups.md`](../superpowers/0023-remote-node-pty-prebuilt-review-followups.md).
Notably: the remote install path is an unversioned shared `node_modules/node-pty` (unlike the
version-scoped agent artifact, so two app versions pinning different node-pty versions sharing a
host+agentDir will clean-reinstall each other rather than reach the idempotent skip steady state);
the exit-94 client diagnostic names `pty.node` even when the actual failing file is a `lib/*.js`
entry; and a handful of quality/duplication cleanups (a stale `coProvisionNodePty` doc-comment
reference, inconsistent spawn-failure wording, a duplicated bundle-dir walker).
