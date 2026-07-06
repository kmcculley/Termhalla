# Tests — 0023-remote-node-pty-prebuilt

**Phase:** 4 (tests). Test-id block: **TEST-2301..TEST-2399** (feature-number-keyed, the
0016..0022 convention; repo-wide grep `TEST-23[0-9][0-9]` had zero hits at first authoring time;
the block's stated ceiling was raised 2380→2399 in the loopback-3 re-cut purely to keep numbering
room — no id above TEST-2382 is used).

**RE-CUT (loopback 1):** the tests phase re-ran after the FINDING-013 / ESC-001 / ESC-002
loopback amended REQ-015 (race-tolerant idempotent promote; sentinel exit **95**; a mandatory
concurrency acceptance vector). That pass added TEST-2360/2362/2363/2364 + the
`npty-race-interpose.cjs` harness fixture and amended TEST-2334 + the fake-ssh shim.

**RE-CUT (loopback 2):** the tests phase re-ran again after the FINDING-020 +
robustness-cluster (017/021/010/009/005) loopback, ESC-003, amended
REQ-001/003/008/012/014/015/016/020/021 and added REQ-026. This pass ADDS
TEST-2365..TEST-2379 (15 new tests) and amends, through the sanctioned tests-phase path the
spec's collision survey mandates, this feature's OWN frozen artifacts:
TEST-2310 (+`files` whitelist), TEST-2330 (+ground-truth skip rows), TEST-2332 (+per-entry
sha256 header), TEST-2335/2336 (7-field probe), TEST-2338/2340/2341/2342 (per-entry-sha payload
shape ride-along), TEST-2349 (superseded exactly-one wording → the recovery-cycle install-honesty
vector), TEST-2352 (determinism hardening only: the mid-install abort now triggers on the
OBSERVED stalled install channel — the ledger line — instead of a wall-clock 300 ms that
provably races this box's ~250 ms probe leg; semantics unchanged), TEST-2360 (+the
loser-never-removes-final observation), TEST-2362/2363 (first-collision-95 superseded → 95 only
for a divergence PERSISTING through the single replace retry), TEST-2364 (persistent rig),
TEST-2359 (fixture manifest gains the `files` map), plus `tests/fixtures/fake-ssh.mjs` and
`tests/fixtures/npty-race-interpose.cjs` (below). Every other test is byte-identical to the
previously frozen cut.

**RE-CUT (loopback 3 — THIS pass):** a targeted tests-loopback (review → tests, 2026-07-06,
ESC-004) after FINDING-022 + FINDING-024 (both CONTRACT / REQ-014): the loopback-2
implementation's payload builder carried a `?? self-compute` sha fallback
(`src/remote-client/bootstrap.ts`, the `walkBundleDir(...).map(...)` sha sourcing) and its
`readLocalManifest` accepted ANY typeof-object `files`, so a bundle file missing from — or
tampered and deliberately dropped from — the manifest map shipped under a sha computed from its
OWN bytes, which the remote unpacker then "verified" against itself: manifest-sourced integrity
defeated end-to-end. The spec is UNCHANGED this pass (no REQ amended; the ESC-004 decision
completes REQ-014's existing "each entry's `sha256` sourced from the local manifest's `files`
map" MUST and lands in REQ-019's malformed-manifest fatal class). This pass ADDS exactly the
three client-side acceptance vectors the human decision mandated — **TEST-2380** (the
FINDING-022 attack shape: a tampered + unmapped bundle file ⇒ a pre-upload fatal, never a
self-computed-sha upload), **TEST-2381** (a ghost `files` key ⇒ the same fatal — parity is
BIDIRECTIONAL, mirroring the release gate's verification), **TEST-2382** (a malformed `files`
field: an array / an empty-string sha ⇒ the same fatal, never mirrored as a remote 94-shaped
checksum failure) — appended to `tests/node-pty-provision-flow.test.ts` (plus that file's header
note). Every other test file, the fake-ssh shim, the interposer, and the committed fixtures are
byte-identical to the loopback-2 cut.

**Producer note:** test-designer ran driver-inline (the 0016..0022 precedent). The implementer
is a different dispatch. The suite runs **RED** today (loopback-3 pass, verified 2026-07-06):
`npx vitest run tests/node-pty-provision-flow.test.ts` exits non-zero with EXACTLY the three new
tests failing — each at its FIRST assert, because against the current working tree the connect
SUCCEEDS: the `??` fallback hashes the tampered/unmapped file's own bytes and uploads it
(TEST-2380), a ghost map key is silently ignored (TEST-2381), and an array / empty-string-sha
`files` passes the typeof-object check into either a full connect or a mis-classed remote 94
(TEST-2382) — the FINDING-022/024 defects verbatim. All 24 pre-existing tests in that file pass
unamended, and no other test file was touched this pass (the loopback-2 producer note's per-file
sweep verdicts stand for them; the loopback-2 implementation is green in the tree). The
environment caveat from the loopback-2 note still applies: this sandbox intermittently kills ANY
node/vitest process with a libuv `new_time >= loop->time` assertion (a machine-level clock
flake, not a test outcome — re-run).

## Sanctioned frozen-fixture amendments (REQ-025, CONV-012)

`tests/fixtures/fake-ssh.mjs` (frozen 0020 fixture) was re-amended THROUGH the loopback-2 tests
phase (byte-identical in the loopback-3 pass — the ESC-004 vectors need no new rig: they fail
client-side, before any ssh channel):

- Recognizes the two wire shapes — the REQ-008 probe and the REQ-014 install, both
  `node -e '<single-quote-free script>' <args…>` — and executes the embedded script with the
  LOCAL node (fidelity). Existing launch/upload handling is byte-identical.
- Logs the kinds `probe` / `node-pty-install` to `FAKE_SSH_LOG`.
- Pre-existing rigs (byte-identical this pass): `FAKE_SSH_PROBE_TRIPLE` (synthesized triple;
  marker/resolves/actual-hash stay REAL), `npty-truncate:<n>` (→ 93), `npty-corrupt` (→ 94),
  `npty-stall-install` (mid-install abort), `npty-probe-noise` (rc noise around the sentinel).
- **Added in the ESC-003 (loopback 2) pass:**
  - `npty-preseed-corrupt` — flips one byte of the ON-DISK remote pty.node (marker intact)
    right before the REAL probe runs: the REQ-012 self-repair fixture (FINDING-020).
  - `npty-launch-die:modfail` / `npty-launch-die-once:modfail` / `npty-launch-die:glibc` —
    a launch dies before hello (exit 1) with rigged stderr of the module-resolution or the
    GLIBC class; `-once` dies only on the first launch (state file in the fake home) — the
    REQ-016 recovery-cycle and REQ-021 no-recovery rigs.
  - `npty-probe-endless` — the real sentinel, then unbounded stdout (self-bounded at 120 s so
    a broken client fails fast instead of hanging the suite) — REQ-026 settle-on-sentinel.
  - `npty-probe-flood` — ~200 KiB of sentinel-LESS stdout, exit 0 — REQ-026 bounded rc-noise.
  - `npty-race-divergent` re-armed: now preloads the interposer with `NPTY_INTERPOSE_EVERY`
    (persistent divergence) because the amended rename-first promote REPAIRS a one-shot
    divergent collision — only a reappearing divergence is a genuine 95.
- Still network-module-free (TEST-2006 passes) and POSIX-shell-free.

`tests/fixtures/npty-race-interpose.cjs` (this feature's loopback-1 fixture, re-amended in
loopback 2; byte-identical in the loopback-3 pass):

- All three rename APIs still interposed; `NPTY_INTERPOSE_SRC` / `NPTY_INTERPOSE_MODE=divergent`
  unchanged.
- `NPTY_INTERPOSE_EVERY=1` re-injects before EVERY node-pty-destination rename (the
  persistent divergent racer — the loser's replace retry cannot win ⇒ 95), and
  `NPTY_INTERPOSE_LOG=<file>` appends an observe-only `{op:'rename'|'rm', path}` line for every
  rename/removal whose target basename is `node-pty` (removal APIs wrapped for OBSERVATION
  only) — the seam TEST-2360/TEST-2372 read to prove reader-atomicity (rename-first, no blind
  prior rm; an identical-install loser never removes the final dir).

Committed fixtures (unchanged): `tests/fixtures/node-pty-stub/` — the pure-JS `node-pty`
package (version `0.0.0-stub`) implementing exactly the surface `src/agent/node-pty-backend.ts`
touches; emits `stub-ready\n` on spawn.

## Frozen contract choices (the implementer builds to these)

- `src/remote-client/prebuilt.ts` exports: `buildNodePtyProbeCommand(agentDir)`,
  `parseProbeStdout(stdout): probe|null`, `classifyProbeOutcome({exitCode, stdout, stderrExcerpt})
  → {kind:'fatal',diagnostic}|{kind:'probe',probe}`, `deriveLibc(probe) → 'glibc'|'non-glibc'`,
  `selectPrebuiltTarget({platform,arch,libc}) → {ok:true,target}|{ok:false,triple}`,
  `decideNodePtyProvision(probe, selection, localManifestOrNull) → {kind:'skip'|'install'|
  'proceed-unmanaged'|'no-match'}`, `buildNodePtyInstallCommand(agentDir, nonce)`,
  `encodeNodePtyPayload(files: Array<{path,bytes,sha256}>, ptyNodeSha256)`,
  `glibcFloorHint(stderr)` ('' when unrelated),
  **`appendBoundedProbeStdout(window, chunk, cap = NODE_PTY_PROBE_STDOUT_CAP): string`** (the
  REQ-026 pure trailing-window accumulator — discards OLDER chars on overflow), constants
  `NODE_PTY_PROBE_SENTINEL = 'TERMHALLA_PROBE_V1 '`, `NODE_PTY_MARKER_FILE`,
  `NODE_PTY_BYTES_EXIT = 93`, `NODE_PTY_SHA_EXIT = 94`, `NODE_PTY_RACE_EXIT = 95`,
  **`NODE_PTY_PROBE_STDOUT_CAP = 65536`** (order 64 KiB — CONV-003: stated + tested),
  `PREBUILT_TARGETS_V1 = ['linux-x64-glibc']`, `PROBE_SRC`, `UNPACK_SRC`.
- **Probe result (REQ-008 as amended): SEVEN fields** —
  `{ platform, arch, glibc, marker, resolves, actualPtyNodeSha256, node }`;
  `actualPtyNodeSha256` = lowercase-hex sha-256 (node:crypto) of the bytes ACTUALLY at
  `<agentDir>/node_modules/node-pty/build/Release/pty.node`, `null` when absent/unreadable —
  never the marker's claim. Exit 0 whenever the sentinel line printed.
- **Manifest/marker shape (REQ-001/REQ-023 as amended): EXACTLY**
  `{ formatVersion: 1, nodePtyVersion, target, ptyNodeSha256, files }` — `files` maps EVERY
  staged relative path (manifest itself excluded) to its lowercase-hex sha-256; deterministic
  enumeration (two stagings of identical inputs ⇒ byte-identical manifests). The verification
  gate re-hashes EVERY staged file against `files` and requires key-set equality with the
  staged set, naming the diverging path (TEST-2365/2366/2367). The LOCAL manifest read by the
  connect flow (REQ-019) REQUIRES `files` — it is the payload's per-entry sha source.
- **Local-manifest completeness gate (ESC-004 — FINDING-022/024, REQ-014/REQ-019; NEW this
  pass):** every payload entry's `sha256` is sourced from the local manifest's `files` map —
  the marker's own entry excepted (excluded from the map by REQ-001; computed from its bytes at
  encode time). There is **NO self-compute fallback** for any other file. BEFORE any ssh upload
  the client validates the map is a plain **non-array** object of **non-empty-string** values
  whose key set has **BIDIRECTIONAL parity** with the files the dynamic bundle-dir walk actually
  finds (mirroring the release gate's verification): an on-disk file with no entry, an entry
  with no on-disk file, or a malformed shape each fail the connect with a fatal in the REQ-019
  class — wording matches `/incomplete|malformed/i`, names the offending relative path(s) on a
  parity failure and the expected local bundle path, and the ledger shows the probe as the ONLY
  exec channel (`['probe']`, nothing landing remotely) — TEST-2380/2381/2382.
- **NODE_PTY_PAYLOAD_V1 header (REQ-014 as amended):**
  `{ format: 1, files: [{ path, size, sha256 }...], ptyNodeSha256 }` — each entry's `sha256`
  caller-sourced from the local manifest `files` map (the manifest file's own entry computed
  from its bytes at encode time). The unpacker verifies EVERY received file's sha-256 against
  its entry (pty.node additionally against the top-level `ptyNodeSha256`) BEFORE promotion;
  any mismatch ⇒ exit 94, stderr naming THAT file.
- **`UNPACK_SRC` promote (REQ-015 as re-amended — reader-atomic, rename-FIRST):** the commit
  point is an fs rename (renameSync/rename/promises.rename — the harness interposes all three)
  of the nonce temp dir onto `<agentDir>/node_modules/node-pty`, attempted DIRECTLY with **no
  preceding removal of the final dir** (TEST-2372's op-log ordering pin). On a collision
  (`ENOTEMPTY`/`EEXIST`/platform-equivalent `EPERM`): read the now-present marker —
  sha equal ⇒ remove own temp, **exit 0** (benign lost race; the final dir is NEVER removed —
  TEST-2360's zero-rm pin); absent/unparseable/different ⇒ remove the final dir and retry the
  rename **exactly once** (the ordinary clean-reinstall path — the ONLY sanctioned absence
  window). A SECOND collision on the retry ⇒ remove own temp, leave the destination, **exit
  95**, one-line stderr naming the original rename error code, the expected sha, and the
  observed marker sha (or, `/marker/i`-matched, its absence). A collision is NEVER exit 93;
  identical racers BOTH exit 0.
- `src/main/remote/agent-artifact.ts` exports `resolvePrebuiltRoot(opts: ArtifactPathOpts)`.
- `BootstrapOptions.nodePty?: { prebuiltRoot: string }` (absent ⇒ byte-identical legacy flow).
- **Decision (REQ-012 as amended):** skip REQUIRES marker equality AND `resolves === true` AND
  `probe.actualPtyNodeSha256 === localManifest.ptyNodeSha256` (ground truth); `null`/different
  actual hash ⇒ install even under a matching marker (self-repair — TEST-2330/TEST-2373).
- **Single recovery cycle (REQ-016 as amended):** if co-provisioning ran (skip OR install) and
  the agent launch dies pre-hello with stderr of the node-pty MODULE-RESOLUTION class (and
  NEVER the GLIBC class), do exactly ONE re-probe → re-decide → (≤1 further install) → one
  relaunch. Hard cap: two probes, two installs, two launches per connect. Terminal wording is
  HONEST: the install-ran variant matches `/install was applied/i` + `/re-?verified|second
  probe/i` (TEST-2349); the skip/skip variant must NOT match `/install was applied/i` and must
  match `/verif/i` + `node_modules/node-pty` + `/remove/i` + `/reconnect/i` (TEST-2375). An
  install FAILURE (93/94/95/other) stays terminal — no recovery (TEST-2348/2364).
- **Glibc hint (REQ-021, MUST):** ANY pre-hello launch fatal whose sanitized stderr matches the
  `GLIBC_<x.y>' not found` class gets the hint (contains `2.31` + the escape hatch), applied
  INDEPENDENTLY of module-resolution detection, and NEVER triggers the recovery cycle
  (TEST-2333 unit, TEST-2376 flow: ledger exactly [probe, node-pty-install, launch]).
- **Bounded early-settling probe (REQ-026):** the runner feeds every stdout chunk through
  `appendBoundedProbeStdout` (never unbounded concatenation) and settles the MOMENT a
  parseable sentinel line exists in the window — tearing the ssh child down (kill + stream
  destroy, the F19 posture) instead of waiting for exit (TEST-2377). A sentinel-less stream
  that ends classifies per REQ-009's rc-noise row with the stdout excerpt bounded by the cap
  (TEST-2378 pins diagnostic length ≤ cap + 512).
- Scripts are CLI-driven (tests/ is typechecked, so the suite exercises the .mjs scripts through
  their CLI — the exact interface release.yml consumes):
  `node scripts/stage-node-pty-prebuild.mjs --source <pkgDir> --pty-node <file> --out <root>
  --target <target>` and `node scripts/verify-node-pty-prebuild.mjs --root <root> --version <v>`
  (exit 0 / non-zero + stderr naming the failing check and path).
- Diagnostics wording pinned by regex: 93 → /truncat|byte/i (never /checksum/i); 94 →
  /sha-?256|checksum/i (never /truncat/i); 95 → /concurrent|collision/i + /reconnect/i (never
  /truncat/i, never /checksum/i); local-manifest incomplete/malformed (ESC-004) →
  /incomplete|malformed/i + the offending relative path(s) on parity failures + the expected
  bundle path, ledger ['probe']; no-match names platform + arch + `non-glibc` +
  `linux-x64-glibc` + `node_modules/node-pty`; mid-install abort → indeterminate:true +
  /previous/ + /complete/ + /reconnect/i; pre-spawn abort → /nothing was written/i; probe-127 →
  PATH + /non-interactive|login shell/i; rc-noise → /rc file|shell rc/i + /stdout/. (The
  loopback-1 "exactly one … no further attempts" install-ineffective pin is SUPERSEDED by the
  REQ-016 recovery-cycle + honest-wording pins above.)
- `release.yml` pins: a `runs-on: ubuntu` job, `container:`/`image:` + the literal `2.31`,
  `node -p` + `package(-lock)?.json` version derivation, no `1.1.0-` literal, index ordering
  `stage-node-pty-prebuild` < `verify-node-pty-prebuild` < `npm run package` < `gh release`,
  and a single line matching /node -e/ + /require/ + /pty\.node/ BEFORE `upload-artifact`.
- `electron-builder.yml` pins: `out/agent/prebuilds` + `to: agent/prebuilds` (additive; the
  0022 agent-artifact entry intact).

## Suites (all vitest `tests/**/*.test.ts`, native-free and build-free — REQ-024)

| File | Tests | Covers |
|---|---|---|
| `tests/node-pty-staging.test.ts` | TEST-2301..2310, TEST-2365..2367 | REQ-001, REQ-003, REQ-006, REQ-023 |
| `tests/node-pty-release-structure.test.ts` | TEST-2311..2319 | REQ-002, REQ-003, REQ-004, REQ-006, REQ-007, REQ-023, REQ-024 |
| `tests/main/node-pty-prebuilt-root.test.ts` | TEST-2320..2321 | REQ-005 |
| `tests/node-pty-prebuilt-pure.test.ts` | TEST-2322..2334, TEST-2368 | REQ-008..REQ-012, REQ-014, REQ-015 (vocab), REQ-021, REQ-026 |
| `tests/node-pty-probe-unpack.test.ts` | TEST-2335..2342, TEST-2360, TEST-2362..2363, TEST-2369..2372 | REQ-008, REQ-014, REQ-015 (all mandated promote vectors) |
| `tests/node-pty-provision-flow.test.ts` | TEST-2343..2358, TEST-2361, TEST-2364, TEST-2373..2378, TEST-2380..2382 | REQ-009, REQ-012..REQ-019, REQ-021, REQ-025, REQ-026 |
| `tests/integration-node-pty-prebuilt.test.ts` | TEST-2359, TEST-2379 | REQ-020 |

REQ-022 is covered by the pre-existing frozen `tests/remote-client-structure.test.ts`
(TEST-2001..TEST-2006) passing unamended — its dynamic walk picks `prebuilt.ts` up automatically
(incl. TEST-2004's `package.json`-string ban, which forces the dynamic upload-set enumeration).

## TEST → REQ map

| TEST | REQ | Assertion |
|---|---|---|
| TEST-2301 | REQ-001 | staging produces EXACTLY the bundle set: marker + package.json + whole lib/** (recursive) + build/Release/pty.node; source README/src/ excluded |
| TEST-2302 | REQ-001, REQ-006 | manifest: formatVersion 1, target, ptyNodeSha256 == independent sha-256 of the actual bytes, nodePtyVersion read from the SOURCE manifest at generation time (test-chosen value) |
| TEST-2365 | REQ-001, REQ-003 | **(ESC-003/FINDING-005):** the manifest `files` map key set == exactly the staged file set (manifest excluded); each value == independent sha-256 of that file's bytes; deterministic (two stagings ⇒ byte-identical manifests) |
| TEST-2303 | REQ-001 | missing source dir → non-zero + stderr names the path (CONV-001) |
| TEST-2304 | REQ-001 | missing pty.node → non-zero + stderr names it; no partial bundle left |
| TEST-2305 | REQ-003 | complete/sha-ok/version-ok bundle verifies (exit 0) |
| TEST-2306 | REQ-003 | absent bundle dir → non-ok naming the target path |
| TEST-2307 | REQ-003 | missing bundle file → non-ok naming pty.node |
| TEST-2308 | REQ-003 | sha mismatch → non-ok naming the sha/checksum check |
| TEST-2366 | REQ-003 | an EQUAL-byte-length content substitution in lib/index.js → non-ok naming that file + the sha check (the FINDING-005 attack shape) |
| TEST-2367 | REQ-003 | files-map/file-set divergence in BOTH directions (uncovered on-disk file; ghost map key) → non-ok naming the diverging path |
| TEST-2309 | REQ-003, REQ-006 | pinned-version mismatch → non-ok naming the version check + found version |
| TEST-2310 | REQ-023 | manifest keys EXACTLY {files, formatVersion, nodePtyVersion, ptyNodeSha256, target}; hashes 64-hex; files keys relative paths — no credentials/host identity |
| TEST-2311 | REQ-002 | release.yml has a Linux job with a container/base image documented as the glibc-2.31 floor |
| TEST-2312 | REQ-002, REQ-006 | node-pty version derived via node -p from manifest/lockfile; NO 1.1.0- literal in the workflow |
| TEST-2313 | REQ-002, REQ-003 | ordering stage → verify → npm run package → publish |
| TEST-2314 | REQ-007 | Linux job smoke-loads the built pty.node under node BEFORE the artifact upload |
| TEST-2315 | REQ-002 | repo hygiene: no .node binary anywhere outside node_modules/.git/out/dist |
| TEST-2316 | REQ-004 | electron-builder.yml extraResources ships out/agent/prebuilds → agent/prebuilds (additive to the 0022 entry) |
| TEST-2317 | REQ-006 | both scripts exist; no node-pty version literal under src/ or scripts/ |
| TEST-2318 | REQ-024 | ci.yml gains nothing: no staging/verify script ref, no container/docker step |
| TEST-2319 | REQ-023 | the feature-owned files reference no SCHEMA_VERSION / Electron userData persistence |
| TEST-2320 | REQ-005 | dev prebuilt root = <appRoot>/out/agent/prebuilds |
| TEST-2321 | REQ-005 | packaged prebuilt root = <resourcesPath>/agent/prebuilds |
| TEST-2322 | REQ-008 | exact probe command `node -e '<PROBE_SRC>' <dir>`; PROBE_SRC single-quote-free + data-free |
| TEST-2323 | REQ-008 | invalid dirs (empty, .., charset, leading -) rejected with CONV-001 errors |
| TEST-2324 | REQ-010 | libc rule: "2.31"→glibc; null/""→non-glibc |
| TEST-2325 | REQ-011 | selection truth table: one matching row; every miss echoes its triple verbatim; pure |
| TEST-2326 | REQ-009 | exit 255 → fatal reachability/auth + SANITIZED stderr tail (no control chars) |
| TEST-2327 | REQ-009 | exit 127 → fatal: no node on the non-interactive login shell PATH; the agent requires it |
| TEST-2328 | REQ-009 | no parseable sentinel (noise-only / garbage-after-sentinel / empty stdout) → fatal + rc-noise hint (CONV-002) |
| TEST-2329 | REQ-009 | line-scan: sentinel parses buried in noise and clean; parseProbeStdout probe/null |
| TEST-2330 | REQ-012 | decision table incl. marker-ok-but-resolves-false ⇒ install AND the ESC-003 ground-truth rows: actualPtyNodeSha256 different ⇒ install; null ⇒ install; skip REQUIRES actual == local sha |
| TEST-2331 | REQ-014 | exact install command `node -e '<UNPACK_SRC>' <dir> <nonce>`; UNPACK_SRC quote-free; dir/nonce validation |
| TEST-2332 | REQ-014 | NODE_PTY_PAYLOAD_V1 header {format:1, files[{path,size,**sha256**}], ptyNodeSha256} + bytes in order; client path validation (.., absolute, backslash, empty) |
| TEST-2333 | REQ-021 | GLIBC_x.y-not-found stderr → hint naming 2.31 + node_modules/node-pty; unrelated → '' |
| TEST-2334 | REQ-008, REQ-011, REQ-015 | frozen vocabulary: sentinel prefix, marker filename, exits 93/94/95, PREBUILT_TARGETS_V1 |
| TEST-2368 | REQ-026 | NODE_PTY_PROBE_STDOUT_CAP exported == 65536; appendBoundedProbeStdout retains ≤ cap TRAILING chars (precision at tiny caps + overflow at the real cap); a sentinel arriving after > cap of noise still parses from the window |
| TEST-2335 | REQ-008 | PROBE_SRC under local node, bare dir: exactly SEVEN fields, marker null, resolves false, actualPtyNodeSha256 null, exit 0 |
| TEST-2336 | REQ-008 | marker + resolvable package + matching on-disk pty.node: marker verbatim, resolves true, actualPtyNodeSha256 == sha of the actual bytes, exit 0 |
| TEST-2337 | REQ-008 | corrupt marker is a field value (null), never an exit code; resolves independent |
| TEST-2369 | REQ-008 | **(FINDING-020):** on-disk bytes ≠ marker claim ⇒ the probe reports the ACTUAL hash, never the claim |
| TEST-2370 | REQ-008 | **(FINDING-020):** absent pty.node under an intact marker ⇒ actualPtyNodeSha256 null |
| TEST-2338 | REQ-014, REQ-015 | round trip through the REAL unpacker: exact tree + bytes + marker at final; zero temp leftovers |
| TEST-2339 | REQ-015 | truncated stream → exit 93, stderr observed-vs-expected, temp gone, prior final untouched |
| TEST-2340 | REQ-015 | corrupted pty.node → exit 94, stderr names sha, temp gone, prior final untouched |
| TEST-2371 | REQ-014, REQ-015 | **(FINDING-005):** corrupted NON-native file at EQUAL byte length → exit 94, stderr names lib/index.js + the sha check; temp gone; prior final untouched |
| TEST-2341 | REQ-015 | reinstall over stale → EXACTLY the new set (stale gone), marker == shipped manifest (D4) |
| TEST-2342 | REQ-014 | unpacker RE-validates header paths before any write: .., absolute, backslash rejected; nothing escapes |
| TEST-2360 | REQ-015 | two installs of the IDENTICAL payload, same agentDir, interposed promote collision (real fs rename throws ENOTEMPTY/EEXIST/EPERM) ⇒ BOTH exit 0; final dir EXACTLY the bundle set; marker == shipped manifest; zero `*.tmp`; the interposer op log shows ZERO removals of the final dir by the loser — a collision is never exit 93 |
| TEST-2372 | REQ-015 | **(FINDING-021):** stale-replace with NO racer: the op log's FIRST final-dir op is a RENAME (rename-first — no unconditional pre-rename rm), removal only after the collision, the retry rename succeeds ⇒ exit 0, exactly the new file set |
| TEST-2362 | REQ-015 | a divergent install REAPPEARING after the single replace retry (NPTY_INTERPOSE_EVERY) ⇒ exit 95 (never 93); stderr names the rename error code + expected sha + observed sha; own temp gone; the present install left in place |
| TEST-2363 | REQ-015 | persistent collision against an install with NO readable marker (absent AND unparseable) ⇒ exit 95; stderr names the rename error code + expected sha + /marker/i; own temp gone |
| TEST-2343 | REQ-016, REQ-014, REQ-025 | fresh host: ledger EXACTLY [probe, node-pty-install, launch, upload, launch]; bundle + marker landed |
| TEST-2344 | REQ-012 | second connect skips: [probe, launch]; ZERO uploads of any kind (CONV-051-scoped) |
| TEST-2373 | REQ-012, REQ-025 | **(FINDING-020 self-repair flow):** intact matching marker + resolvable JS + CORRUPTED on-disk pty.node (npty-preseed-corrupt rig) ⇒ decision install, ledger EXACTLY [probe, node-pty-install, launch], binary repaired to the shipped bytes, hello reached — never skip→launch-fatal |
| TEST-2345 | REQ-013, REQ-025 | no-match → fatal naming triple + non-glibc + linux-x64-glibc + escape hatch; ledger [probe] only |
| TEST-2346 | REQ-012, REQ-019 | proceed-unmanaged: unmatched + resolvable connects, no upload, ONE unmanaged diagnostic; local bundle NOT required |
| TEST-2347 | REQ-015, REQ-016, REQ-025 | 93 mirrored: fatal /truncat|byte/i (≠ checksum wording); [probe, node-pty-install]; no launch |
| TEST-2348 | REQ-015, REQ-016, REQ-025 | 94 mirrored: fatal /sha|checksum/i (≠ truncated wording); ONE install; no launch; an install failure is TERMINAL — never recovered |
| TEST-2374 | REQ-016, REQ-025 | **(recovery vector):** launch dies ONCE with module-resolution stderr (npty-launch-die-once:modfail) ⇒ ledger EXACTLY [probe, node-pty-install, launch, probe, launch] and the connect SUCCEEDS |
| TEST-2349 | REQ-016 | **(install-honesty terminal vector — supersedes the exactly-one wording):** persistent module-resolution launch death after an install ⇒ EXACTLY two probes + two launches + one install, then fatal whose wording matches /install was applied/i + /re-?verified|second probe/i |
| TEST-2375 | REQ-016 | **(skip-honesty terminal vector):** the skip/skip variant ⇒ ledger [probe, launch, probe, launch] (zero installs), fatal wording NOT /install was applied/i, matches /verif/i + node_modules/node-pty + /remove/i + /reconnect/i — the two wordings differ |
| TEST-2376 | REQ-021, REQ-025 | **(FINDING-009 flow):** GLIBC-class launch fatal (no module-resolution wording) ⇒ diagnostic contains 2.31 + the escape hatch; ledger [probe, node-pty-install, launch] — NO recovery |
| TEST-2364 | REQ-015, REQ-016, REQ-025 | 95 mirrored via npty-race-divergent (REAL unpacker + PERSISTENT interposer): fatal /concurrent|collision/i + /reconnect/i, never /truncat/i or /checksum/i; [probe, node-pty-install]; no launch; the divergent install left in place |
| TEST-2350 | REQ-017 | pre-spawn abort → aborted, determinate, "nothing was written", empty ledger |
| TEST-2351 | REQ-017 | abort during the read-only probe → aborted, NO indeterminate |
| TEST-2352 | REQ-017, REQ-025 | abort mid-install → aborted + indeterminate:true + either-or/reconnect wording (abort fires on the OBSERVED stalled install channel, not a wall-clock timer) |
| TEST-2353 | REQ-018 | option absent ⇒ ledger exactly today's [launch, upload, launch] (probe-free) |
| TEST-2354 | REQ-018 | option + ptyBackend 'fake' ⇒ probe-free, install-free, connects |
| TEST-2355 | REQ-018 | services.ts passes nodePty derived from resolvePrebuiltRoot (structural) |
| TEST-2356 | REQ-019 | empty prebuiltRoot → fatal naming <root>/node-pty/linux-x64-glibc; ledger [probe] |
| TEST-2357 | REQ-019 | bundle missing pty.node → same fatal posture |
| TEST-2358 | REQ-019 | corrupt local manifest → same fatal posture |
| TEST-2380 | REQ-014, REQ-019 | **NEW (ESC-004/FINDING-022 attack shape):** a bundle file TAMPERED on disk AND removed from the manifest `files` map ⇒ a PRE-UPLOAD fatal matching /incomplete|malformed/i naming lib/index.js + the expected bundle path; ledger EXACTLY ['probe']; nothing lands remotely — the file is NEVER uploaded under a self-computed sha |
| TEST-2381 | REQ-014, REQ-019 | **NEW (ESC-004 bidirectional parity):** a manifest `files` entry naming a path ABSENT from the bundle dir (ghost key) ⇒ the same pre-upload fatal naming lib/ghost.js + the bundle path; ledger ['probe']; nothing lands remotely |
| TEST-2382 | REQ-019, REQ-014 | **NEW (ESC-004/FINDING-024 malformed shape):** `files` as an ARRAY (typeof 'object'!) and `files` with an empty-string sha value ⇒ each a pre-upload fatal matching /malformed|incomplete/i naming the bundle path; ledger ['probe'] — never mirrored as a remote 94/checksum-shaped install failure |
| TEST-2361 | REQ-009, REQ-025 | the npty-probe-noise rig: the whole flow succeeds through rc noise around the sentinel |
| TEST-2377 | REQ-026, REQ-025 | **(FINDING-010):** the npty-probe-endless rig (sentinel then unbounded stdout) ⇒ the connect settles on the sentinel and completes the whole flow (a stream-end-waiting client is caught by a 25 s red-path abort guard) |
| TEST-2378 | REQ-026, REQ-009 | the npty-probe-flood rig (~200 KiB sentinel-less) ⇒ rc-noise fatal, diagnostic length ≤ cap + 512, ledger [probe] |
| TEST-2359 | REQ-020 | real bundle (vite.agent.config.ts, on demand) + stub bundle (manifest carries `files`): co-provision → --pty=node-pty resolves by placement → hello + pty:spawn→pty:data; uploaded .cjs byte-identical; TEST-755 untouched |
| TEST-2379 | REQ-020 | **(ESC-003 mandated flow-level concurrency):** two overlapping connectWithProvisioning calls, SAME fresh fake home, distinct nonces ⇒ BOTH reach hello; exactly ONE final install byte-equal to the shipped bundle; no `*.tmp`; per-connect probe/install caps hold |
| TEST-2001..2006 (pre-existing, unamended) | REQ-022 | remote-client structural guards keep passing over the grown tree (dynamic walk; package.json-string ban forces dynamic enumeration) |
