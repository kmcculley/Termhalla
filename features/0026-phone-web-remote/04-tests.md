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

---

# v2 loopback amendment (2026-07-18 — ESC-001 shift-left re-descent)

Derived from `02-spec.md` **v2** (REQ-028..REQ-032 new; REQ-001/003/005/006/007/008/009/010/011/
013/015/017/019/020/022/023/024/025/027/029 amended) and `03-plan.md` v2 (TASK-023..TASK-031).
The v1 implementation is in the tree (commit d519297), so RED here means: the v2 suite fails
against the shipped v1 code exactly where the 41 review findings live. Verified RED on
2026-07-18: `npm test` exit **1** — 353 files: **13 failed** (all 0026 files), **340 pre-existing
files green** (2570 passed / 2 skipped; no non-0026 suite fails). The two entirely-new-module
files (`phone-remote-cookie`, `phone-remote-network-urls`) fail at load (cookie.ts /
network-urls.ts do not exist yet); the rest fail on the missing v2 behaviors.

**One v1 TEST is AMENDED (not renumbered): TEST-2672.** Its v1 body pinned a localStorage token
round-trip; the ESC-001 cookie decision REVERSES that contract (the plaintext token must never
be persisted in script-readable storage — the HttpOnly cookie is the durable credential). The
amended body pins the new invariant. No other v1 test changed; all v2 coverage is additive.

## New/amended test files

| File | Status | Purpose |
|---|---|---|
| `tests/main/phone-remote-cookie.test.ts` | new | REQ-028/005/006/022/024 cookie module + wire vectors |
| `tests/main/phone-remote-network-urls.test.ts` | new | REQ-031 deterministic URL ranking |
| `tests/main/phone-remote-ipc-gating.test.ts` | new | REQ-032 sender gating; REQ-003 setPort coercion; REQ-007/031 registrar channels |
| `tests/main/phone-remote-remote-grid.test.ts` | new | REQ-008/013 remote-pane grid parity through the REAL register-pty routing |
| `tests/main/phone-remote-inventory.test.ts` | new | REQ-011 human-readable titles + no-synthetic-stub structural |
| `tests/main/phone-remote-backpressure.test.ts` | appended | REQ-017 timing constants, coalescing, clearStale, stall deadline (pure) |
| `tests/main/phone-remote-session.test.ts` | appended | REQ-009 identity-guarded supersession; REQ-017 hold-window/lifecycle/coalescing |
| `tests/main/phone-remote-service.test.ts` | appended | REQ-019/020/011/031/007/017/001 service composition v2 + REAL-transport backpressure |
| `tests/main/e2e-phone-remote.test.ts` | appended | REQ-025 seam v2 knobs + consumption structural |
| `tests/renderer/phone-remote-settings-structure.test.ts` | appended | REQ-029/020/031 mount wiring, root error push, pairing UI |
| `tests/phone-client-core.test.ts` | TEST-2672 amended + appended | REQ-010/024/023/013/030 client core v2 |
| `tests/phone-client-key-bar.test.ts` | appended | REQ-023 Ctrl-latch-over-typed-input |
| `tests/docs-feature-0026.test.ts` | appended | REQ-027 v2 doc topics |
| `tests/e2e/phone-remote.spec.ts` | new (Playwright) | REQ-025/015/019/011/029/002 mandated e2e |
| `tests/e2e/phone-remote-client-dom.spec.ts` | new (Playwright) | REQ-023/030/022/028 served-client DOM e2e |

## v2 TEST → REQ map

| TEST | REQ(s) | Assertion |
|---|---|---|
| TEST-2672 (amended) | REQ-023, REQ-028 | NO phone-client source touches localStorage/sessionStorage or writes document.cookie; main.ts still strips the token via history.replaceState. |
| TEST-2690 | REQ-028, REQ-004, REQ-005 | cookie.ts: `issueSetCookie` carries name/HttpOnly/SameSite=Lax/Path=//Max-Age; validity is a pure function of (value, tokenHash); constant-time site; total over garbage; `PHONE_COOKIE_NAME='termhalla-phone'`, `PHONE_COOKIE_MAX_AGE_S=34_560_000`. |
| TEST-2691 | REQ-028, REQ-005, REQ-022 | Wire: token-authenticated GET / sets the cookie; a token-less GET / AND WS upgrade with only the cookie succeed (the start_url relaunch vector); a wrong cookie 401s/refuses. |
| TEST-2692 | REQ-028, REQ-006, REQ-024 | A fresh instance on persisted state alone accepts the cookie (restart/auto-update); regenerate closes cookie-authed clients and rejects the cookie thereafter. |
| TEST-2693 | REQ-005, REQ-028 | The 401 body is actionable + secret-free; no Location/URL ever carries the cookie value; serialize-and-scan finds no cookie secret at rest beyond tokenHash. |
| TEST-2694 | REQ-031 | `rankReachableUrls`: 192.168 then 10 then 172.16/12 then other, name-sorted within rank, internal/IPv6 excluded, deterministic under permuted enumeration; /12 boundary vectors. |
| TEST-2695 | REQ-031 | Service: externalHost drives the pairing-URL host (bind unaffected); setExternalHost persists and re-derives the URL. |
| TEST-2696 | REQ-032 | registerPhoneRemote(service, send, isKnownWindowSender): a foreign sender is rejected before ANY service call on every channel; a known window passes. |
| TEST-2697 | REQ-003 | setPort IPC: NaN/float/-1/0/65536/string/etc. coerce to PHONE_REMOTE_PORT_DEFAULT (8199), never 0; a valid port passes. |
| TEST-2698 | REQ-007, REQ-031 | `phoneRemote:pairingUrl` re-fetches without calling regenerateToken; `phoneRemote:setExternalHost` reaches the service. |
| TEST-2699 | REQ-008 | register-pty remote spawn/adopt branches invoke deps.onSpawn/onResize with the REAL spawn-args grid (never 80x24). |
| TEST-2700 | REQ-013 | register-pty's remote-owned resize branch invokes deps.onResize (grid-push parity); the local branch is unchanged. |
| TEST-2701 | REQ-017 | `PHONE_WS_STALL_TIMEOUT_MS=60_000`, `PHONE_WS_PING_INTERVAL_MS=30_000`, `PHONE_WS_PONG_TIMEOUT_MS=10_000` exported. |
| TEST-2702 | REQ-017 | Policy `onPush`/`takeHeldPushes`: saturated status/grid pushes are held latest-wins per (kind,pane), delivered once, cleared by the take. |
| TEST-2703 | REQ-017 | Policy `clearStale`: unsubscribe/paneExit/fresh-subscribe clear staleness + held pushes; a later drain resyncs nothing for the cleared pane. |
| TEST-2704 | REQ-017 | Policy `onBuffered`/`stalledPast`: continuous above-high-water >= timeout means stalled; a dip resets the clock. |
| TEST-2705 | REQ-009 | Identity-guarded supersession: subscribe, feed C, subscribe, feed D, resolve the FIRST snapshot first: exactly ONE snapshot (the latest), C in the snapshot only, D in the stream only, reference-terminal equality. |
| TEST-2706 | REQ-017 | Resync hold-window: data between the drain trigger and the resync resolution is queued BEHIND the resync; replace-then-append equals the reference terminal (no erased byte). |
| TEST-2707 | REQ-017 | Session stale lifecycle: stale/unsubscribe/drain emits no resync; stale + fresh subscribe: the attach snapshot IS the resync and staleness is cleared. |
| TEST-2708 | REQ-017 | Session coalescing: N status flips + grid pushes to a saturated client send nothing; drain delivers exactly one LATEST status + grid per pane. |
| TEST-2709 | REQ-019 | Serialized/idempotent lifecycle: redundant setEnabled(true) is a no-op (no misclassified bind failure); a disable racing an enable converges with no zombie listener. |
| TEST-2710 | REQ-020 | status().error persists the last startup failure (names the port) for late-subscribing windows and clears on a successful start. |
| TEST-2711 | REQ-011, REQ-026 | Membership currency: panes.onSpawn/pane exit re-push the inventory to connected clients without reconnecting. |
| TEST-2712 | REQ-007 | service.pairingUrl(): same token, hash untouched (never a revoking regenerate); a fresh restart reports `{ unavailable: true }`. |
| TEST-2713 | REQ-017 | REAL transport: a paused live ws saturates past high water; resuming drains and a resync arrives with NO test code invoking the drain seam. |
| TEST-2714 | REQ-017 | Keepalive/stall (deps.timing overrides): an unresponsive peer is ping-terminated; a continuously saturated connection is cut at the stall ceiling. |
| TEST-2715 | REQ-025 | Seam v2: parses enabled/timing knobs field-wise; the production construction path (register.ts/services.ts) consumes the seam; at least 2 Playwright specs launch with the env var (consumption). |
| TEST-2716 | REQ-029 | The REAL mount wiring: SettingsSection has 'phoneRemote'; SettingsPanel's SECTIONS lists it and renders the PhoneRemoteSettings surface. |
| TEST-2717 | REQ-029, REQ-020 | The surface shows the not-running cue + status() error text and a 1-65535 port-validation message. |
| TEST-2718 | REQ-020 | App.tsx (root) consumes the phoneRemote error push into the toast chokepoint; ipc-contract declares phoneRemote:error/pairingUrl/setExternalHost; api.ts exposes the subscription. |
| TEST-2719 | REQ-031 | Copyable pairing-URL text beside the QR; editable externalHost; localhost-bind reachability disclosure. |
| TEST-2720 | REQ-010 | Client `createMessageGate`: mismatched hello yields 'reload-required' and every later message 'drop'; main.ts renders the reload state. |
| TEST-2721 | REQ-024 | `reconnectDelayMs` capped-exponential; `reconnectOutcome` reaches terminal 'revoked' within <=10 consecutive auth refusals and stays there; re-pair guidance rendered. |
| TEST-2722 | REQ-023 | `paneSwitchPlan`: switching unsubscribes the departing pane; list return unsubscribes; at most the active pane stays subscribed. |
| TEST-2723 | REQ-013, REQ-023 | `openPanePlan`: size (from the freshest grid) BEFORE subscribe; terminal-view consumes it. |
| TEST-2724 | REQ-030 | Error frames render visibly; active-pane exit shows the in-view notice + disables input; empty inventory renders "open a terminal" guidance. |
| TEST-2725 | REQ-023 | `transformTyped`: latch + typed letter yields the control byte (Ctrl then 'c' yields 0x03), one-shot, case-insensitive, no fabrication for non-letters/multi-char; terminal-view routes onData through it. |
| TEST-2726 | REQ-011 | buildInventory title fallback (kind+index, never the raw pane id, distinct for siblings); register.ts no longer mints the 'local'/'Termhalla' stub. |
| TEST-2727 | REQ-025, REQ-015 | e2e: the seam-fixed port/token reach the real server; the desktop's rendered output line is identical to a server-off baseline launch with a live client attached. |
| TEST-2728 | REQ-019 | e2e: app.close() with the server enabled + a live subscribed WS client completes within budget. |
| TEST-2729 | REQ-011 | e2e: the REAL composition serves the true workspace name (the visible tab), a human-readable title, a real grid; the pane arrives as a push to an already-connected client. |
| TEST-2730 | REQ-029, REQ-002 | e2e: Settings navigation reaches the phone-remote section; the plaintext warning renders only after selecting LAN. |
| TEST-2731 | REQ-023, REQ-030, REQ-022, REQ-028 | e2e (served DOM): empty guidance, URL strip, list-to-terminal, typed input reaches the desktop pane, Ctrl+typed-c interrupts (Control-C), in-view exit notice, cookie-backed token-less reload stays authenticated. |
| TEST-2732 | REQ-001 | While disabled: chunks trigger zero mirror work and zero registry rebuilds; enable rebuilds the registry from the CURRENT pane source (a pane added while disabled is found). |
| TEST-2733 | REQ-027 | Doc v2 topics: HttpOnly cookie model, regenerate-revokes-cookies, tailscale pairing step, external host. |

## Contract notes for the implementer (v2 — binding via the frozen suite)

- **cookie.ts**: `issueSetCookie(token)`, `cookieValueFromHeader(header)`, `verifyCookieValue(value, tokenHash)`;
  validity is a pure function of the persisted hash — no cookie registry, no new persisted secret.
- **Service deps gain** `panes.onSpawn(cb)` (membership push source) and optional
  `timing { pingIntervalMs, pongTimeoutMs, stallTimeoutMs }`; **service gains**
  `setExternalHost(host)`, `pairingUrl()`, `status().error`, `status().externalHost`.
- **Policy gains** `onPush/takeHeldPushes/clearStale/onBuffered/stalledPast` (pure; the real
  transport trigger lives in the session/service wiring — the ws `send` callback or an armed
  timer, never a `'drain'` listener the transport does not emit).
- **registerPhoneRemote** takes `isKnownWindowSender` as its third parameter and registers
  `phoneRemote:pairingUrl` + `phoneRemote:setExternalHost` + the app-wide `phoneRemote:error` push.
- **register-pty** remote branches invoke `deps.onSpawn`/`deps.onResize` with the real grid.
- **e2e seam** additionally parses `enabled` and `timing` and MUST be consumed by the production
  service construction (register.ts/services.ts) — the Playwright specs launch with
  `TERMHALLA_E2E_PHONE_REMOTE={"port":18641|18653,"token":...,"enabled":true}`.
- **ws-client.ts gains** `createMessageGate`, `reconnectDelayMs`, `reconnectOutcome`,
  `paneSwitchPlan`, `openPanePlan` (all pure, node-import-safe).
- **key-bar gains** `transformTyped(data)`; typed input routes through it in terminal-view.
- **Served-client testids** (TEST-2731): `phone-pane-<paneId>`, `phone-terminal`, `phone-back`,
  `key-ctrl`/`key-esc`/`key-tab`/`key-up`/`key-down`/`key-left`/`key-right`; the desktop surface
  root is `phone-remote-settings` (TEST-2730).

## Residual obligations (CONV-052) — now IN the suite

The v1 residual obligations (REQ-015 e2e half, REQ-019 app-close half, REQ-023 DOM navigation)
are no longer residual: they are TEST-2727/2728/2731 under `tests/e2e/` (run via
`npm run build && npm run e2e`, outside the `npm test` gate but inside the frozen test roots and
required acceptance per the v2 spec). The REQ-017 real-transport half runs INSIDE the gate as
TEST-2713/2714 (a real `ws` connection against the real listener).
