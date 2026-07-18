/** Exported named backpressure limits (feature 0026, REQ-017, CONV-003). */

/** Above this many buffered bytes, the server stops enqueueing pane `data` for a client. */
export const PHONE_WS_HIGH_WATER = 1_048_576

/** Below this many buffered bytes, a stale pane is resynced (drain-driven, CONV-036). */
export const PHONE_WS_LOW_WATER = 262_144
