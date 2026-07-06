/**
 * Node-pty prebuilt co-provisioning (feature 0023, REQ-008..015/021/022).
 *
 * A stock `(linux, x64, glibc)` remote only has `node` on it — the agent's lazy
 * `import('node-pty')` (`src/agent/node-pty-backend.ts`, frozen TEST-755) otherwise fails with
 * `ERR_MODULE_NOT_FOUND`. This module is the PURE half of the co-provision flow: it builds the
 * two `node -e '<script>' <args>` remote command shapes (a read-only probe, and a transactional
 * unpacker), classifies/decides on the probe result, and encodes the upload payload. The IMPURE
 * orchestration (spawning ssh, wiring the two channels into `connectWithProvisioning`) lives in
 * `bootstrap.ts` — this file never touches a socket, a child process, or the filesystem.
 *
 * REQ-022/TEST-2004 discipline: this file never hard-codes any bundle file's name (including
 * node-pty's own manifest filename) — the upload file set is enumerated DYNAMICALLY by the
 * caller (a recursive readdir of the staged bundle dir), never a hard-coded file list.
 * `PROBE_SRC`/`UNPACK_SRC` are fixed, single-quote-free
 * script literals with no per-connection interpolated data (only the two feature-wide constants
 * below are baked in at module-load time, not per call).
 */

// ---------------------------------------------------------------------------------------------
// Frozen wire vocabulary (REQ-008/REQ-011/REQ-015).
// ---------------------------------------------------------------------------------------------

/** The one line of probe stdout that matters begins with this literal prefix. */
export const NODE_PTY_PROBE_SENTINEL = 'TERMHALLA_PROBE_V1 '

/** The remote marker file inside an installed `node-pty` package dir. */
export const NODE_PTY_MARKER_FILE = '.termhalla-prebuilt.json'

/** Unpacker sentinel exits (REQ-015): 93 = byte-count/short-read failure, 94 = sha-256 mismatch.
 *  Both mean "nothing was promoted, temp state removed". */
export const NODE_PTY_BYTES_EXIT = 93
export const NODE_PTY_SHA_EXIT = 94

/** Promote-collision-with-a-DIVERGENT-install sentinel (REQ-015 as amended by the FINDING-013 /
 *  ESC-001 / ESC-002 loopback). A rename collision against an install whose marker sha equals
 *  ours is a benign lost race (exit 0, never reported here); this exit is reserved for the case
 *  where the now-present install is NOT the one we were about to promote — never conflated with
 *  93 (a promote collision is never a byte-count failure). */
export const NODE_PTY_RACE_EXIT = 95

/** The v1 prebuilt target set — exactly one row (REQ-011). */
export const PREBUILT_TARGETS_V1 = ['linux-x64-glibc'] as const
export type PrebuiltTarget = (typeof PREBUILT_TARGETS_V1)[number]

// ---------------------------------------------------------------------------------------------
// Shared types.
// ---------------------------------------------------------------------------------------------

export interface PrebuiltManifest {
  formatVersion: number
  nodePtyVersion: string
  target: string
  ptyNodeSha256: string
  /** A sha-256 for EVERY shipped file (the manifest itself excluded), keyed by forward-slash
   *  relative path (REQ-001 as amended, ESC-003 / FINDING-005). The payload's per-entry sha
   *  source. */
  files: Record<string, string>
}

export interface NodePtyProbeResult {
  platform: string
  arch: string
  glibc: string | null
  /** The parsed remote marker file, or null when absent/unreadable/unparseable. Loosely typed
   *  (never trusted structurally until compared field-by-field in decideNodePtyProvision) since
   *  it round-trips through a remote JSON.parse of a file this client did not just write. */
  marker: unknown
  resolves: boolean
  /** The GROUND-TRUTH sha-256 (lowercase hex, node:crypto) of the bytes ACTUALLY on disk at
   *  `<agentDir>/node_modules/node-pty/build/Release/pty.node`, or null when that file is
   *  absent/unreadable — NEVER the marker's self-claimed value (REQ-008 as amended, ESC-003 /
   *  FINDING-020). The skip decision is gated on this, not the marker. */
  actualPtyNodeSha256: string | null
  node: string
}

export type Libc = 'glibc' | 'non-glibc'

export interface PlatformTriple {
  platform: string
  arch: string
  libc: Libc
}

export type SelectResult =
  | { ok: true; target: PrebuiltTarget }
  | { ok: false; triple: PlatformTriple }

export type ProvisionDecision =
  | { kind: 'skip' }
  | { kind: 'install' }
  | { kind: 'proceed-unmanaged' }
  | { kind: 'no-match' }

export interface PayloadFile {
  path: string
  bytes: Buffer
  /** The file's expected sha-256 (lowercase hex), caller-sourced from the local manifest's
   *  `files` map — the manifest file's own entry is computed from its bytes at encode time
   *  (REQ-014 as amended, ESC-003 / FINDING-005). Carried in the header so the remote unpacker
   *  verifies EVERY received file, not only pty.node. */
  sha256: string
}

// ---------------------------------------------------------------------------------------------
// Validation helpers (mirrors the wording/posture of ssh-command.ts's checkRemotePath — REQ-006's
// injection discipline extended to the two new remote command shapes; duplicated rather than
// imported so this module stays a single, self-contained, dependency-free pure module).
// ---------------------------------------------------------------------------------------------

const SAFE_REMOTE_PATH = /^[A-Za-z0-9._/~-]+$/
const SAFE_NONCE = /^[A-Za-z0-9]+$/

const checkAgentDir = (p: string): void => {
  if (typeof p !== 'string' || p.length === 0) {
    throw new Error(`invalid remoteAgentDir (${JSON.stringify(p)}): must be a non-empty remote path`)
  }
  if (p.startsWith('-')) {
    throw new Error(`invalid remoteAgentDir (${JSON.stringify(p)}): must not start with "-" (ssh option injection)`)
  }
  if (!SAFE_REMOTE_PATH.test(p)) {
    throw new Error(`invalid remoteAgentDir (${JSON.stringify(p)}): must match ${String(SAFE_REMOTE_PATH)} (it is interpolated into a remote shell command)`)
  }
  if (p === '..' || p.startsWith('../') || p.includes('/../') || p.endsWith('/..')) {
    throw new Error(`invalid remoteAgentDir (${JSON.stringify(p)}): must not contain ".." path segments`)
  }
}

const checkNonce = (nonce: string): void => {
  if (typeof nonce !== 'string' || nonce.length === 0 || !SAFE_NONCE.test(nonce)) {
    throw new Error(`invalid nonce (${JSON.stringify(nonce)}): must be a non-empty string matching ${String(SAFE_NONCE)} (it enters a remote command string)`)
  }
}

/** Client-side payload path validation (REQ-014): relative, no leading "/", no backslash, no
 *  ".." segment, non-empty. Mirrored (duplicated, by necessity) inside UNPACK_SRC for
 *  defense-in-depth re-validation on the remote side. */
const validatePayloadPath = (p: string): void => {
  if (typeof p !== 'string' || p.length === 0) {
    throw new Error(`invalid payload path (${JSON.stringify(p)}): must be a non-empty relative path`)
  }
  if (p.startsWith('/')) {
    throw new Error(`invalid payload path (${JSON.stringify(p)}): must not be absolute (no leading "/")`)
  }
  if (p.includes('\\')) {
    throw new Error(`invalid payload path (${JSON.stringify(p)}): must not contain a backslash "\\"`)
  }
  if (p.split('/').some((seg) => seg === '..')) {
    throw new Error(`invalid payload path (${JSON.stringify(p)}): must not contain ".." path segments`)
  }
}

// ---------------------------------------------------------------------------------------------
// PROBE_SRC (REQ-008) — a fixed, single-quote-free, data-free script. Prints exactly one
// sentinel-prefixed JSON line with six fields and ALWAYS exits 0 once it has printed that line
// (probe failures are field values, never exit codes). Reads the target dir from
// `process.argv[1]` (the one positional arg `node -e '<script>' <dir>` passes through).
// ---------------------------------------------------------------------------------------------
export const PROBE_SRC = `
(function () {
  var fs = require("fs");
  var path = require("path");
  var crypto = require("crypto");
  var agentDir = process.argv[1];
  var glibc = null;
  try {
    var report = (process.report && typeof process.report.getReport === "function")
      ? process.report.getReport() : null;
    var v = (report && report.header) ? report.header.glibcVersionRuntime : null;
    if (typeof v === "string" && v.length > 0) glibc = v;
  } catch (e) {}
  var marker = null;
  try {
    var markerPath = path.join(agentDir, "node_modules", "node-pty", "${NODE_PTY_MARKER_FILE}");
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch (e) {
    marker = null;
  }
  var resolves = false;
  try {
    require.resolve("node-pty", { paths: [agentDir] });
    resolves = true;
  } catch (e) {
    resolves = false;
  }
  var actualPtyNodeSha256 = null;
  try {
    var ptyNodePath = path.join(agentDir, "node_modules", "node-pty", "build", "Release", "pty.node");
    actualPtyNodeSha256 = crypto.createHash("sha256").update(fs.readFileSync(ptyNodePath)).digest("hex");
  } catch (e) {
    actualPtyNodeSha256 = null;
  }
  var out = {
    platform: process.platform,
    arch: process.arch,
    glibc: glibc,
    marker: marker,
    resolves: resolves,
    actualPtyNodeSha256: actualPtyNodeSha256,
    node: process.version
  };
  process.stdout.write("${NODE_PTY_PROBE_SENTINEL}" + JSON.stringify(out) + "\\n");
})();
`.trim()

// ---------------------------------------------------------------------------------------------
// UNPACK_SRC (REQ-014/REQ-015) — a fixed, single-quote-free, data-free script. Reads the
// NODE_PTY_PAYLOAD_V1 stream from stdin, re-validates every header path (defense in depth,
// before any write), verifies byte counts and EVERY file's sha-256 (not only pty.node —
// ESC-003/FINDING-005) IN MEMORY before touching disk, stages into a nonce-named temp dir, and
// promotes RENAME-FIRST (reader-atomic — no prior rm of the final dir, so a concurrently
// launching agent can never observe node-pty transiently absent; ESC-003/FINDING-021). On a
// rename collision it reads the present marker: an identical sha is a benign lost race (exit 0,
// final dir untouched); a divergent/absent one is the ordinary clean-reinstall (remove the final
// dir, retry once); a divergence persisting through that retry is exit 95. On any other failure:
// temp removed, exit with the distinguishing sentinel.
// ---------------------------------------------------------------------------------------------
export const UNPACK_SRC = `
(function () {
  var fs = require("fs");
  var path = require("path");
  var crypto = require("crypto");
  var BYTES_EXIT = ${NODE_PTY_BYTES_EXIT};
  var SHA_EXIT = ${NODE_PTY_SHA_EXIT};
  var RACE_EXIT = ${NODE_PTY_RACE_EXIT};
  var MARKER_FILE = "${NODE_PTY_MARKER_FILE}";

  function fail(code, msg) {
    process.stderr.write(msg + "\\n");
    process.exit(code);
  }

  var agentDir = process.argv[1];
  var nonce = process.argv[2];
  var nodeModulesDir = path.join(agentDir, "node_modules");
  var finalDir = path.join(nodeModulesDir, "node-pty");
  var tmpDir = path.join(nodeModulesDir, "node-pty." + nonce + ".tmp");

  function removeTmp() { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} }
  function readMarkerSha(dir) {
    try {
      var m = JSON.parse(fs.readFileSync(path.join(dir, MARKER_FILE), "utf8"));
      if (m && typeof m.ptyNodeSha256 === "string") return m.ptyNodeSha256;
    } catch (e) {}
    return null;
  }
  function readActualPtyNodeSha(dir) {
    try {
      return crypto.createHash("sha256")
        .update(fs.readFileSync(path.join(dir, "build", "Release", "pty.node"))).digest("hex");
    } catch (e) {}
    return null;
  }

  var body;
  try {
    body = fs.readFileSync(0);
  } catch (e) {
    fail(BYTES_EXIT, "failed to read the node-pty payload from stdin (short read): " + e.message);
    return;
  }

  var nl = body.indexOf(10);
  if (nl < 0) {
    fail(BYTES_EXIT, "malformed payload: no newline-terminated header line found (short read)");
    return;
  }
  var header;
  try {
    header = JSON.parse(body.slice(0, nl).toString("utf8"));
  } catch (e) {
    fail(BYTES_EXIT, "malformed payload header (short read / corrupt bytes): " + e.message);
    return;
  }
  var files = Array.isArray(header.files) ? header.files : [];

  function isSafeRelative(p) {
    if (typeof p !== "string" || p.length === 0) return false;
    if (p.charAt(0) === "/") return false;
    if (p.indexOf(String.fromCharCode(92)) !== -1) return false;
    var parts = p.split("/");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "..") return false;
    }
    return true;
  }

  for (var i = 0; i < files.length; i++) {
    if (!isSafeRelative(files[i].path)) {
      fail(BYTES_EXIT, "invalid path in node-pty payload: " + JSON.stringify(files[i].path) +
        " (must be a relative path with no .. segments and no backslashes)");
      return;
    }
  }

  var offset = nl + 1;
  var pieces = [];
  for (var j = 0; j < files.length; j++) {
    var fj = files[j];
    var size = fj.size;
    if (typeof size !== "number" || size < 0 || !isFinite(size)) {
      fail(BYTES_EXIT, "invalid declared size for " + fj.path + ": " + JSON.stringify(size));
      return;
    }
    var available = body.length - offset;
    if (available < size) {
      fail(BYTES_EXIT, "short read for " + fj.path + ": expected " + size + " bytes, got " + available);
      return;
    }
    pieces.push({ path: fj.path, bytes: body.slice(offset, offset + size) });
    offset += size;
  }
  if (offset !== body.length) {
    fail(BYTES_EXIT, "node-pty payload has " + (body.length - offset) +
      " unexpected trailing bytes beyond the declared total (expected exactly " + offset + " bytes)");
    return;
  }

  // Per-file sha-256 verification of EVERY received file (ESC-003/FINDING-005) — an
  // equal-byte-length content substitution in ANY file (a lib/*.js, not only pty.node) is caught
  // here, before any write, so a mismatch leaves the prior install untouched and no temp behind.
  for (var s = 0; s < pieces.length; s++) {
    var entrySha = String((files[s] && files[s].sha256) || "");
    var gotSha = crypto.createHash("sha256").update(pieces[s].bytes).digest("hex");
    if (gotSha !== entrySha) {
      fail(SHA_EXIT, "sha-256 checksum mismatch for " + pieces[s].path +
        ": expected " + entrySha + ", got " + gotSha);
      return;
    }
  }

  // pty.node is additionally required to equal the header top-level ptyNodeSha256.
  var ptyEntry = null;
  for (var k = 0; k < pieces.length; k++) {
    if (pieces[k].path === "build/Release/pty.node") { ptyEntry = pieces[k]; break; }
  }
  if (!ptyEntry) {
    fail(BYTES_EXIT, "node-pty payload is missing build/Release/pty.node (short read)");
    return;
  }
  var expectedSha = String(header.ptyNodeSha256 || "");
  var actualSha = crypto.createHash("sha256").update(ptyEntry.bytes).digest("hex");
  if (actualSha !== expectedSha) {
    fail(SHA_EXIT, "pty.node sha-256 checksum mismatch: expected " + expectedSha + ", got " + actualSha);
    return;
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    for (var m = 0; m < pieces.length; m++) {
      var piece = pieces[m];
      var dest = path.join(tmpDir, piece.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, piece.bytes);
    }
  } catch (e) {
    removeTmp();
    fail(BYTES_EXIT, "failed writing the staged node-pty install: " + e.message);
    return;
  }

  try { fs.mkdirSync(nodeModulesDir, { recursive: true }); } catch (e) {}

  // Promote step 1: rename-FIRST, no prior rm of the final dir (ESC-003/FINDING-021 —
  // reader-atomicity: the old rm-then-rename left node-pty transiently ABSENT, observable by a
  // concurrently launching agent import as a spurious ERR_MODULE_NOT_FOUND).
  var firstErr = null;
  try {
    fs.renameSync(tmpDir, finalDir);
    process.exit(0);
    return;
  } catch (e) { firstErr = e; }

  var code1 = (firstErr && firstErr.code) ? firstErr.code : "";
  var isCollision1 = code1 === "ENOTEMPTY" || code1 === "EEXIST" || code1 === "EPERM";
  if (!isCollision1) {
    removeTmp();
    fail(BYTES_EXIT, "failed to promote the staged node-pty install: " + firstErr.message);
    return;
  }

  // Collision: an install is already present. A benign lost race is a genuinely IDENTICAL,
  // sha-verified install — its marker sha AND its on-disk pty.node bytes must both equal ours
  // (verifying the binary, not the marker alone, is what makes a corrupted-binary-under-intact-
  // marker install self-repair instead of being trusted as identical — ESC-003 / FINDING-020).
  var observed1 = readMarkerSha(finalDir);
  var observedBin1 = readActualPtyNodeSha(finalDir);
  if (observed1 !== null && observed1 === expectedSha && observedBin1 !== null && observedBin1 === expectedSha) {
    // Benign lost race: another connect already promoted an identical, sha-verified install.
    // The final dir is NEVER removed — only our own temp goes.
    removeTmp();
    process.exit(0);
    return;
  }

  // Present install is stale/torn/divergent: the ordinary clean-reinstall path — the ONLY
  // sanctioned window in which the final dir is transiently absent, and only because what it held
  // did not match this payload anyway. Remove it and retry the rename EXACTLY once.
  var secondErr = null;
  try {
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, finalDir);
    process.exit(0);
    return;
  } catch (e2) { secondErr = e2; }

  var code2 = (secondErr && secondErr.code) ? secondErr.code : "";
  var isCollision2 = code2 === "ENOTEMPTY" || code2 === "EEXIST" || code2 === "EPERM";
  var observed2 = readMarkerSha(finalDir);
  removeTmp();
  if (isCollision2) {
    // A genuinely concurrent divergent promoter reappeared after the replace retry: leave the
    // destination to the other connect, exit 95 (never 93 — a collision is not a byte failure).
    fail(RACE_EXIT,
      "node-pty install lost a concurrent-install promote collision at " + finalDir +
      " (rename failed with " + (code1 || code2 || "an unknown collision error") + "): another " +
      "connect install is present there and diverges from ours - expected marker " +
      "ptyNodeSha256 " + expectedSha + ", observed marker ptyNodeSha256 " +
      (observed2 !== null ? observed2 : "none (no readable marker present)") +
      " - reconnect: the next connect probe will detect and repair this deterministically."
    );
    return;
  }
  fail(BYTES_EXIT, "failed to promote the staged node-pty install after a replace retry: " + secondErr.message);
  return;
})();
`.trim()

// ---------------------------------------------------------------------------------------------
// Probe command builder + parser (REQ-008).
// ---------------------------------------------------------------------------------------------

/** `node -e '<PROBE_SRC>' <agentDir>` — one exec channel, read-only (REQ-008). */
export function buildNodePtyProbeCommand(agentDir: string): string {
  checkAgentDir(agentDir)
  return `node -e '${PROBE_SRC}' ${agentDir}`
}

/** Line-by-line scan for the sentinel prefix (REQ-009): shell-rc noise before/after never
 *  breaks parsing. Returns the parsed probe result, or null if no line both starts with the
 *  sentinel AND parses as a JSON object. */
export function parseProbeStdout(stdout: string): NodePtyProbeResult | null {
  for (const line of stdout.split('\n')) {
    if (!line.startsWith(NODE_PTY_PROBE_SENTINEL)) continue
    try {
      const obj: unknown = JSON.parse(line.slice(NODE_PTY_PROBE_SENTINEL.length))
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        return obj as NodePtyProbeResult
      }
    } catch {
      // Keep scanning: a shell rc could echo a sentinel-prefixed line elsewhere too.
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Probe outcome classification (REQ-009).
// ---------------------------------------------------------------------------------------------

/** Strip C0/C1 control bytes (built from char codes — never embedded as literal escapes here)
 *  so remote stderr/stdout can never smuggle terminal escape sequences into a diagnostic string
 *  a UI will later render (mirrors bootstrap.ts's sanitizeStderr posture, FINDING-001). */
const CONTROL_CHARS_PATTERN = ((): RegExp => {
  const codes: number[] = []
  for (let i = 0; i <= 0x1f; i++) codes.push(i)
  codes.push(0x7f)
  for (let i = 0x80; i <= 0x9f; i++) codes.push(i)
  const chars = codes.map((c) => String.fromCharCode(c)).join('')
  return new RegExp(`[${chars}]+`, 'g')
})()

const sanitizeStderr = (text: string): string => text.replace(CONTROL_CHARS_PATTERN, ' ')

export interface ProbeObservation {
  exitCode: number | null
  stdout: string
  stderrExcerpt: string
}

export type ProbeClassification =
  | { kind: 'fatal'; diagnostic: string }
  | { kind: 'probe'; probe: NodePtyProbeResult }

export function classifyProbeOutcome(o: ProbeObservation): ProbeClassification {
  if (o.exitCode === 255) {
    return {
      kind: 'fatal',
      diagnostic: `ssh transport failure while probing for node-pty (exit 255) — check host reachability and authentication for this destination — stderr: ${sanitizeStderr(o.stderrExcerpt)}`
    }
  }
  if (o.exitCode === 127) {
    return {
      kind: 'fatal',
      diagnostic: 'the remote has no node on the PATH of a non-interactive login shell — the agent requires node to be installed and reachable there (fix PATH for non-interactive/login shells, e.g. ~/.bash_profile or ~/.profile, or install node on the host)'
    }
  }
  const probe = parseProbeStdout(o.stdout)
  if (probe !== null) return { kind: 'probe', probe }
  return {
    kind: 'fatal',
    diagnostic: `the node-pty probe produced no parseable sentinel line on stdout — a classic cause: a shell rc file printing to stdout on non-interactive exec (silence the rc output for non-interactive shells) — stdout: ${sanitizeStderr(o.stdout).slice(0, 200)}`
  }
}

// ---------------------------------------------------------------------------------------------
// libc determination (REQ-010).
// ---------------------------------------------------------------------------------------------

export const deriveLibc = (probe: { glibc: string | null }): Libc =>
  (typeof probe.glibc === 'string' && probe.glibc.length > 0) ? 'glibc' : 'non-glibc'

// ---------------------------------------------------------------------------------------------
// Deterministic prebuilt target selection (REQ-011).
// ---------------------------------------------------------------------------------------------

export function selectPrebuiltTarget(triple: PlatformTriple): SelectResult {
  if (triple.platform === 'linux' && triple.arch === 'x64' && triple.libc === 'glibc') {
    return { ok: true, target: 'linux-x64-glibc' }
  }
  return { ok: false, triple: { platform: triple.platform, arch: triple.arch, libc: triple.libc } }
}

// ---------------------------------------------------------------------------------------------
// Provision decision table (REQ-012).
// ---------------------------------------------------------------------------------------------

const asManifest = (marker: unknown): Partial<PrebuiltManifest> | null =>
  (marker !== null && typeof marker === 'object') ? (marker as Partial<PrebuiltManifest>) : null

const manifestsMatch = (rawMarker: unknown, local: PrebuiltManifest | null): boolean => {
  const marker = asManifest(rawMarker)
  return marker !== null && local !== null &&
    marker.nodePtyVersion === local.nodePtyVersion &&
    marker.target === local.target &&
    marker.ptyNodeSha256 === local.ptyNodeSha256
}

export function decideNodePtyProvision(
  probe: NodePtyProbeResult,
  selection: SelectResult,
  localManifest: PrebuiltManifest | null
): ProvisionDecision {
  if (selection.ok) {
    // Skip is GROUND-TRUTH-verified (ESC-003 / FINDING-020): beyond a full marker match and a
    // resolvable specifier, the hash of the bytes ACTUALLY on disk must equal the local manifest
    // sha. A torn/corrupted/deleted on-disk pty.node under an intact marker (actualPtyNodeSha256
    // null or different) forces a reinstall — self-repair, never a permanent skip→launch-fail
    // wedge; the self-written marker's claim is never trusted alone.
    if (
      manifestsMatch(probe.marker, localManifest) &&
      probe.resolves === true &&
      localManifest !== null &&
      probe.actualPtyNodeSha256 === localManifest.ptyNodeSha256
    ) {
      return { kind: 'skip' }
    }
    return { kind: 'install' }
  }
  return probe.resolves === true ? { kind: 'proceed-unmanaged' } : { kind: 'no-match' }
}

// ---------------------------------------------------------------------------------------------
// Install command + payload encoder (REQ-014).
// ---------------------------------------------------------------------------------------------

/** `node -e '<UNPACK_SRC>' <agentDir> <nonce>` — one exec channel (REQ-014). */
export function buildNodePtyInstallCommand(agentDir: string, nonce: string): string {
  checkAgentDir(agentDir)
  checkNonce(nonce)
  return `node -e '${UNPACK_SRC}' ${agentDir} ${nonce}`
}

/** NODE_PTY_PAYLOAD_V1: one JSON header line, then every file's bytes concatenated in header
 *  order (REQ-014). Every path is validated on the client before encoding (defense in depth is
 *  the remote unpacker's re-validation, in UNPACK_SRC). */
export function encodeNodePtyPayload(files: PayloadFile[], ptyNodeSha256: string): Buffer {
  for (const f of files) validatePayloadPath(f.path)
  const header = JSON.stringify({
    format: 1,
    files: files.map((f) => ({ path: f.path, size: f.bytes.length, sha256: f.sha256 })),
    ptyNodeSha256
  })
  return Buffer.concat([Buffer.from(`${header}\n`, 'utf8'), ...files.map((f) => f.bytes)])
}

// ---------------------------------------------------------------------------------------------
// glibc-floor hint (REQ-021, SHOULD).
// ---------------------------------------------------------------------------------------------

const GLIBC_FLOOR = '2.31'
const GLIBC_NOT_FOUND_RE = /GLIBC_[0-9]+(?:\.[0-9]+)*["']?\s*not found/i

/** When a post-install agent launch dies before hello with a dlopen-era glibc error, name the
 *  shipped prebuilt's glibc floor and the manual-install escape hatch; '' when unrelated. */
export function glibcFloorHint(sanitizedStderr: string): string {
  if (sanitizedStderr.length === 0 || !GLIBC_NOT_FOUND_RE.test(sanitizedStderr)) return ''
  return `the remote glibc looks older than this build's shipped node-pty prebuilt floor (${GLIBC_FLOOR}) — the escape hatch: manually install the pinned node-pty version at <agentDir>/node_modules/node-pty on the host, then reconnect`
}

// ---------------------------------------------------------------------------------------------
// Bounded, early-settling probe-stdout accumulator (REQ-026, ESC-003 / FINDING-010).
// ---------------------------------------------------------------------------------------------

/** The probe-stdout cap (order 64 KiB — CONV-003: stated here and asserted by test): the client
 *  retains at most this many TRAILING chars of probe stdout, sized to hold the one sentinel line
 *  plus generous shell-rc noise. An endless-stdout remote can neither wedge the connect nor grow
 *  client memory without bound. */
export const NODE_PTY_PROBE_STDOUT_CAP = 65536

/** Pure trailing-window accumulator: append `chunk` to `window`, retaining only the last `cap`
 *  chars (older chars discarded on overflow). The seam the probe runner feeds every stdout chunk
 *  through instead of unbounded string concatenation. */
export function appendBoundedProbeStdout(window: string, chunk: string, cap: number = NODE_PTY_PROBE_STDOUT_CAP): string {
  const combined = window + chunk
  return combined.length <= cap ? combined : combined.slice(combined.length - cap)
}
