/**
 * The single-instance / stale-reclaim decision core (REQ-005/REQ-007) plus the daemon metadata
 * shape builder/validator (REQ-003) shared by `daemon-server.ts` (writer) and `bridge.ts`
 * (reader). Pure — no IO, no processes; every seam (connect probe, pid liveness, fs) is
 * injected by the impure callers.
 */
import { DAEMON_METADATA_FORMAT_VERSION } from './daemon-constants'

// ── metadata shape (REQ-003) ────────────────────────────────────────────────────────────────

export interface DaemonMetadataInput {
  pid: number
  version: string
  /** The daemon's WIRE-protocol version (REQ-003, D4′) — decoupled from `version` (the app
   *  version). A newer client reads it from an older daemon's file to detect protocol drift. */
  proto: number
  backend: string
  startedAt: string
}

export interface DaemonMetadata extends DaemonMetadataInput {
  formatVersion: number
  // An index signature keeps this cross-version-frozen shape castable to `Record<string,
  // unknown>` at call sites that enumerate its keys (e.g. TEST-2404) without weakening the
  // named fields above.
  [key: string]: unknown
}

/** Emits EXACTLY `{formatVersion, pid, version, proto, backend, startedAt}` — no other fields, no
 *  secrets, no host identity (REQ-003). */
export const buildDaemonMetadata = (input: DaemonMetadataInput): DaemonMetadata => ({
  formatVersion: DAEMON_METADATA_FORMAT_VERSION,
  pid: input.pid,
  version: input.version,
  proto: input.proto,
  backend: input.backend,
  startedAt: input.startedAt
})

export type ValidateDaemonMetadataResult =
  | { ok: true; meta: DaemonMetadata }
  | { ok: false; reason: string }

const EXPECTED_METADATA_KEYS = ['backend', 'formatVersion', 'pid', 'proto', 'startedAt', 'version']

/** Validates a raw (possibly foreign/tampered/older) daemon.json — NEVER throws. An older
 *  daemon's formatVersion-1 file is accepted by a newer client (cross-version frozen shape). */
export const validateDaemonMetadata = (raw: unknown): ValidateDaemonMetadataResult => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'daemon metadata must be a JSON object' }
  }
  const obj = raw as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  if (keys.length !== EXPECTED_METADATA_KEYS.length || keys.some((k, i) => k !== EXPECTED_METADATA_KEYS[i])) {
    return {
      ok: false,
      reason: `daemon metadata must have exactly the keys ${EXPECTED_METADATA_KEYS.join(', ')} — got ${keys.join(', ') || '(none)'}`
    }
  }
  if (obj.formatVersion !== DAEMON_METADATA_FORMAT_VERSION) {
    return {
      ok: false,
      reason: `daemon metadata formatVersion must be ${DAEMON_METADATA_FORMAT_VERSION}, got ${JSON.stringify(obj.formatVersion)}`
    }
  }
  if (typeof obj.pid !== 'number' || typeof obj.version !== 'string' || typeof obj.proto !== 'number' ||
      typeof obj.backend !== 'string' || typeof obj.startedAt !== 'string') {
    return {
      ok: false,
      reason: 'daemon metadata has a wrongly-typed field (pid/proto must be numbers; version/backend/startedAt must be strings)'
    }
  }
  return {
    ok: true,
    meta: {
      formatVersion: obj.formatVersion,
      pid: obj.pid,
      version: obj.version,
      proto: obj.proto,
      backend: obj.backend,
      startedAt: obj.startedAt
    }
  }
}

// ── shared endpoint-bootstrap discipline (REQ-003, FINDING-005) ─────────────────────────────
// Extracted in the 2026-07-17 whole-project quality audit (finding 9), on the FINDING-022
// precedent: the pure seam `bootstrapDaemonEndpoint` (pinned by the frozen
// tests/agent-daemon-guard.test.ts) and the production bind path (`listenOnce` + `runDaemon`'s
// metadata write) each re-implemented the umask-wrapped-bind and metadata-mode ordering — so the
// tested unit was NOT the production unit. Both now call the ONE implementation below. Pure in
// this module's sense: the umask/bind/write seams are injected by the impure callers.

/** The restrictive umask in force during the bind: clears group/other bits so the socket file is
 *  born 0600 the instant it exists (FINDING-005 — a chmod-after-listen ordering is
 *  non-compliant; the kernel accepts connections at the creation-time mode the moment listen()
 *  succeeds). */
export const DAEMON_BIND_UMASK = 0o077

/** The daemon metadata file mode: owner-only, matching the socket (REQ-003). */
export const DAEMON_METADATA_MODE = 0o600

/** POSIX order EXACTLY umask(DAEMON_BIND_UMASK) → bind → umask(prior): the prior umask is
 *  restored as soon as the bind settles (success OR failure), and a bind failure propagates to
 *  the caller unswallowed. win32 named pipes have no file mode — the exemption lives IN this one
 *  helper: the bind runs with no umask call at all. */
export const bindWithRestrictiveUmask = async <T>(
  platform: NodeJS.Platform,
  umask: (mask: number) => number,
  bind: () => Promise<T>
): Promise<T> => {
  if (platform === 'win32') return await bind()
  const prior = umask(DAEMON_BIND_UMASK)
  try {
    return await bind()
  } finally {
    umask(prior)
  }
}

/** The ONE metadata announcement: builds the exact frozen shape (`buildDaemonMetadata`) and
 *  writes it at `DAEMON_METADATA_MODE` through the injected write seam. Callers uphold the
 *  strictly-after-listen ordering (metadata existence implies a bound listener — REQ-003) by
 *  invoking this only once their bind has succeeded. */
export const writeDaemonMetadata = async (
  writeFile: (path: string, text: string, mode: number) => void | Promise<void>,
  metadataPath: string,
  metadata: DaemonMetadataInput
): Promise<void> => {
  await writeFile(metadataPath, JSON.stringify(buildDaemonMetadata(metadata)), DAEMON_METADATA_MODE)
}

// ── shared over-long-socket-path guard (REQ-003, FINDING-022) ───────────────────────────────

/** The Linux `sockaddr_un.sun_path` size (108 bytes) minus the null terminator — the classic
 *  AF_UNIX path-length ceiling, measured in BYTES of the encoded path (FINDING-007; CONV-001:
 *  named here, never a raw EINVAL/ENAMETOOLONG). Win32 named pipes live in their own namespace
 *  and are exempt. This is the ONE definition of the limit (FINDING-022) — `daemon-server.ts`
 *  imports and calls `checkSocketPathLength` rather than re-deriving the comparison, so the pure
 *  bootstrap seam and the PRODUCTION bind path (`claimSocket`/`listenOnce`) can never diverge. */
const AF_UNIX_PATH_MAX = 107

export interface SocketPathLengthError {
  message: string
}

/** Byte-measured AF_UNIX path-length guard — the single source of truth for both the pure
 *  bootstrap seam and the production bind path. `null` on win32 (named-pipe paths are exempt —
 *  the exemption lives IN the guard) and for any in-limit POSIX path; otherwise the named
 *  path-and-limit error (never a raw EINVAL/ENAMETOOLONG). */
export const checkSocketPathLength = (
  socketPath: string,
  platform: NodeJS.Platform
): SocketPathLengthError | null => {
  if (platform === 'win32') return null
  const bytes = Buffer.byteLength(socketPath, 'utf8')
  if (bytes <= AF_UNIX_PATH_MAX) return null
  return {
    message:
      `daemon socket path "${socketPath}" encodes to ${bytes} bytes, exceeding the AF_UNIX ` +
      `sun_path limit of ${AF_UNIX_PATH_MAX} bytes for a unix domain socket — choose a shorter ` +
      `--socket path or agent dir (the limit is on the encoded path bytes, not its characters)`
  }
}

// ── reach decision table (REQ-005/REQ-007) ───────────────────────────────────────────────────

export interface DaemonReachObservation {
  /** Did a direct connect attempt to the socket path succeed? */
  connectable: boolean
  /** The pid recorded in daemon.json, or null when metadata is absent/unreadable. */
  metadataPid: number | null
  /** Whether `metadataPid` (when non-null) is currently a live process. */
  pidAlive: boolean
}

export type DaemonReachDecision =
  | { kind: 'attach' }
  | { kind: 'reclaim' }
  | { kind: 'wait' }

/**
 * Deterministic reach decision (CONV-045: never disturbs a live daemon):
 *  - connectable            -> attach (a listening daemon is never disturbed, regardless of
 *                               whether its metadata is even readable).
 *  - refused + live pid     -> wait (retry connecting within the readiness deadline; NEVER
 *                               reclaim while the recorded pid is alive).
 *  - refused + dead/absent  -> reclaim (remove stale remnants, then bind/spawn fresh).
 */
export const decideDaemonReach = (obs: DaemonReachObservation): DaemonReachDecision => {
  if (obs.connectable) return { kind: 'attach' }
  if (obs.metadataPid !== null && obs.pidAlive) return { kind: 'wait' }
  return { kind: 'reclaim' }
}
