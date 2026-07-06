# Plan — 0023-remote-node-pty-prebuilt

**Phase:** 3 (plan). **Date:** 2026-07-06 (re-propagated after the FINDING-020 + robustness-cluster
loopback, ESC-003, amended `02-spec.md`: REQ-008/012/014/015/016/020/021 amended, REQ-026 added).
**Input:** `02-spec.md` (REQ-001..026). No baseline architecture touch (baseline REQ-001..024 predate
the remote stack). **Prior-pass note:** an earlier implementation pass already landed
`src/remote-client/prebuilt.ts` and the `bootstrap.ts` co-provision flow for the pre-ESC-003 spec
(confirmed by reading the current tree: `NODE_PTY_RACE_EXIT`, `encodeNodePtyPayload`,
`glibcFloorHint`, and the unbounded `runNodePtyProbe` stdout accumulator all exist today, but NONE of
the ESC-003 amendments — `actualPtyNodeSha256`, per-file payload/manifest hashes, rename-first
promote, the single recovery cycle, decoupled GLIBC hint, or the bounded/early-settling probe — are
present yet). Every task below that touches an existing file is therefore a **modification** task
against real code, not a fresh design; tasks are written that way so phase 4/5 know exactly what to
change and what to leave alone.

This is an additive feature: one pure module (`src/remote-client/prebuilt.ts`, already created, now
extended), two build scripts, small additions to three existing files, one CI workflow restructure,
and a sanctioned amendment to the frozen fake-ssh fixture (owned by the tests phase per REQ-025,
listed here only for traceability completeness).

## Target file/module layout

```
scripts/
  stage-node-pty-prebuild.mjs      # MODIFY (ESC-003) — per-file `files` map (REQ-001)
  verify-node-pty-prebuild.mjs     # MODIFY (ESC-003) — verify EVERY file's sha (REQ-003)
src/main/remote/
  agent-artifact.ts                # unchanged this pass — resolvePrebuiltRoot (REQ-005) already covered
src/main/
  services.ts                      # unchanged this pass — nodePty.prebuiltRoot wiring (REQ-018) already covered
src/remote-client/
  prebuilt.ts                       # MODIFY — actualPtyNodeSha256 (REQ-008), ground-truth decision
                                     # (REQ-012), per-file payload/manifest hashing (REQ-014), rename-
                                     # first promote (REQ-015), decoupled glibcFloorHint (REQ-021),
                                     # bounded trailing-stdout accumulator (REQ-026)
  bootstrap.ts                     # MODIFY — single recovery cycle (REQ-016), settle-on-sentinel +
                                     # bounded probe wiring (REQ-026), GLIBC hint applied independently
                                     # of module-resolution detection (REQ-021), honest terminal
                                     # wording (REQ-016)
.github/workflows/
  release.yml                      # unchanged this pass — Linux build + verify gate (REQ-002/003/006/007) already covered
electron-builder.yml               # unchanged this pass — extraResources (REQ-004) already covered
tests/fixtures/
  fake-ssh.mjs                     # MODIFIED (tests phase, REQ-025) — new rigs: self-repair
                                     # (corrupted-on-disk-under-intact-marker), GLIBC-class launch
                                     # stderr, oversized/unbounded probe stdout, module-resolution
                                     # launch-failure-then-recovery
  node-pty-stub/ (or similar)      # fixture (tests phase, REQ-020) — pure-JS node-pty-surface stub,
                                     # now also exercised by the flow-level concurrency vector
```

## Tasks

### TASK-001 — Prebuilt staging core + CLI script (MODIFY: per-file `files` map)
**Files:** `scripts/stage-node-pty-prebuild.mjs`
**Description:** Pure, injectable staging function: given a source node-pty package dir + built
`pty.node` bytes, produce the REQ-001 bundle layout (`.termhalla-prebuilt.json`, `package.json`,
`lib/**`, `build/Release/pty.node`), compute `ptyNodeSha256` from actual bytes, read
`nodePtyVersion` from the source package's own manifest at generation time, stamp `target` +
`formatVersion: 1`. **ESC-003 amendment:** additionally enumerate EVERY staged file (deterministically
ordered) and compute a `files` map of relative-path → lowercase-hex sha-256 of that file's actual
bytes (manifest file itself excluded from its own map). Specific, actionable errors
(CONV-001/CONV-002) for empty/missing source dir and missing `pty.node`. Thin CLI wrapper unchanged.
**Dependencies:** none.
**Satisfies:** REQ-001, REQ-006 (read-at-generation half).

### TASK-002 — Prebuilt verification core + CLI script (MODIFY: verify every file's sha)
**Files:** `scripts/verify-node-pty-prebuild.mjs`
**Description:** Pure verification function taking a staged bundle dir + the pinned version and
asserting: every REQ-001 file present, `ptyNodeSha256` matches the staged `pty.node` bytes,
`nodePtyVersion` equals the pinned version. **ESC-003 amendment:** additionally assert (a) the
`files` map's key set equals exactly the staged file set, and (b) EVERY staged file's actual sha-256
matches its `files` entry — catching an equal-byte-length content substitution in any non-native file
(the FINDING-005 attack shape), not only `pty.node`. Non-ok result names the failing check + path
(CONV-001). CLI wrapper exits non-zero for the release-workflow gate (never baked into
`npm run package` — REQ-003's local/dev-must-still-succeed rule).
**Dependencies:** TASK-001 (shares the bundle-layout constants/shape, including the `files` map type).
**Satisfies:** REQ-003.

### TASK-003 — Prebuilt-root path resolver
**Files:** `src/main/remote/agent-artifact.ts`
**Description:** Unchanged this pass. `resolvePrebuiltRoot(opts: ArtifactPathOpts): string` (dev →
`<appRoot>/out/agent/prebuilds`; packaged → `<resourcesPath>/agent/prebuilds`) — already covers
REQ-005 as spec'd; ESC-003 introduced no change here.
**Dependencies:** none.
**Satisfies:** REQ-005.

### TASK-004 — Release-time Linux prebuilt build job
**Files:** `.github/workflows/release.yml`
**Description:** Unchanged this pass. Linux-runner job (glibc-2.31-floor container), reads the pinned
node-pty version via `node -p`, builds from source (no Windows Spectre/NDEBUG patch — ELF build),
extracts `build/Release/pty.node`, smoke-loads it under plain `node` (REQ-007), uploads as a workflow
artifact.
**Dependencies:** none.
**Satisfies:** REQ-002, REQ-006 (workflow half), REQ-007.

### TASK-005 — Packaging-job verification gate
**Files:** `.github/workflows/release.yml`
**Description:** Unchanged this pass in shape; consumes TASK-001/TASK-002's now-extended `files`-map
staging/verification transparently (same CLI invocation, richer check). Download the TASK-004
artifact, run staging (TASK-001) into `out/agent/prebuilds/node-pty/linux-x64-glibc/`, run
verification (TASK-002) — failing before `npm run package` on any absent/invalid bundle. Ordering
pinned: verify → package → publish. Repo-hygiene guard: no tracked `*.node` outside `node_modules`.
**Dependencies:** TASK-001, TASK-002, TASK-004.
**Satisfies:** REQ-002 (ordering + hygiene), REQ-003 (workflow enforcement).

### TASK-006 — Installer ships prebuilds via extraResources
**Files:** `electron-builder.yml`
**Description:** Unchanged this pass. `extraResources` mapping `out/agent/prebuilds` →
`agent/prebuilds`, additive to the existing agent-artifact entry.
**Dependencies:** none.
**Satisfies:** REQ-004.

### TASK-007 — Probe command builder + output parser (MODIFY: ground-truth hash field)
**Files:** `src/remote-client/prebuilt.ts`
**Description:** `buildNodePtyProbeCommand(agentDir)` unchanged in shape. **ESC-003 amendment to
`PROBE_SRC`/`parseProbeStdout`:** the embedded script MUST additionally read the actual bytes at
`<agentDir>/node_modules/node-pty/build/Release/pty.node` via `node:crypto` and emit
`actualPtyNodeSha256` (lowercase hex sha-256, or `null` when the file is absent/unreadable) as a
seventh sentinel-JSON field — the GROUND-TRUTH hash, computed independently of whatever the marker
claims. `parseProbeStdout` must surface this field on the parsed result type. No interpolated data,
no single-quote, `agentDir` validated exactly as before.
**Dependencies:** none (foundational module for the rest of part B/C).
**Satisfies:** REQ-008, REQ-022 (module placement/import discipline).

### TASK-008 — Probe outcome classifier
**Files:** `src/remote-client/prebuilt.ts`
**Description:** Unchanged this pass. `classifyProbeOutcome(observation)`: exit 255 → fatal transport;
exit 127 → fatal "no node on PATH"; no parseable sentinel line → fatal rc-noise hint; otherwise →
parsed probe result (now carrying `actualPtyNodeSha256` per TASK-007, passed through unmodified by
the classifier).
**Dependencies:** TASK-007.
**Satisfies:** REQ-009.

### TASK-009 — libc determination
**Files:** `src/remote-client/prebuilt.ts`
**Description:** Unchanged. `deriveLibc(probe)`: non-empty `glibc` string ⇒ `'glibc'`; else ⇒
`'non-glibc'`.
**Dependencies:** TASK-007.
**Satisfies:** REQ-010.

### TASK-010 — Prebuilt target selection
**Files:** `src/remote-client/prebuilt.ts`
**Description:** Unchanged. `selectPrebuiltTarget(triple)` + `PREBUILT_TARGETS_V1` (one row:
`(linux, x64, glibc)` ⇒ `'linux-x64-glibc'`; else no-match echoing the triple).
**Dependencies:** TASK-009.
**Satisfies:** REQ-011.

### TASK-011 — Provision decision table (MODIFY: ground-truth skip gate, self-repair)
**Files:** `src/remote-client/prebuilt.ts`
**Description:** `decideNodePtyProvision(probe, target, localManifest)` implementing the four-way
outcome (skip / install / proceed-unmanaged / no-match). **ESC-003 amendment:** the **skip** branch
now ALSO requires `probe.actualPtyNodeSha256 === localManifest.ptyNodeSha256` (ground truth — never
trust the marker's claim alone); the **install** branch now ALSO fires when `actualPtyNodeSha256` is
`null` or differs from the local manifest sha even though the marker and `resolves` both check out —
this is the self-repair path for a torn/corrupted/hand-damaged on-disk binary under an intact marker
(no more permanent skip→launch-fail wedge). `proceed-unmanaged`/`no-match` logic unchanged.
**Dependencies:** TASK-010.
**Satisfies:** REQ-012.

### TASK-012 — No-match fatal diagnostic
**Files:** `src/remote-client/prebuilt.ts`
**Description:** Unchanged. Diagnostic builder for the no-match decision naming detected
platform/arch/libc, the `linux-x64-glibc`-only shipped target, and the manual-install escape hatch.
**Dependencies:** TASK-011.
**Satisfies:** REQ-013.

### TASK-013 — Install command + payload encoder (MODIFY: per-file sha in header)
**Files:** `src/remote-client/prebuilt.ts`
**Description:** `buildNodePtyInstallCommand(agentDir, nonce)` unchanged in shape. **ESC-003 amendment
to `encodeNodePtyPayload`:** the header line becomes
`{ format: 1, files: [{ path, size, sha256 }...], ptyNodeSha256 }` — each entry's `sha256` sourced
from the local manifest's `files` map (TASK-001's new field), not size-only. Client-side header
`path` validation unchanged (relative, no leading `/`, no `\`, no `..`, charset-limited). The upload
file set is still enumerated dynamically by the caller (`bootstrap.ts`) at call time; `prebuilt.ts`
itself never names `package.json` literally (REQ-022/TEST-2004 discipline preserved).
**Dependencies:** TASK-007 (shares validation helpers/constants), TASK-001 (the `files`-map shape the
encoder consumes).
**Satisfies:** REQ-014.

### TASK-014 — Remote unpacker script (MODIFY: verify every file's sha; rename-first, no prior rm)
**Files:** `src/remote-client/prebuilt.ts` (the `UNPACK_SRC` literal, executed remotely by the
target host's `node`)
**Description:** The `UNPACK_SRC` script: re-validates header paths server-side before any write;
writes into `<agentDir>/node_modules/node-pty.<nonce>.tmp` only; verifies every file's byte count
(short-read ⇒ remove temp, exit `NODE_PTY_BYTES_EXIT = 93` naming the failing file + observed vs
expected byte count). **ESC-003 amendment (FINDING-005):** computes sha-256 via `node:crypto` of
EVERY received file (not only `pty.node`) and compares each to that file's own header `sha256`
(`pty.node` additionally required to equal the header's top-level `ptyNodeSha256`) BEFORE promotion —
mismatch on ANY file ⇒ remove temp, exit `NODE_PTY_SHA_EXIT = 94` naming the specific failing file +
observed vs expected sha. Writes the marker file (manifest content) inside the temp dir.

**ESC-003 amendment (FINDING-021) — rename-first promote, no prior rm:** the commit step is now
`rename(tmp, final)` attempted DIRECTLY with no preceding removal of any existing `node-pty` dir (the
old rm-then-rename left the final dir transiently ABSENT, observable by a concurrently launching
agent's `import('node-pty')` as a spurious `ERR_MODULE_NOT_FOUND`).
1. Rename success ⇒ exit 0 (the final dir was never removed — no absence window).
2. On a collision (`ENOTEMPTY`/`EEXIST`/platform-equivalent, e.g. `EPERM` under the Windows
   local-node test harness): read the now-present final dir's marker, compare its `ptyNodeSha256` to
   the payload header's sha — equal ⇒ benign lost race: remove own temp, exit 0 (final dir untouched,
   never removed); absent/unparseable/different ⇒ THIS is now the ordinary clean-reinstall path:
   remove the final dir and retry the rename exactly once. Retry success ⇒ exit 0.
3. Second collision on the retry ⇒ genuinely concurrent divergent promoter: remove own temp, leave
   the destination alone, exit `NODE_PTY_RACE_EXIT = 95` with a one-line stderr naming the original
   rename error code + expected vs observed marker sha (or its absence). A collision is NEVER
   reported as 93.

Invariants to uphold end-to-end (each with its own acceptance vector, per ESC-001's adopted rule —
never prose-only): the final path never holds a partial/unverified install; the final path is never
observed absent by a concurrent reader except during the sanctioned replace of a non-matching
install; a marker at the final path implies a complete sha-verified install AT PROMOTE TIME (REQ-012
re-establishes ground truth every connect — the marker is never trusted across connects); no stale
temp dirs accumulate; two racing connects installing the identical payload both exit 0 with the
final dir intact; a divergent racer's loser exits 95, never 93.
**Dependencies:** TASK-013 (shares the extended payload wire format).
**Satisfies:** REQ-015.

### TASK-015 — `BootstrapOptions.nodePty` additive field + fake-backend bypass
**Files:** `src/remote-client/bootstrap.ts`
**Description:** Unchanged this pass. Optional `nodePty?: { prebuiltRoot: string }` field; absent ⇒
byte-identical existing behavior; `ptyBackend: 'fake'` ⇒ co-provision block skipped entirely.
**Dependencies:** TASK-007..014 exist (types/functions to call).
**Satisfies:** REQ-018.

### TASK-016 — Co-provisioning flow in `connectWithProvisioning` (MODIFY: recovery cycle, decoupled
GLIBC hint, honest wording, REQ-026 wiring)
**Files:** `src/remote-client/bootstrap.ts`
**Description:** When `nodePty` present and `ptyBackend === 'node-pty'`: probe (TASK-007, now via the
bounded/early-settling runner — TASK-020) → classify (TASK-008) → derive libc (TASK-009) → select
target (TASK-010) → read+validate the LOCAL manifest (missing/invalid ⇒ fatal per REQ-019, probe-only
ledger) → decide (TASK-011, now ground-truth-gated) → skip/no-match(TASK-012, fatal,
no launch/upload)/proceed-unmanaged(one diagnostic, continue)/install (TASK-013/014 over one exec
channel). On install result: exit 0 ⇒ proceed (fresh install or benign lost race); 93/94/95 ⇒
distinctly-worded fatals (93 "truncated"/byte-count, 94 "checksum"/sha naming the specific file, 95
"concurrent-install collision" + reconnect-not-retry advice, never blaming the transfer); other
non-zero ⇒ generic install-failed fatal.

**ESC-003 amendment — single recovery cycle (REQ-016):** if co-provisioning ran this connect (skip OR
install) and the subsequent agent launch still dies before hello with sanitized stderr matching the
node-pty MODULE-RESOLUTION failure class (never the GLIBC class), perform exactly ONE recovery cycle:
re-probe → re-decide (TASK-011, sees whatever a racing connect left behind) → at most one further
install if required → relaunch once. Relaunch reaching hello ⇒ connect succeeds. A second failure ⇒
terminal fatal whose wording states what THIS connect actually did: "a node-pty install was applied
(and re-verified on a second probe)" only when an install actually ran this connect; on a pure
skip/skip path, wording that a previously installed node-pty was found and verified on disk yet the
agent still could not load it, plus the escape hatch (remove
`<agentDir>/node_modules/node-pty` and reconnect). Hard cap: at most TWO probes, TWO installs, TWO
launches per connect attempt, ever. Runs BEFORE the existing F19 agent-provision-once retry (unchanged
ordering).

**ESC-003 amendment — glibc-floor hint decoupled + MUST (REQ-021):** ANY pre-hello agent-launch fatal
whose sanitized stderr matches a `GLIBC_<x.y>' not found`-class pattern gets the 2.31-floor +
escape-hatch hint appended, evaluated INDEPENDENTLY of (not gated behind) the module-resolution
failure detector — and a GLIBC-class failure MUST NOT trigger the REQ-016 recovery cycle (reinstalling
the same binary cannot help an old glibc).

Cancellation (REQ-017) unchanged: caller's `AbortSignal` covers the probe, the install, AND now the
recovery cycle's re-probe/re-install/relaunch; pre-spawn abort ⇒ determinate `aborted`; probe abort ⇒
determinate `aborted`; mid-install abort ⇒ `aborted` with `indeterminate: true` + either-or wording
(a 95 outcome is remote-side/post-transfer and never itself an abort observation). No
`SCHEMA_VERSION`/persisted-state/Electron `userData` touch anywhere (REQ-023).
**Dependencies:** TASK-007..015, TASK-020.
**Satisfies:** REQ-016, REQ-017, REQ-019, REQ-021, REQ-023 (this module's own invariant).

### TASK-017 — Composition-root wiring
**Files:** `src/main/services.ts`
**Description:** Unchanged this pass. Passes `nodePty: { prebuiltRoot: resolvePrebuiltRoot(...) }`
(TASK-003) alongside existing version/artifact wiring.
**Dependencies:** TASK-003, TASK-015.
**Satisfies:** REQ-018 (structural check).

### TASK-018 — fake-ssh fixture amendment (tests-phase-owned)
**Files:** `tests/fixtures/fake-ssh.mjs`
**Description:** Per REQ-025 this frozen 0020 fixture is amended THROUGH the tests phase (CONV-012
co-ownership). Recognize the TASK-007 probe shape (now emitting `actualPtyNodeSha256`) and the
TASK-013/014 install shape (per-file sha payload; may execute the embedded `node -e` scripts with
local node for fidelity, including the rename-first promote path). Log `probe`/`node-pty-install`
kinds to `FAKE_SSH_LOG`. **ESC-003 additions:** env-driven rigs for (a) a pre-seeded remote install
whose marker matches the local manifest and whose JS resolves, but whose on-disk `pty.node` bytes are
corrupted/truncated (the REQ-012 self-repair fixture), (b) a launch that dies with rigged stderr in
either the module-resolution class (drives the REQ-016 recovery-cycle vectors) or the GLIBC class
(drives the REQ-021 no-recovery vector), and (c) an unbounded/oversized probe stdout stream (drives
REQ-026). Existing rigs (synthesized non-win32 triple, install truncation →93, `pty.node` corruption
→94, probe stdout rc-noise) stay byte-identical. Remains network-module-free and POSIX-shell-free
(TEST-2006 stays green).
**Dependencies:** TASK-007, TASK-011, TASK-013, TASK-014, TASK-020 (needs the real command
shapes/behavior to mirror).
**Satisfies:** REQ-025, REQ-024 (this fixture's contribution to the native/build-free lane).

### TASK-019 — REQ-020 end-to-end fixture + flow-level concurrency vector (MODIFY: mandated
concurrency vector)
**Files:** a test fixture under `tests/fixtures/` (stub node-pty package dir + a script producing a
matching prebuilt bundle) — no `src/agent/` diff, no `src/remote-client` production-code change
beyond TASK-007..016.
**Description:** Fixture target bundle whose `lib/` is a pure-JS stub implementing the node-pty
surface the agent touches (spawn/write/resize/kill/pause/resume/onData/onExit — scripted echo) and
whose `pty.node` is arbitrary bytes matching the fixture manifest's sha (now including the `files`
map, TASK-001), for the integration test that builds the real agent bundle on demand and drives
`connectWithProvisioning({ ptyBackend: 'node-pty', ... })` through fake-ssh to a hello + one
`pty:spawn`/`pty:data` round trip. **ESC-003 amendment:** ALSO drive two overlapping
`connectWithProvisioning` calls against the SAME fresh fake home, deterministically interleaved so
their probe/install/launch windows overlap, asserting BOTH reach hello, the remote holds exactly one
final install equal to the shipped bundle, and no `*.tmp` dir remains (the flow-level counterpart to
TASK-014's unpacker-level concurrency vector). `TEST-755` and the agent bundle content stay untouched.
**Dependencies:** TASK-016, TASK-018.
**Satisfies:** REQ-020.

### TASK-020 — Bounded, early-settling probe stdout accumulator (NEW — REQ-026)
**Files:** `src/remote-client/prebuilt.ts` (a pure, exported, injectable trailing-window accumulator
+ a sentinel-line-detection predicate reusable by the runner) and `src/remote-client/bootstrap.ts`
(rewires `runNodePtyProbe`'s `child.stdout.on('data', ...)` handler, which today appends to an
UNBOUNDED `stdout` string and only classifies on `child.on('exit', ...)`).
**Description:** Export a named, documented probe-stdout cap constant (order 64 KiB) and a pure
accumulator function that retains only the trailing `cap` chars as data arrives (discarding older
bytes on overflow) — this becomes the seam a unit test drives directly. Wire `runNodePtyProbe` to (a)
feed each stdout chunk through the bounded accumulator instead of unbounded string concatenation, and
(b) on EVERY chunk, attempt to parse a sentinel line out of the current bounded window; the moment a
parseable sentinel line is found, settle immediately with the parsed probe result and tear the ssh
child down (`kill()` + destroy the three streams — the existing `settle()` teardown path, just
triggered from `data` instead of only from `exit`) rather than waiting for the stream/process to end.
A sentinel-less stream that ends (or is torn down for another reason) still classifies via the
existing exit-path fallback per REQ-009's rc-noise row, with any stdout excerpt in that diagnostic
bounded by the same cap.
**Dependencies:** TASK-007 (parses/detects the same sentinel prefix), TASK-008 (classification
fallback on stream end), TASK-016 (the runner this rewires).
**Satisfies:** REQ-026.

## Open issues

None — every REQ has ≥1 TASK. REQ-006's structural "no version literal under `src/`/`scripts/`" half
and REQ-022/023/024's "nothing regressed" halves are enforced by discipline within TASK-001, TASK-007,
and TASK-016/018 respectively rather than dedicated new production code — expected for "preserved
invariant" requirements. This pass re-propagates the ESC-003/FINDING-020-cluster amendments (ground-
truth skip/self-repair, per-file payload+manifest integrity, rename-first promote, single recovery
cycle + honest wording, decoupled MUST glibc hint, bounded/early-settling probe — REQ-008/012/014/
015/016/020/021 amended, REQ-026 added) into TASK-001/002/007/011/013/014/016/018/019 and the new
TASK-020; TASK-003/004/005/006/009/010/012/015/017 are unchanged from the prior plan pass (their
requirements had no ESC-003 amendment).
