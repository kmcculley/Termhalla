# Spec — 0023-remote-node-pty-prebuilt

**Phase:** 2 (spec). **Date:** 2026-07-05.
**Inputs:** `00-intake.md` (verified node-pty require graph), `01-concept.md` (locked decisions D1–D6),
`.orky/conventions.md`, `.orky/baseline/` (no baseline REQ touches the remote stack — REQ-001..024
there predate Remote Agent v1; nothing is superseded).
**Amendments:**
- *(loopback 1 — FINDING-013, ESC-001/ESC-002, resolved 2026-07-06T01:03Z)* REQ-015 amended:
  race-tolerant idempotent promote (collision at the final rename = benign lost race when the
  present marker's sha matches; no remote lock), sentinel exit `95` for the divergent-collision
  case, and a mandatory concurrency acceptance vector (CONV-018 propagation).
- *(loopback 2 — FINDING-020 + cluster 017/021/010/009/005, ESC-003, resolved 2026-07-06T02:12Z)*
  Per the human decision: the probe now re-reads and hashes the **actual on-disk** `pty.node`
  (`actualPtyNodeSha256`, REQ-008) and the skip decision is gated on that ground-truth hash — never
  the self-claimed marker alone (REQ-012; the ESC-003 adopted rule: *a skip decision that trusts a
  self-written integrity marker MUST re-verify the guarded artifact from ground truth*). The
  manifest/payload carry a sha-256 for **every** shipped file, verified in both the release gate and
  the remote unpacker (REQ-001/REQ-003/REQ-014/REQ-015). The promote is now atomic from a reader's
  viewpoint — rename WITHOUT a prior rm, sha-compare on collision, one replace retry, `95` only on
  a persistent divergent race (REQ-015, superseding loopback 1's first-collision-95 detail while
  preserving its invariants: a collision is never exit 93; identical racers both exit 0). A single
  sanctioned recovery cycle (re-probe → decide → at most one more install → one relaunch) replaces
  the terminal fatal on a post-co-provision node-pty resolution failure, and the terminal wording
  must state what this connect actually did — never "an install was applied" on a skip path
  (REQ-016). The connect-flow concurrency vector is mandated (REQ-020). The probe channel is
  bounded + early-settling (new REQ-026). The glibc-floor hint fires on ANY `GLIBC_…' not found`
  launch fatal, independent of module-resolution detection (REQ-021, SHOULD→MUST).
  No REQ renumbered.

## Concerns

`["security", "networking", "determinism", "packaging"]`

## Problem statement

A released Termhalla provisions the agent `.cjs` onto a remote Linux host, but the agent's lazy
`import('node-pty')` (`src/agent/node-pty-backend.ts:39`, pinned by frozen TEST-755) fails with
`ERR_MODULE_NOT_FOUND` on any host without node-pty installed. This feature ships prebuilt node-pty
inside the installer and has the client co-provision it to
`<remoteAgentDir>/node_modules/node-pty` at connect time, so the bare specifier resolves — zero
manual remote setup on a stock `(linux, x64, glibc)` host with only `node` present.

## Definitions (contract constants)

| Term | Value |
|---|---|
| Pinned node-pty version | the `node-pty` entry in `package.json` `dependencies`, read at build/generation time — never a source literal (CONV-058) |
| v1 target set | exactly `['linux-x64-glibc']` (locked D1) |
| Local prebuilt root | dev: `<appRoot>/out/agent/prebuilds` — packaged: `<resourcesPath>/agent/prebuilds` |
| Target bundle dir | `<prebuiltRoot>/node-pty/<target>/` |
| Bundle manifest / remote marker file | `.termhalla-prebuilt.json` with at least `{ formatVersion: 1, nodePtyVersion, target, ptyNodeSha256, files }` — `ptyNodeSha256` = lowercase hex sha-256 of `build/Release/pty.node`; `files` = a map from EVERY shipped relative path (`package.json`, `lib/**`, `build/Release/pty.node`) to its lowercase hex sha-256 (ESC-003 / FINDING-005 amendment) |
| Remote install dir | `<remoteAgentDir>/node_modules/node-pty` (`remoteAgentDir` defaults to `~/.termhalla/agent`; same validated path rules as F19) |
| Probe sentinel prefix | the literal `TERMHALLA_PROBE_V1 ` beginning the probe's one JSON output line |
| Probe stdout cap | a named exported constant (order 64 KiB): the client retains at most this many trailing chars of probe stdout (REQ-026; CONV-003 — the limit is stated and tested) |
| Sentinel exits | `93` = byte-count mismatch (shared semantic with F19's `UPLOAD_SIZE_MISMATCH_EXIT`), `94` = sha-256 mismatch of ANY received file — both mean "nothing was promoted, temp state removed"; `95` = promote collision with a **divergent** install that persists after the single replace retry (lost a genuine promote race to a non-identical concurrent install — own temp removed, the destination holds the other connect's install). A promote collision with an **identical** install is exit `0` (benign lost race, REQ-015) |
| v1 glibc floor | glibc **2.31** (Ubuntu-20.04-class build base) — decided here per D2's locked "build-on-oldest" principle; lowering to 2.28 (manylinux_2_28, covers RHEL 8) is an additive fast-follow, like arm64/musl |
| Remote tool assumptions | a POSIX login shell + the `node` binary the agent already requires. **Nothing else** (no tar, no sha256sum, no compiler, no npm/registry access). Refines D3: the sha-256 checks run in `node` (`node:crypto`) inside the remote probe/unpacker — same integrity property, one fewer coreutils dependency |

---

## A — Prebuilt production and packaging

### REQ-001 — Prebuilt bundle layout and manifest
*(Amended in the ESC-003 loopback: the manifest carries a per-file sha-256 for EVERY shipped file —
FINDING-005 — not only `pty.node`.)*

The build MUST stage, per v1 target, a bundle dir with exactly this shape (paths are load-bearing —
node-pty's requires are relative, see intake):

```
<prebuiltRoot>/node-pty/linux-x64-glibc/
├── .termhalla-prebuilt.json     # the manifest (Definitions)
├── package.json                 # node-pty's own manifest (makes bare import('node-pty') resolve)
├── lib/**                       # the ENTIRE lib/ dir of the pinned node-pty (locked D6 — whole-lib)
└── build/Release/pty.node       # the ONE per-target native file (no spawn-helper — macOS-only)
```

Staging MUST be a Node script whose core is a pure, injectable function (readable under vitest):
given a source node-pty package dir and a built `pty.node`, it produces the layout above, computes
`ptyNodeSha256` from the actual bytes, computes the `files` map by hashing EVERY staged file's
actual bytes (deterministically ordered enumeration), and reads `nodePtyVersion` from the source
package's own manifest at generation time.
**Acceptance:** a unit test drives the staging core against a fixture package dir + arbitrary
`pty.node` bytes and asserts (a) the exact file set above, (b) `ptyNodeSha256` equals an
independently computed sha-256 of the fixture bytes, (c) `nodePtyVersion` equals the fixture
manifest's version (a value chosen by the test, proving read-at-generation), (d) `target` and
`formatVersion: 1` are present, (e) the `files` map's key set equals exactly the staged relative
file set (manifest itself excluded) and each value equals an independently computed sha-256 of that
file's bytes. Empty/missing source dir and missing `pty.node` fail with specific, actionable errors
(CONV-001/CONV-002).

### REQ-002 — Release-time Linux prebuilt build (old-glibc base), nothing native in git
`release.yml` MUST gain a Linux job that builds the pinned node-pty version from source inside a
container whose glibc is ≤ the v1 floor (2.31), extracts `build/Release/pty.node`, and hands it to
the packaging job (workflow artifact) where the REQ-001 staging runs before `npm run package`. The
pinned version MUST be derived from the repo manifest/lockfile in the workflow, never hand-typed.
No `.node` (or other compiled) binary may be committed to the repo. The Windows Spectre/NDEBUG
patch (`patches/node-pty+*.patch`) is MSVC-only and is not applied to the ELF build — the job
builds the registry tarball of the pinned version (release CI may access the npm registry; only
*remotes* must work offline).
**Acceptance:** a structural unit test parses `.github/workflows/release.yml` and asserts: a job
running on a Linux runner exists; it references a container/base image documented as the glibc-2.31
floor; the node-pty version is read from `package.json`/`package-lock.json` (e.g. via `node -p`),
with no `1.1.0-…` literal in the workflow; the packaging job invokes the staging + verification
script (REQ-003) before `npm run package`. A repo-hygiene test asserts no tracked file under
`src/`, `out/`-independent repo paths matches `*.node` (scoped glob, `node_modules` excluded).

### REQ-003 — Release-lane verification gate (no silent prebuilt-less release)
*(Amended in the ESC-003 loopback: the gate verifies EVERY shipped file's sha-256 against the
manifest `files` map — FINDING-005 — not only `pty.node`.)*

The release workflow MUST fail (before publishing) if any v1 target bundle is absent or invalid:
missing file from the REQ-001 set, ANY staged file's actual sha-256 not matching its manifest
`files` entry (including `ptyNodeSha256` not matching the staged `pty.node` bytes), a `files` map
whose key set differs from the staged file set, or `nodePtyVersion` not equal to the pinned
node-pty version. A **local/dev** `npm run package` without staged prebuilts MUST still succeed
(the gate is a release-workflow step, not baked into `npm run package`) — a prebuilt-less local
package falls to REQ-019's runtime diagnostic.
**Acceptance:** unit tests on the verification core cover each failure mode (absent dir, missing
file, `pty.node` sha mismatch, a `lib/*.js` content substitution of EQUAL byte length — the
FINDING-005 attack shape — a `files`/file-set divergence, version mismatch) asserting a non-ok
result whose message names the failing check and path (CONV-001), plus the pass case; the REQ-002
structural test pins the workflow step ordering (verify → package → publish).

### REQ-004 — Installer ships the prebuilds via extraResources
`electron-builder.yml` MUST ship the staged prebuilds dir outside the asar:
`out/agent/prebuilds` → `resources/agent/prebuilds` (readable as plain files by the upload stream,
same posture as the agent artifact).
**Acceptance:** a structural test (extending `tests/main/remote-agent-artifact.test.ts`'s pattern)
asserts `electron-builder.yml` contains an `extraResources` mapping from `out/agent/prebuilds` to
`agent/prebuilds`. TEST-2221's tolerant regex is unaffected (additive entry).

### REQ-005 — Prebuilt-root path resolver (dev vs packaged, electron-free)
`src/main/remote/agent-artifact.ts` MUST export a resolver (analogous to
`resolveAgentArtifactPath`) returning `<appRoot>/out/agent/prebuilds` in dev and
`<resourcesPath>/agent/prebuilds` when packaged, taking the same injected `ArtifactPathOpts` (no
electron import).
**Acceptance:** unit tests cover both branches with injected opts (extend
`tests/main/remote-agent-artifact.test.ts`).

### REQ-006 — Version lockstep, read at generation time
The shipped bundle's `nodePtyVersion` MUST equal the app's pinned node-pty version, established by
*reading* the pinned package's manifest at staging time (REQ-001) and *verifying* equality at
release time (REQ-003). No source file under `src/**` or `scripts/**` may contain a node-pty
version literal.
**Acceptance:** covered by REQ-001(c)/REQ-003 tests, plus a scoped scan test asserting no file
under `src/` or `scripts/` matches `/1\.1\.0-beta\d+/` (grep run 2026-07-05, pattern
`1\.1\.0-beta34` repo-wide excluding `node_modules`: hits only `package.json`, `package-lock.json`,
docs, the patch filename, and this feature's intake — no `src/`/`scripts/` hit exists today; the
scan keeps it that way).

### REQ-007 — Release-job smoke-load of the built binary (SHOULD)
The Linux build job SHOULD smoke-verify the freshly built `pty.node` loads in plain Node on the
build container (e.g. `node -e "require(<path>)"` or an agent `--pty=node-pty` hello against a
canned home) before handing the artifact on — the gold path the windows-latest test lane can never
exercise.
**Acceptance:** the REQ-002 structural test asserts the Linux job contains a step that loads the
built `pty.node` under `node` before the artifact upload step.

---

## B — The remote probe

### REQ-008 — Probe command builder and output contract
*(Amended in the ESC-003 loopback: the probe reports the GROUND-TRUTH hash of the on-disk native
binary — `actualPtyNodeSha256` — FINDING-020/FINDING-017.)*

A pure builder in `src/remote-client/` MUST produce ONE remote command of the shape
`node -e '<PROBE_SRC>' <agentDir>` where: `<PROBE_SRC>` is a fixed script literal containing **no
single-quote character** and **no interpolated data**; `<agentDir>` is validated by the same rules
as F19's `checkRemotePath` (charset `[A-Za-z0-9._/~-]`, no `..` segments) and passed as a separate
shell word (unquoted, so `~` expands; the script reads it from `process.argv`). The script prints
exactly one line beginning with the sentinel prefix followed by a JSON object with fields:
`platform` (`process.platform`), `arch` (`process.arch`), `glibc` (the
`process.report.getReport().header.glibcVersionRuntime` string, or `null` when absent), `marker`
(the parsed remote marker file `<agentDir>/node_modules/node-pty/.termhalla-prebuilt.json`, or
`null` when absent/unreadable/unparseable), `resolves` (boolean: whether the bare specifier
`node-pty` resolves when resolution starts inside `<agentDir>` — the same resolution the launched
agent performs), `actualPtyNodeSha256` (the lowercase hex sha-256, computed via `node:crypto`, of
the ACTUAL bytes currently at `<agentDir>/node_modules/node-pty/build/Release/pty.node`, or `null`
when that file is absent or unreadable — never the marker's claimed value), and `node`
(`process.version`, diagnostic value). The script MUST exit 0 whenever it printed the sentinel line
(probe failures are field values, never exit codes).
**Acceptance:** a frozen unit suite pins the exact command string for a given dir; asserts the
embedded script contains no `'`; asserts invalid dirs (empty, `..` segment, disallowed chars,
leading `-`) are rejected with specific CONV-001 errors; and executes `<PROBE_SRC>` under the local
`node` against a fixture dir to assert the sentinel line parses with all seven fields and correct
`marker`/`resolves`/`actualPtyNodeSha256` values for: present/absent/corrupt marker fixtures; an
on-disk `pty.node` whose bytes match the marker's claim; an on-disk `pty.node` whose bytes DIFFER
from the marker's claim (the probe reports the actual hash, not the claim); and an absent
`pty.node` with an intact marker (`actualPtyNodeSha256: null`) (runs on windows-latest — the
script itself is platform-agnostic; `glibc` is simply `null` there).

### REQ-009 — Probe outcome classification (noise-tolerant, actionable)
A pure classifier MUST map a finished probe exec to exactly one outcome: exit `255` → fatal
transport (reachability/auth wording, stderr tail appended — mirrors `classify.ts`); exit `127` →
fatal with a diagnostic stating the remote has no `node` on the non-interactive login shell's PATH
and that the agent requires it (the F19 FINDING-004 ambiguity, now caught before any launch); any
completion whose stdout contains **no parseable sentinel line** → fatal with the rc-noise hint
(FINDING-006 parallel); otherwise → the parsed probe result, scanning stdout **line-by-line for the
sentinel prefix** so shell-rc noise before/after the line never breaks parsing. Every diagnostic
MUST be specific and actionable (CONV-001) and stderr MUST be control-character-sanitized before it
enters any diagnostic (reuse F19's `sanitizeStderr` posture).
**Acceptance:** unit vectors for each row (255, 127, noise-only stdout, sentinel-with-noise,
clean sentinel, unparseable JSON after the sentinel), asserting kind + required diagnostic
substrings; malformed/empty stdout covered per CONV-002.

### REQ-010 — libc determination rule
A pure function MUST derive libc from the probe result: `glibc` field a non-empty string ⇒ `glibc`;
otherwise ⇒ `non-glibc` (musl or unknown — indistinguishable in v1 and treated identically, per
locked D5).
**Acceptance:** unit vectors: `"2.31"` ⇒ glibc; `null` ⇒ non-glibc; `""` ⇒ non-glibc.

### REQ-011 — Deterministic prebuilt selection
A pure function MUST map a probed `(platform, arch, libc)` triple to a target: exactly
`(linux, x64, glibc)` ⇒ `linux-x64-glibc`; every other triple ⇒ a no-match result carrying the
detected triple verbatim. The v1 table has exactly one row; adding arm64/musl later is one row +
one bundle (out of scope now).
**Acceptance:** a unit truth table: `(linux,x64,glibc)` ⇒ match; `(linux,arm64,glibc)`,
`(linux,x64,non-glibc)`, `(darwin,arm64,…)`, `(win32,x64,…)` ⇒ no-match each echoing its triple.
Same input twice ⇒ identical output (pure, no ambient state).

---

## C — Provision decision and upload

### REQ-012 — Provision decision table (skip is ground-truth-verified)
*(Amended in the ESC-003 loopback — FINDING-020/FINDING-017: the skip decision MUST re-verify the
guarded artifact from ground truth, never trust the self-written marker's claimed hash. A
torn/corrupted/deleted on-disk `pty.node` under an intact marker previously produced a PERMANENT
skip→launch-fail wedge with no self-repair.)*

A pure decision function MUST take (probe result, selected target, the LOCAL bundle manifest) and
return exactly one of:
- **skip** — target matched AND the remote marker's `nodePtyVersion`, `target`, and `ptyNodeSha256`
  all equal the local manifest's AND `resolves === true` AND the probe's **`actualPtyNodeSha256`
  equals the local manifest's `ptyNodeSha256`** (the ground-truth gate: the hash of the bytes
  actually on disk, not the marker's claim). Skip means ZERO upload channels this connect (the
  idempotent steady state).
- **install** — target matched and the skip condition fails for any reason (no marker, stale
  version, different sha, marker present but `resolves === false`, **or `actualPtyNodeSha256`
  `null`/different from the local manifest sha** — a torn/corrupted/hand-damaged install is
  repaired, never trusted: self-repair, never a wedge).
- **proceed-unmanaged** — target did NOT match but `resolves === true`: the manual-install escape
  hatch is honored; connect proceeds with no upload, and one diagnostic line (via `onDiagnostic`)
  states an unmanaged node-pty is in use for the unmatched triple.
- **no-match** — target did not match and `resolves === false` (REQ-013).

The remote install dir is Termhalla-managed on a matched target: **install** may replace whatever
is there (locked D4 clean-reinstall).
**Acceptance:** a unit truth table covering all four outcomes, including: marker matches but
`resolves` false ⇒ install; marker version stale ⇒ install; marker sha differs (same version) ⇒
install; **marker matches + `resolves` true + `actualPtyNodeSha256` differs from the manifest sha ⇒
install**; **marker matches + `resolves` true + `actualPtyNodeSha256` null (binary absent) ⇒
install**; unmatched triple + resolvable ⇒ proceed-unmanaged; matched + full equality + matching
actual hash + resolvable ⇒ skip. A fake-ssh scenario asserts skip produces zero upload invocations
in the CONV-051-scoped ledger (startup probe/launch traffic filtered explicitly, never raw-empty
asserts). A **self-repair flow vector** (the FINDING-020 shape): a pre-seeded remote install whose
marker matches the local manifest and whose JS resolves, but whose on-disk `pty.node` bytes are
corrupted/truncated ⇒ the decision is **install**, the ledger shows exactly one node-pty upload,
and the connect reaches hello — never a skip followed by a launch fatal.

### REQ-013 — No-match is a fatal, actionable diagnostic — never a fallback
On a **no-match** decision the connect MUST fail (kind `fatal`) **without launching the agent and
without uploading anything**, with a diagnostic that (a) names the detected `platform`, `arch`, and
libc determination, (b) states this build ships a prebuilt for `linux-x64-glibc` only, and (c)
names the escape hatch: manually install the pinned node-pty version at
`<agentDir>/node_modules/node-pty` on the host (after which connect will detect it and proceed).
There is NO silent local-shell fallback and NO partial install (locked D1/decision 5).
**Acceptance:** a fake-ssh scenario with a rigged non-matching triple asserts: result kind fatal;
the diagnostic contains the triple, the literal target name, and the remote install path; the
invocation ledger (CONV-051-scoped) shows the probe as the ONLY exec channel — no launch, no
upload.

### REQ-014 — Single-channel, injection-safe, verified payload upload
*(Amended in the ESC-003 loopback — FINDING-005: every payload file carries and is verified against
its own sha-256, not only `pty.node`.)*

When the decision is **install**, the entire node-pty payload (every file of the target bundle dir,
enumerated dynamically from disk — see REQ-022) MUST transfer over **one** additional ssh exec
channel (each exec channel can re-prompt interactive auth — locked F19 decision 1 inherits 2FA), as
a remote command of the shape `node -e '<UNPACK_SRC>' <agentDir> <nonce>` where: `<UNPACK_SRC>` is
a fixed, single-quote-free script literal with no interpolated data; `<agentDir>` is
`checkRemotePath`-validated and passed as a shell word; `<nonce>` matches F19's `SAFE_NONCE`
(crypto-random by default, injectable for tests). The payload on stdin is
**NODE_PTY_PAYLOAD_V1**: one JSON header line
`{ format: 1, files: [{ path, size, sha256 }...], ptyNodeSha256 }` followed by the files' bytes
concatenated in header order — each entry's `sha256` sourced from the local manifest's `files` map.
Header `path`s MUST be validated on the CLIENT (relative, no leading `/`, no `\`, no `..` segment,
charset-limited) and RE-validated by the remote unpacker before any write (defense in depth). The
unpacker MUST: write under a nonce-named temp dir only; verify every file's byte count; compute
sha-256 of EVERY received file via `node:crypto` and compare to that file's header `sha256` (with
`pty.node` additionally required to equal the header's `ptyNodeSha256`) **before** promotion; and
never write outside `<agentDir>/node_modules/`.
**Acceptance:** frozen unit tests pin the command shape and reject invalid dir/nonce inputs with
CONV-001 errors; a header-validation unit rejects `..`, absolute, and backslash paths on both the
encoder and (by executing `<UNPACK_SRC>` under local node against a temp dir) the unpacker;
a round-trip test streams a crafted payload through the real unpacker and asserts the exact file
tree + bytes land; a corrupted NON-native file (a `lib/*.js` entry whose bytes differ from its
header `sha256` at EQUAL length — the FINDING-005 shape) ⇒ exit 94 with stderr naming that file;
the fake-ssh scenario ledger shows exactly ONE upload invocation for a fresh install.

### REQ-015 — All-or-nothing, reader-atomic promote; clean reinstall; race-tolerant idempotent commit; distinct sentinels
*(Amended twice. Loopback 1 — FINDING-013 / ESC-001/ESC-002: a promote collision is never a
byte/short-read failure; identical racers both succeed; sentinel 95 for a divergent race; no remote
lock. Loopback 2 — FINDING-021 / ESC-003: the promote is atomic from a READER's viewpoint — rename
WITHOUT a prior rm — because the old rm→rename left `node_modules/node-pty` transiently ABSENT,
which a concurrently launching agent's `import('node-pty')` could observe as a spurious
`ERR_MODULE_NOT_FOUND`. This supersedes loopback 1's "exit 95 on first divergent collision" detail:
with rename-first, a collision against a NON-matching install is the ordinary replace path, and 95
is reserved for a divergence that persists after the single replace retry. Loopback 1's invariants
survive: a collision is never exit 93; two racers shipping the same release BOTH exit 0.)*

The unpacker MUST make the install transactional at the node-pty-directory level: unpack + verify
(REQ-014, every file) into `<agentDir>/node_modules/node-pty.<nonce>.tmp`, write the marker (the
manifest content) inside the temp dir, then promote as follows:

1. **Rename-first, no prior rm:** attempt rename temp → `node_modules/node-pty` directly.
   Success ⇒ exit 0 (the common fresh-host path; the final dir was never removed, so a
   concurrently launching agent can never observe it absent).
2. **On a collision** (destination exists — `ENOTEMPTY`/`EEXIST` on POSIX; the platform-equivalent
   collision error, e.g. `EPERM`, under the local-node test harness on Windows), read the
   now-present final dir's marker and compare its `ptyNodeSha256` to the payload header's sha:
   - **equal** ⇒ a benign lost race (another connect already promoted an identical, sha-verified
     install): remove own temp dir and **exit 0** — success; the connect proceeds normally; the
     final dir was never touched, let alone removed;
   - **absent / unparseable / different** ⇒ the present install is stale, torn, or a divergent
     racer's: remove the final dir and retry the rename **exactly once** (this is the ordinary
     clean-reinstall path — the ONLY window in which the final dir is transiently absent, and only
     when what it held did not match this payload anyway). Retry success ⇒ exit 0.
3. **Second collision on the retry** ⇒ a genuinely concurrent divergent promoter: remove own temp
   dir, leave the destination to the other connect, and exit **95**, with a one-line stderr naming
   the original rename error code, the expected sha, and the observed marker sha (or its absence).
   Exit 95's client diagnostic advises reconnecting — the next connect's probe + REQ-012 decision
   repairs the dir deterministically. A collision is NEVER reported as exit 93.

On ANY other failure the temp dir MUST be removed and the process exit with a distinguishing
sentinel: `93` (a byte-count/short-read failure) or `94` (sha-256 mismatch on any file), each with
a one-line stderr naming the failing file/check and observed vs expected values. Consequences that
MUST hold (each backed by its own acceptance vector below — never prose-only, per the ESC-001
adopted rule):
- the final path never holds a partial or unverified install (the promote rename is the commit
  point);
- the final path is never observed ABSENT by a concurrent reader except during the sanctioned
  replace of a NON-matching install (step 2's different/absent branch); installing over an
  identical install never removes the final dir at all;
- a marker at the final path implies an install that was complete and sha-verified **when
  promoted** (steady-state ground truth is re-established every connect by REQ-012's
  `actualPtyNodeSha256` gate — the marker alone is never trusted across connects);
- old artifacts never accumulate: one stable install path, temp dirs removed on failure AND on a
  lost race, and a version change replaces the dir wholesale (locked D4 — GC by clean reinstall);
- concurrent installs from two connects are safe and idempotent: distinct nonce temps; the first
  successful promote wins; every loser either exits 0 (identical install present) or 95 (divergent
  install persisting after the retry) — and two racing connects shipping the same release BOTH
  complete successfully.
**Acceptance:** unpacker-under-local-node tests: truncated stream ⇒ exit 93, temp gone, prior final
dir untouched; corrupted `pty.node` bytes ⇒ exit 94, same invariants, stderr names the sha check;
corrupted non-native file ⇒ exit 94 naming that file (REQ-014); success over a pre-existing stale
install ⇒ final dir contains exactly the new file set (stale files gone) and the marker equals the
shipped manifest — and the promote path taken is collision→replace (proving rename-first, no
blind prior rm; e.g. by asserting the unpacker source contains no unconditional pre-rename removal
of the final dir, or by an interposed-fs observation); **identical-race concurrency vector
(mandated by ESC-001/ESC-002):** two installs of the identical payload against the SAME
`<agentDir>` with overlapping/interleaved promote windows ⇒ BOTH exit 0, the final dir intact with
exactly the bundle file set, the marker valid and equal to the shipped manifest, no `*.tmp` dir
remaining, and the final dir NEVER removed by the loser; **divergent-race vector:** a loser whose
destination reappears holding a non-matching install after its replace retry ⇒ exit 95, its temp
gone, the present final dir left untouched, stderr naming the rename error + both shas (or the
marker's absence); **stale-replace vector:** a destination holding a non-matching (stale) install
with NO concurrent racer ⇒ the replace retry succeeds, exit 0; fake-ssh rigs mirror 93/94/95 into
client diagnostics that name the failing check distinctly (CONV-001 — "truncated" vs "checksum
mismatch" vs "concurrent-install collision" wording MUST differ, and 95's wording advises
reconnect, never retry-blaming the transfer).

### REQ-016 — Retry and loop discipline, single recovery cycle, honest terminal wording
*(Amended in the ESC-003 loopback — FINDING-021 and the honest-wording mandate: a
post-co-provision node-pty resolution failure gets exactly ONE recovery cycle instead of an
immediate terminal fatal, and the terminal diagnostic must state what this connect ACTUALLY did —
never "an install was applied" on a path where no install ran.)*

Per connect attempt the baseline is: at most ONE probe and at most ONE node-pty install attempt. A
failed install (spawn error, transport 255, sentinel 93/94/95, non-zero other) MUST fail the
connect with a diagnostic naming the failing class — never loop, never fall through to an agent
launch that would fail with `ERR_MODULE_NOT_FOUND`.

**Single recovery cycle (the ESC-003 addition):** if co-provisioning ran this connect (decision
skip OR install) and the agent launch still dies before hello with sanitized stderr matching the
node-pty module-resolution failure class (NOT the GLIBC class — REQ-021, which never retries), the
connect MUST perform exactly ONE recovery cycle: re-probe, re-decide per REQ-012 (the fresh
ground-truth probe sees whatever a racing connect left behind), run at most one further install if
the fresh decision requires it, and relaunch the agent once. If the relaunch reaches hello the
connect succeeds. If it fails again, the connect MUST fail with a terminal diagnostic that states
**what this connect actually did** — "a node-pty install was applied (and re-verified on a second
probe)" only when an install actually ran; on a skip/skip path, wording that a previously
installed node-pty was found and verified on disk yet the agent still could not load it — plus the
escape hatch (remove `<agentDir>/node_modules/node-pty` and reconnect). No further cycles: at most
TWO probes, TWO installs, and TWO launches per connect attempt, ever.

The F19 agent-artifact retry-exactly-once policy is unchanged and runs AFTER node-pty
co-provisioning (probe → node-pty install if needed → connect → agent provision-once → connect).
**Acceptance:** fake-ssh scenario ledgers: fresh host happy path shows exactly
[probe, node-pty upload, launch(127), agent upload, launch(hello)] — no recovery traffic; rigged
persistent 94 shows exactly one upload then a fatal result (an install failure is terminal, not
recoverable); **recovery vector:** a rig whose first post-install launch dies with
`ERR_MODULE_NOT_FOUND` stderr and whose remote state the recovery repairs ⇒ ledger shows exactly
[…, launch(fail), probe, (node-pty upload if the rig requires it), launch(hello)] and the connect
succeeds; **terminal-honesty vectors:** persistent resolution failure through the recovery cycle ⇒
exactly two probes and two launches in the ledger, then fatal; the skip/skip variant's diagnostic
does NOT contain "install was applied" wording and names the escape-hatch path, while the
install variant's does state an install ran — the two wordings MUST differ; no scenario produces
more than two probes or two node-pty uploads on one `connectWithProvisioning` call.

### REQ-017 — Cancellation and indeterminate outcomes
The caller's existing `AbortSignal` MUST cover the probe and the node-pty install (including any
recovery-cycle probe/install/launch). Abort before a child spawn ⇒ a determinate `aborted` result
("nothing was written remotely"). Abort of the in-flight probe ⇒ determinate `aborted` (the probe
is read-only). Abort mid-install ⇒ `aborted` with `indeterminate: true` and wording that states the
remote holds either the previous install (or none) or the complete verified new one — never a tear
— and that reconnecting resolves it (CONV-015; honesty class per CONV-034). Ssh children remain
killed/`unref`-safe on abort exactly as F19's paths are.
**Acceptance:** fake-ssh `stall`-rig scenarios: abort during probe ⇒ aborted, no `indeterminate`;
abort during the node-pty upload ⇒ aborted with `indeterminate: true` and the either-or wording;
pre-spawn abort short-circuits with zero ledger entries.

---

## D — Flow integration

### REQ-018 — Strictly additive opt-in; legacy behavior byte-identical
`connectWithProvisioning`/`BootstrapOptions` MUST gain one optional field —
`nodePty?: { prebuiltRoot: string }` — and behave as follows: option **absent** ⇒ the exec-channel
sequence and every result are IDENTICAL to today (all frozen F19/F21 suites pass unmodified);
option present AND `ptyBackend` is `'node-pty'` (the default) ⇒ the co-provision flow (REQ-012..17)
runs before the agent connect flow; option present AND `ptyBackend: 'fake'` ⇒ no probe, no upload
(the fake backend needs no native module — existing agent/CI paths untouched). All new failure
paths surface through the EXISTING `ConnectFailureKind` values (`fatal`/`aborted`), so F21's
renderer (banner/picker) needs NO change. The composition root (`services.ts`) MUST pass
`nodePty.prebuiltRoot` from the REQ-005 resolver alongside the existing version/artifact wiring.
**Acceptance:** a scenario invoking `connectWithProvisioning` WITHOUT the option against the
extended fake-ssh shim asserts the ledger equals today's pinned sequence (probe-free); with the
option + `ptyBackend: 'fake'` asserts a probe-free ledger; the existing frozen
`tests/remote-client-bootstrap.test.ts` / `tests/integration-remote-full-stack.test.ts` suites run
green with zero edits; a structural check asserts `services.ts` passes a `nodePty` option derived
from the REQ-005 resolver.

### REQ-019 — Missing/invalid local bundle is a specific fatal
When the decision path needs the local bundle (matched target, decision would be skip-or-install)
and `<prebuiltRoot>/node-pty/<target>/` is absent or fails manifest validation (missing file,
unreadable/malformed `.termhalla-prebuilt.json`), the connect MUST fail (kind `fatal`) before any
upload, with a diagnostic naming the expected local path and how to get a bundle (released
installers ship it; a dev checkout must run the staging script / lacks a Linux prebuilt by design).
No partial upload may occur.
**Acceptance:** scenarios with (a) an empty `prebuiltRoot`, (b) a bundle missing `pty.node`,
(c) a corrupt manifest — each asserts kind fatal, a diagnostic containing the expected path, and a
ledger containing the probe only.

### REQ-020 — End-to-end: the agent's bare import resolves after co-provision
*(Amended in the ESC-003 loopback — FINDING-021: the connect-FLOW concurrency vector is mandated,
not only the unpacker-level one.)*

After a successful install, launching the agent with `--pty=node-pty` MUST resolve `node-pty` from
`<agentDir>/node_modules/node-pty` and reach hello — including under two concurrent connects to
the same host/agentDir shipping the same release, where BOTH connects MUST reach hello (the
REQ-015 reader-atomic promote + the REQ-016 recovery cycle make this hold at the flow level, not
merely at the unpacker level). The feature MUST NOT modify the lazy dynamic `import('node-pty')`
(frozen TEST-755 stays green and unamended) nor bundle any native payload into
`termhalla-agent.cjs` — resolution succeeds purely by module placement.
**Acceptance:** an integration test (windows-latest-safe): build the real agent bundle on demand
(the existing F16 harness path via `vite.agent.config.ts`); use a fixture target bundle whose
`lib/` is a pure-JS stub implementing the node-pty surface the agent touches (spawn/write/resize/
kill/pause/resume/onData/onExit — scripted echo) and whose `pty.node` is arbitrary bytes matching
the fixture manifest sha; run `connectWithProvisioning` with `ptyBackend: 'node-pty'` through
fake-ssh against a fresh fake home; assert hello establishes and one `pty:spawn` → `pty:data`
round trip works. **Flow-level concurrency vector (mandated by ESC-003):** two overlapping
`connectWithProvisioning` calls against the SAME fresh fake home (deterministically interleaved so
their probe/install/launch windows overlap) ⇒ BOTH results reach hello, the remote holds exactly
one final install equal to the shipped bundle, and no `*.tmp` dir remains. TEST-755 and the agent
bundle content are untouched (no `src/agent/` diff needed by this feature).

### REQ-021 — glibc-floor hint on ANY dlopen-era GLIBC failure
*(Amended in the ESC-003 loopback — FINDING-009: previously the hint was only reachable through
the module-resolution failure detector, whose regex a real `GLIBC_x.y' not found` stderr does not
match, leaving the hint dead on exactly the failure class it exists for. Upgraded SHOULD→MUST with
flow-level acceptance.)*

When ANY pre-hello agent-launch fatal's sanitized stderr matches a `GLIBC_<x.y>' not found`-class
pattern, the fatal diagnostic MUST append a hint naming the shipped prebuilt's glibc floor (2.31)
and the manual-install escape hatch (the host is older than the floor — the one no-match class the
probe cannot see). This decoration MUST be applied independently of (and in addition to) the
module-resolution failure detection — it MUST NOT require the stderr to also match a
module-resolution pattern — and a GLIBC-class launch failure MUST NOT trigger the REQ-016 recovery
cycle (reinstalling the same binary cannot help an old glibc).
**Acceptance:** a unit test on the diagnostic decoration: stderr containing
`version 'GLIBC_2.34' not found` yields a diagnostic containing the floor and the escape-hatch
path; unrelated stderr yields no hint. A **flow-level test (mandated by ESC-003)**: a fake-ssh rig
whose post-install agent launch dies before hello with stderr
`version 'GLIBC_2.34' not found (required by .../node_modules/node-pty/build/Release/pty.node)`
(NO module-resolution wording) ⇒ the returned fatal diagnostic contains `2.31` and the
`node_modules/node-pty` escape hatch, and the ledger shows NO recovery probe/install/relaunch.

---

## E — Preserved invariants

### REQ-022 — remote-client structural guards survive unamended
All of TEST-2001..TEST-2006 MUST pass without modification: new pure modules (probe/selection/
decision/payload builders + parsers) live under `src/remote-client/`; no electron/renderer/preload/
main import; no ssh library; no `shell: true`; `src/preload`/`src/renderer` still never import
`remote-client`. In particular (TEST-2004): no `src/remote-client` source may contain the string
`package.json` — the upload set is enumerated **dynamically** (recursive readdir of the target
bundle dir), never by a hard-coded file list naming node-pty's manifest; versions and paths remain
caller-injected.
**Acceptance:** the frozen `tests/remote-client-structure.test.ts` suite passes with zero edits on
the implemented feature (its dynamic `walk` picks the new files up automatically).

### REQ-023 — No persisted-state change, no secrets
The feature MUST NOT bump `SCHEMA_VERSION`, add a persisted store under `userData`, or persist any
probe output/host detail (confirming the intake's expectation: the marker lives on the REMOTE host;
locally the prebuilt is a build artifact). Manifests and markers contain only
version/target/path/hash strings — no credentials, no host identity.
**Acceptance:** a feature-scoped structural test (CONV-022-safe: it pins this feature's own
invariant, not the shared constant's value) asserts no file added/modified by this feature under
`src/remote-client/`, `src/main/remote/`, or `scripts/` references `SCHEMA_VERSION` or Electron
`userData` APIs; a unit test asserts the manifest/marker type contains exactly the whitelisted
fields (`formatVersion`, `nodePtyVersion`, `target`, `ptyNodeSha256`, `files`).

### REQ-024 — The CI test lane stays native-free and build-free
Every test this feature adds MUST pass under `npm test` on windows-latest with no `npm run build`,
no docker, no real ssh/network, no real prebuilt, and no native compilation — stub modules and the
fake-ssh shim only (locked testing posture). `ci.yml` gains nothing from this feature.
**Acceptance:** the full new suite runs green via plain `npm test` on a checkout without `out/`
prebuilts (the REQ-020 integration test builds only the JS agent bundle on demand, as today); a
scoped structural test asserts `ci.yml` does not reference this feature's staging script or a
container/docker step (CONV-037: keyed on the feature-specific script name, not shared strings).

### REQ-025 — fake-ssh shim extension is a sanctioned, additive frozen-fixture amendment
`tests/fixtures/fake-ssh.mjs` (a FROZEN 0020 fixture that `die(12)`s on unknown command shapes)
MUST be amended through THIS feature's tests phase (CONV-012 co-ownership; never silently during
implementation) to: recognize the two new command shapes (the REQ-008 probe and the REQ-014
install) — it MAY execute the embedded `node -e` scripts with the local node for fidelity;
keep existing launch/upload handling byte-identical; log the new kinds (`probe`,
`node-pty-install`) to `FAKE_SSH_LOG`; and gain env-driven rigs for: a synthesized probe triple
(so non-win32 triples are testable on windows-latest), install truncation (→ 93), pty.node
corruption (→ 94), probe stdout rc-noise, an unbounded/oversized probe stdout stream (REQ-026),
a launch that dies with rigged stderr (module-resolution and GLIBC classes — REQ-016/REQ-021),
and a pre-seeded remote install whose on-disk `pty.node` bytes mismatch its intact marker (the
REQ-012 self-repair fixture). The shim MUST remain network-module-free (TEST-2006 keeps passing)
and POSIX-shell-free.
**Acceptance:** all pre-existing F19/F21/integration suites pass against the amended shim with
zero test edits; TEST-2006 passes; each new rig is exercised by at least one scenario in this
feature's suite.

### REQ-026 — Bounded, early-settling probe channel
*(Added in the ESC-003 loopback — FINDING-010: the probe previously accumulated remote stdout
without limit inside the privileged Electron main process; a remote whose login shell streams
endless stdout grew memory unboundedly and wedged the connect.)*

The client-side probe runner MUST (a) retain at most the probe-stdout cap (Definitions — a named,
exported constant, sized to hold the sentinel line plus generous rc noise) of TRAILING probe
stdout, discarding older bytes as they overflow (CONV-003: the cap is stated here and asserted by
test, never silent), and (b) settle the probe as soon as a parseable sentinel line has been decoded
— tearing the ssh child down (kill + stream destroy, the F19 posture) rather than waiting for the
stream to end — so an endless-stdout remote can neither wedge the connect nor grow client memory
without bound. A sentinel-less stream that ends (or is torn down) still classifies per REQ-009's
rc-noise row, with any stdout excerpt in the diagnostic bounded by the same cap.
**Acceptance:** a unit test on the accumulator seam feeds it more than the cap and asserts the
retained window never exceeds the cap and that a sentinel arriving AFTER heavy noise still parses
(the window holds the sentinel line); a fake-ssh scenario whose probe emits the sentinel and then
keeps streaming asserts the connect proceeds without waiting for stream end (the probe settles on
sentinel; the child is torn down); a sentinel-less oversized-stream rig asserts the rc-noise fatal
is produced with a diagnostic excerpt bounded by the cap.

---

## Public interface

New/changed surfaces (module filenames indicative — exported semantics and wire shapes are the
contract):

- `src/remote-client/prebuilt.ts` (pure): `buildNodePtyProbeCommand(agentDir)`,
  `parseProbeStdout(stdout)`, `classifyProbeOutcome(observation)`, `deriveLibc(probe)`,
  `selectPrebuiltTarget(triple)`, `decideNodePtyProvision(probe, target, localManifest)`,
  `buildNodePtyInstallCommand(agentDir, nonce)`, `encodeNodePtyPayload(files, ptyNodeSha256)`,
  constants `PREBUILT_TARGETS_V1`, `NODE_PTY_MARKER_FILE = '.termhalla-prebuilt.json'`,
  `NODE_PTY_BYTES_EXIT = 93`, `NODE_PTY_SHA_EXIT = 94`, `NODE_PTY_RACE_EXIT = 95`, the probe
  sentinel prefix, the probe-stdout cap constant (REQ-026), and the embedded
  `PROBE_SRC`/`UNPACK_SRC` script literals.
- Probe result shape: `{ platform, arch, glibc, marker, resolves, actualPtyNodeSha256, node }`
  (the `actualPtyNodeSha256` ground-truth field added by the ESC-003 amendment).
- `src/remote-client/bootstrap.ts`: `BootstrapOptions.nodePty?: { prebuiltRoot: string }`
  (additive; absent ⇒ behavior identical to v0.13.0). `ConnectResult`/`ConnectFailureKind`
  unchanged. Per-connect discipline: baseline one probe + at most one install; at most ONE
  recovery cycle (re-probe → decide → at most one more install → one relaunch) on a
  module-resolution launch failure (REQ-016).
- `src/main/remote/agent-artifact.ts`: `resolvePrebuiltRoot(opts: ArtifactPathOpts): string`.
- `scripts/` staging + verification script(s) with unit-testable pure cores
  (REQ-001/REQ-003), invoked by `release.yml`.
- Remote on-disk contract: `<agentDir>/node_modules/node-pty/` mirroring the bundle layout;
  marker `.termhalla-prebuilt.json`
  `{ formatVersion: 1, nodePtyVersion, target, ptyNodeSha256, files }`.
- Wire contract additions (frozen at tests phase, mirrored by the shim): the probe command shape,
  the install command shape + NODE_PTY_PAYLOAD_V1 stdin format (header entries
  `{ path, size, sha256 }` + `ptyNodeSha256`), sentinel exits 93/94/95, the probe sentinel line.

## Frozen-test collision survey (CONV-023)

Greps run 2026-07-05 over `C:\dev\Termhalla` (excluding `node_modules`):
- `connectWithProvisioning|prebuilt|resolveAgentArtifactPath` over `tests/` → 4 files
  (`remote-client-bootstrap`, `remote-client-gold`, `integration-remote-full-stack`,
  `main/remote-agent-artifact`). None passes the new option; REQ-018's absent-option
  byte-identical rule keeps them green unamended.
- `extraResources|electron-builder\.yml|release\.yml` over `tests/` → only TEST-2220/2221
  (tolerant regex; additive-safe).
- `1\.1\.0-beta34` repo-wide → manifests/lockfile/docs/patch filename only; no `src/`/`scripts/`
  hit (REQ-006 baseline).
- `tests/fixtures/fake-ssh.mjs` `die(12)`s on unknown command shapes → the ONE frozen artifact
  requiring a sanctioned amendment (REQ-025). TEST-755 (`src/agent` lazy import) and
  TEST-2001..2006 are untouched by design (REQ-020/REQ-022).
- *(loopback 2 note)* This feature's OWN already-frozen suites from the first implementation pass
  (the probe-shape pins, the NODE_PTY_PAYLOAD_V1 header pins, and the concurrency vectors
  TEST-2360/2362/2363, whose first-collision-95 expectation is superseded by the amended REQ-015
  rename-first/replace-retry semantics) MUST be amended through THIS loopback's tests phase — the
  sanctioned path for a spec-driven contract change, never a silent edit during implementation.

## Out of scope (confirmed from concept)

- `linux-arm64-glibc`, musl/Alpine, macOS/Windows remotes (additive fast-follows: one selection
  row + one bundle each).
- On-remote compilation / `npm install` fallback.
- Agent daemonization / session-survival changes; local-only app behavior; any renderer change.
- Lowering the glibc floor below 2.31 (documented fast-follow via manylinux_2_28).
- The deferred-findings backlog recorded in
  `docs/superpowers/0023-remote-node-pty-prebuilt-review-followups.md` (per the human deferral
  decision of 2026-07-05: FINDINGs 001/002/003/004/006/007/008/011/012/014/015/016/018/019).

## Open questions

None. The two questions the concept deferred to spec are decided above: the glibc floor/base is
2.31 / Ubuntu-20.04-class (Definitions, REQ-002 — the locked principle was build-on-oldest; 2.28
is a recorded fast-follow), and the marker shape + no-SCHEMA_VERSION confirmation are REQ-012/
REQ-015/REQ-023. The FINDING-013 concurrency question was resolved by human decision
ESC-001/ESC-002 and is now normative in REQ-015. The FINDING-020 skip-integrity question and its
robustness cluster (017/021/010/009/005) were resolved by human decision ESC-003 and are now
normative in REQ-008/REQ-012/REQ-014/REQ-015/REQ-016/REQ-020/REQ-021/REQ-026 (race-tolerant
reader-atomic promote, ground-truth skip verification, whole-payload integrity, bounded probe,
always-reachable glibc hint, honest terminal wording).
