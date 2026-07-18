# Tests — 0026-phone-web-remote

**Phase:** 4 (tests) — derived from `02-spec.md` (REQ-001..REQ-027) and `03-plan.md`. Written
BEFORE implementation; verified RED on 2026-07-18 (`npm test` exit **1**). Frozen once the tests
gate passes (ADR-009).

Because no implementation exists, these tests double as the **module contracts**: each file's
header comment spells out the exports/signatures/semantics the implementer must satisfy
(settings normalizer, token trio, protocol parser, backpressure policy, mirror manager tap seam,
WS session deps shape, service deps shape, e2e seam, phone-client pure modules). The deliberately
capability-scoped deps shapes are themselves load-bearing: `WsSessionDeps` exposes NO resize or
lifecycle member, so REQ-013/REQ-014 hold structurally, not just behaviorally.

## Test files (all new — no pre-existing test is modified; the feature is purely additive)

| File | Purpose |
|---|---|
| `tests/main/phone-remote-settings.test.ts` | REQ-003 quick.json additive-optional discipline |
| `tests/main/phone-remote-token.test.ts` | REQ-004/REQ-005 token generate/hash/verify + timingSafeEqual structural |
| `tests/shared/phone-remote-protocol.test.ts` | REQ-010/REQ-014/REQ-018/REQ-013 vocabulary, closed client set, total parser, frame bound |
| `tests/main/phone-remote-backpressure.test.ts` | REQ-017 pure drop-and-resnapshot policy + exported water marks |
| `tests/main/phone-remote-mirrors.test.ts` | REQ-001/REQ-008/REQ-015/REQ-026/REQ-013 mirror-manager tap seam (fan-out purity, bounded mirrors, disposal) |
| `tests/main/phone-remote-session.test.ts` | REQ-009/010/011/012/013/014/016/017/018/024/026 per-client WS session (reference-terminal exactly-once oracle) |
| `tests/main/phone-remote-service.test.ts` | REQ-001/002/004/005/006/007/009/011/012/019/020/024 composed service over a REAL HTTP+WS listener (`ws` client) |
| `tests/main/phone-remote-structure.test.ts` | REQ-013/REQ-019 structural scans (no pty-resize reachable; unref'd, error-handled listener) |
| `tests/main/e2e-phone-remote.test.ts` | REQ-025 env-gated seam + single-reader structural guard |
| `tests/phone-client-key-bar.test.ts` | REQ-023 pure key→bytes mapping + Ctrl latch |
| `tests/phone-client-core.test.ts` | REQ-017/023/024 client pure core (resync-replace, token strip/store, reconnect plan) + UI wiring structural |
| `tests/phone-client-build.test.ts` | REQ-021/REQ-022 build target, self-containment, packaging, PWA install assets |
| `tests/renderer/phone-remote-settings-structure.test.ts` | REQ-002/007/020 desktop settings UI + toast chokepoint + ipc-contract channels |
| `tests/docs-feature-0026.test.ts` | REQ-027 doc-drift guards (docs-feature-0022/0024/0025 precedent) |

## TEST → REQ map

| TEST | REQ(s) | Assertion |
|---|---|---|
| TEST-2601 | REQ-003 | `normalizePhoneRemote`: non-object → absent; `{enabled:'yes'}`/`{port:-1}`/`{port:70000}`/`{bind:'wan'}`/non-string `tokenHash` coerce field-wise to safe values; valid objects round-trip; `PHONE_REMOTE_PORT_DEFAULT === 8199`. |
| TEST-2602 | REQ-003 | `QuickStore`: legacy file loads with the feature off; junk field coerces on read; a valid object round-trips; an invalid object is coerced on WRITE too. |
| TEST-2603 | REQ-003 | CONV-022 structural pin: neither `settings.ts` nor `quick-store.ts` references `SCHEMA_VERSION` (the feature's own invariant, not the global's value). |
| TEST-2604 | REQ-004 | `generateToken()` yields ≥43 chars of base64url (32 CSPRNG bytes), distinct across calls. |
| TEST-2605 | REQ-004, REQ-005 | `hashToken` is the sha-256 base64url digest; verify round-trips, rejects wrong tokens, rejects with ABSENT hash (never-paired), and is total over garbage/length-mismatched hashes (no throw). |
| TEST-2606 | REQ-005 | Structural: the verification site uses `crypto.timingSafeEqual`; no naive `===` token comparison in the auth surface. |
| TEST-2610 | REQ-010 | Exported integer protocol version ≥1; server vocabulary ⊇ {hello, panes, status, grid, snapshot, data, resync, paneExit, error}. |
| TEST-2611 | REQ-010 | `parseClientMessage` parses subscribe/unsubscribe/input with their fields. |
| TEST-2612 | REQ-018 | Table-driven: not-JSON, scalars, arrays, missing/unknown/non-string `type`, missing `paneId`, non-string `data`, binary frames, non-frame values → each `{ok:false}` with non-empty code+message, never a throw; codes are category-specific (unknown-type names the type); `PHONE_WS_MAX_FRAME = 1 MiB` exported and enforced (at-limit parses, one-over rejected). |
| TEST-2613 | REQ-014, REQ-013 | The client→server set is closed: exactly {subscribe, unsubscribe, input} (+ optionally 'ping'); no resize/lifecycle type exists; smuggled `resize`/`kill`/`spawn` do not parse. |
| TEST-2615 | REQ-017 | `PHONE_WS_HIGH_WATER = 1_048_576`, `PHONE_WS_LOW_WATER = 262_144` exported (CONV-003). |
| TEST-2616 | REQ-017 | Strictly-above high water → drop + stale; a stale pane stays suspended even when the buffer dips (no mid-gap reorder) until resynced. |
| TEST-2617 | REQ-017 | CONV-036: a drain below low water (the SIGNAL, with the stream gone quiet) resyncs each stale pane exactly once; at/above low water resyncs nothing; post-resync data flows again. |
| TEST-2618 | REQ-017 | Multi-pane: every dropped pane resynced once; a pane can go stale again in a later cycle. |
| TEST-2620 | REQ-001 | Disabled at the tap seam: forward gets every chunk, ZERO mirror creations/feeds; enable→disable disposes all mirrors and post-disable chunks feed nothing. |
| TEST-2621 | REQ-008 | Spawn-while-enabled creates exactly one mirror at the pane's grid with `HISTORY_LIMIT_DEFAULT` (2000); enable creates mirrors for ALL registered panes at their CURRENT (post-resize) grid; fed output appears in the snapshot through the real F18 replay; the seam is source-agnostic (remote-workspace pane rides the same discipline). |
| TEST-2622 | REQ-015 | Fan-out purity: forward receives the identical chunk sequence with and without a mirror attached; a throwing mirror feed never breaks the renderer forward. |
| TEST-2623 | REQ-026, REQ-001 | `paneExited` disposes the mirror; the count returns to the live-pane count. |
| TEST-2624 | REQ-013 | Desktop-driven `resizePane` resizes the mirror to the new grid (the only sanctioned resize). |
| TEST-2625 | REQ-009 | Reference-terminal oracle: output before / racing / after the attach reconstructs (snapshot ⊕ stream) to exactly the reference terminal's state — snapshot first, pre-attach bytes ONLY in the snapshot, post-attach bytes ONLY in the stream; repeated across microtask interleavings. |
| TEST-2626 | REQ-010 | One multiplexed socket: `hello` FIRST carrying the exported proto version, then `panes`; pane-scoped routing with per-pane order; unsubscribed panes stop flowing. |
| TEST-2627 | REQ-016 | Two sessions on one pane both stream; a saturated client degrades only itself; input accepted from both; closing one leaves the other working (no lease, no steal — CONV-064). |
| TEST-2628 | REQ-024 | Reconnect = fresh attach: a new session against the surviving mirror reconstructs early + while-gone + post-reconnect bytes with no duplicated region. |
| TEST-2629 | REQ-017 | Session half: above high water data stops; the transport drain event (`socketDrained`, NOT a future chunk) emits exactly one buffer-replacing `resync` carrying the missed bytes, which were never also sent as `data`. |
| TEST-2630 | REQ-012 | Input reaches the pane write seam byte-faithfully (UTF-8 + control bytes); unknown pane → error naming the pane id, socket stays usable. |
| TEST-2631 | REQ-012, REQ-026 | After `paneExit` is pushed, input to the exited pane yields the specific error and no write. |
| TEST-2632 | REQ-013 | Fuzz: resize-shaped and arbitrary/malformed frames are inert — no throw, no write; the deps shape exposes no resize capability at all. |
| TEST-2633 | REQ-013 | A desktop grid change pushes `grid{paneId,cols,rows}` to subscribed clients only. |
| TEST-2634 | REQ-014 | kill/spawn/close/split/workspace/fs message types get the error treatment with zero side effects. |
| TEST-2635 | REQ-018 | Session boundary containment: malformed frames, a throwing pane-write seam, and a throwing send seam each stay contained (no uncaught throw in main — the modal-dialog freeze). |
| TEST-2636 | REQ-026, REQ-011 | Status flips push unprompted to connected clients; a subscribed pane exit pushes `paneExit` + `status: exited`. |
| TEST-2637 | REQ-013 | Structural: no `src/main/phone-remote/*` source references `PtyManager`/`ptyResize`/`pty:resize`; the protocol module defines no `'resize'`. |
| TEST-2640 | REQ-002 | Default bind serves loopback (urls report 127.0.0.1, reachable); `setBind` is separate from enabled (no start while disabled); LAN flip rebinds, stays reachable, persists. |
| TEST-2641 | REQ-019 | Structural: `server.ts` `unref()`s and keeps a whole-lifetime `'error'` handler (CONV-071). |
| TEST-2643 | REQ-005, REQ-022 | `GET /` 401s absent/wrong tokens with no pane data; accepts query AND `X-Termhalla-Token` header; WS upgrade refused unauthenticated; the manifest/icons allowlist serves token-free and byte-identical across state changes; other routes never 200. |
| TEST-2644 | REQ-005 | With `tokenHash` absent (never paired), presenting ANY token is rejected on HTTP and WS. |
| TEST-2645 | REQ-006 | Regenerate atomically: connected client's WS closed by the server, token A rejected on reconnect, token B accepted. |
| TEST-2646 | REQ-011 | Wire inventory: terminal panes only (editor/explorer/orky excluded), workspace-grouped with cols/rows/status; a main-side status flip reaches the connected client with no re-request. |
| TEST-2647 | REQ-004, REQ-007 | `regenerateToken` returns a pairing URL with host:port + a token verifying against the persisted hash; serialize-and-scan shows the plaintext NOWHERE at rest; `hasToken`/`tokenAvailableThisSession` report true. |
| TEST-2648 | REQ-009, REQ-012, REQ-024 | Over the real wire: subscribe → snapshot (pre-attach bytes) then stream, exactly-once; terminate + reconnect re-snapshots including while-gone bytes; input round-trips byte-faithfully end-to-end. |
| TEST-2650 | REQ-001 | Absent settings: not running, pane bytes cost ZERO mirror work; enable creates a mirror per live pane; disable disposes all and the port refuses connections. |
| TEST-2652 | REQ-019 | `stop()` with a live WS client resolves inside the teardown budget and closes the client. |
| TEST-2653 | REQ-020 | EADDRINUSE: `notifyError` message contains the port number AND a corrective hint (CONV-001); state never claims running. |
| TEST-2655 | REQ-007, REQ-024 | Restart (fresh instance, persisted state only): `hasToken` true, `tokenAvailableThisSession` FALSE (no stale QR claim); the paired phone's stored token still authenticates. |
| TEST-2660 | REQ-025 | The seam parses the harness JSON; unset/empty/malformed → `undefined` (production, byte-identical); field-wise degradation, never a throw. |
| TEST-2661 | REQ-025 | Structural: comment-stripped scan of ALL of `src/main` — only `e2e-phone-remote.ts` may mention `TERMHALLA_E2E_PHONE_REMOTE` (CONV-032/CONV-037). |
| TEST-2665 | REQ-023 | Key bar: esc/tab/arrows byte sequences; Ctrl latches for exactly the next key (Ctrl+C → `\x03`, full `0x01–0x1a`, case-insensitive); plain chars pass through; unknown keys are a silent no-op; Ctrl+non-letter fabricates no control byte. |
| TEST-2670 | REQ-017, REQ-024 | Client `applyPaneMessage`: snapshot AND resync are reset+write (buffer REPLACEMENT, never append); data appends; unknown types inert. |
| TEST-2671 | REQ-023 | `extractTokenFromUrl` strips the token (other params survive); token-less URLs unchanged. |
| TEST-2672 | REQ-023 | Client token storage round-trips via injected storage; `main.ts` uses `history.replaceState` + the extractor (structural). |
| TEST-2673 | REQ-023, REQ-011, REQ-013 | Structural: pane-list knows all four status chips; terminal-view imports the key bar, emits `input`, and contains no client-originated resize/`fit()`. |
| TEST-2674 | REQ-024 | `reconnectAttachPlan` yields one fresh subscribe per subscribed pane (no assumed stream continuity). |
| TEST-2675 | REQ-021 | Third vite build target exists targeting `out/phone-client`; the build script includes it; NO foreign-origin references in client sources; the emitted-bundle scan runs whenever `out/phone-client` exists (the implement gate builds before testing, so it always runs at the gate). |
| TEST-2676 | REQ-021 | `electron-builder.yml` packages the phone-client bundle. |
| TEST-2677 | REQ-022 | `index.html` carries the manifest link, `apple-mobile-web-app-capable`, `apple-touch-icon`, `viewport-fit=cover`; the manifest parses standalone/fullscreen with a start URL; icons exist. |
| TEST-2680 | REQ-027 | Feature doc covers: off-by-default/localhost/LAN-plaintext posture, hashed token + regenerate, `tailscale serve`, the cloud-relay stance, the history-begins-at-enable and restarts-on-restart limits, and the deferred follow-ons (Web Push, native iOS, per-device, read-only, TLS). |
| TEST-2681 | REQ-027 | CLAUDE.md "Where things live" row exists; CHANGELOG `[Unreleased]` mentions the phone remote (feature-specific phrase — the pre-existing "Phone Link" mention does not satisfy it). |

## RED verification

`npm test` on 2026-07-18, exit code **1** — 348 files: **14 failed** (exactly the 14 new 0026
files), 334 pre-existing files all green (2441 passed / 2 skipped; no pre-existing suite newly
fails). Failure classification:

- **10 files fail at module load** (the implementation modules do not exist yet):
  `phone-remote-settings` (`src/shared/phone-remote/settings`), `phone-remote-token`,
  `phone-remote-protocol`, `phone-remote-backpressure` (`constants` + `backpressure`),
  `phone-remote-mirrors` (`mirror-manager`), `phone-remote-session` (`ws-session`),
  `phone-remote-service` (`service` + the `ws` dependency, added by the implement phase's
  package.json change), `e2e-phone-remote`, `phone-client-key-bar`, `phone-client-core`.
- **4 files load but fail on ENOENT/scan misses** (sources/docs not yet present):
  `phone-remote-structure`, `phone-client-build`, `docs-feature-0026`,
  `renderer/phone-remote-settings-structure`.
- **1 test green by design**: TEST-2675's emitted-bundle scan is conditional on
  `out/phone-client` existing (pre-build runs skip it; the gate's build-before-test order makes
  it always effective at the implement gate).

## Residual obligations outside `npm test` (CONV-052 — record before the review gate closes)

- **REQ-015's e2e half**: an e2e drives a pane with the server enabled + a client attached and
  asserts the desktop terminal renders exactly as the server-off baseline (`npm run build` +
  Playwright, outside the gate profile). The unit half (fan-out purity) is TEST-2622.
- **REQ-019's app-close half**: `app.close()`/the e2e suite must not hang with the server
  enabled and live clients (the `unref()` structural pin is TEST-2641; `stop()` behavior is
  TEST-2652).
- **REQ-023's DOM-level navigation** (list → terminal, key-bar taps → `input` messages against
  the SERVED client): the spec sanctions "a DOM-level test (or e2e against the served client)";
  the pure mapping + structural wiring are TEST-2665/TEST-2673, the interactive half belongs to
  an e2e against the served bundle.

## Contract notes for the implementer (binding via the frozen suite)

- `status().urls` reports reachable URLs with the ACTUAL bound port; `settings.port === 0`
  means OS-assigned (test seam; production default stays 8199). The service trusts injected
  settings — normalization lives at the quick-store boundary.
- The WS endpoint path is `/ws`; auth rides the `token` query param or `X-Termhalla-Token`.
- `createWsSession`'s deps expose no resize/lifecycle capability — keep it that way; the fuzz
  and structural tests pin it.
- Client modules under `src/phone-client/` referenced by unit tests (`key-bar.ts`,
  `token-storage.ts`, `ws-client.ts`) must be import-safe under node (no top-level DOM/WebSocket
  access).
