/**
 * Daemon-tree contract constants (feature 0024-agent-daemonization) — the Definitions-table
 * values from `02-spec.md`, exported here as the ONE place every other agent-tree module (and
 * NO client-tree module — REQ-014: socket/metadata/log path constants are agent-tree-only)
 * imports them from. Pure, no IO.
 */

/** Idle self-exit default (REQ-006, locked D3): 5 minutes. Overridable via `--idle-timeout-ms`. */
export const DAEMON_IDLE_TIMEOUT_DEFAULT_MS = 300_000

/** The bridge's bounded wait for a just-spawned (or reclaimed) daemon's socket to accept. */
export const DAEMON_SPAWN_WAIT_MS = 10_000

/** Bridge sentinel exit (REQ-009/010/011): could not reach a listening daemon. Distinct from
 *  127 (F19 launch-absent), 93/94 (0023 upload/npty sentinels), 95 (0023 npty race), 12 (fake-ssh
 *  shim parse error), and the agent's own 0/1/2 taxonomy. */
export const BRIDGE_DAEMON_UNREACHABLE_EXIT = 96

/** In-generation daemon-log size cap (REQ-004, FINDING-010/015): 1 MiB. A survival daemon's
 *  generation is wall-clock unbounded, so truncate-at-start alone is not a bound — the log sink
 *  ring-truncates past this cap while keeping the most recent diagnostics. */
export const DAEMON_LOG_MAX_BYTES = 1_048_576

/** `<agentDir>/agent-<wsToken>.sock` — WORKSPACE-KEYED (locked D6′) and version-stable (locked
 *  D4/D4′: no app/protocol version in the name). Each remote workspace gets its OWN daemon socket
 *  so two same-host workspaces are fully independent (REQ-018). */
export const socketFileName = (wsToken: string): string => `agent-${wsToken}.sock`

/** `<agentDir>/daemon-<wsToken>.json` — the cross-version-frozen metadata shape, workspace-keyed. */
export const metadataFileName = (wsToken: string): string => `daemon-${wsToken}.json`

/** `<agentDir>/daemon-<wsToken>.log` — the detached daemon's diagnostics sink, workspace-keyed,
 *  truncated per daemon start and size-capped within a generation at `DAEMON_LOG_MAX_BYTES`. */
export const logFileName = (wsToken: string): string => `daemon-${wsToken}.log`

/** The ONE frozen daemon-metadata format version (REQ-003): a newer client must be able to read
 *  an older daemon's file at this exact value. */
export const DAEMON_METADATA_FORMAT_VERSION = 1

/** The bridge's one machine-parseable stderr line prefix (REQ-009), followed by one JSON object
 *  `{ spawned, daemonVersion, daemonProto, daemonPid }`. */
export const BRIDGE_STATUS_PREFIX = 'TERMHALLA_BRIDGE_V1 '
