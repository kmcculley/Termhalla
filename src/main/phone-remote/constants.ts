/** Exported named backpressure limits (feature 0026, REQ-017, CONV-003). */

/** Above this many buffered bytes, the server stops enqueueing pane `data` for a client. */
export const PHONE_WS_HIGH_WATER = 1_048_576

/** Below this many buffered bytes, a stale pane is resynced (drain-driven, CONV-036). */
export const PHONE_WS_LOW_WATER = 262_144

/** A connection whose buffered amount stays continuously above `PHONE_WS_HIGH_WATER` for this long
 *  is terminated (lossless — REQ-024's fresh reconnect attach covers it). */
export const PHONE_WS_STALL_TIMEOUT_MS = 60_000

/** WS ping/pong keepalive (REQ-017 v2) — a half-open sleeping phone must not hold an immortal
 *  session or unbounded memory. */
export const PHONE_WS_PING_INTERVAL_MS = 30_000
export const PHONE_WS_PONG_TIMEOUT_MS = 10_000

/** HttpOnly session-cookie constants (feature 0026, REQ-028). The cookie's validity is a pure
 *  function of the presented value and the persisted `tokenHash` — no server-side cookie registry,
 *  no new persisted secret (see `cookie.ts`). */
export const PHONE_COOKIE_NAME = 'termhalla-phone'
/** 400 days. */
export const PHONE_COOKIE_MAX_AGE_S = 34_560_000
