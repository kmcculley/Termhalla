# 0026-phone-web-remote — Plan (phase 3)

- **Planned:** 2026-07-18 · **Amended (v2):** 2026-07-18, re-plan after the ESC-001 shift-left
  spec loopback (02-spec.md v2: REQ-028…REQ-032 new; REQ-005/006/007/008/009/010/011/013/015/017/
  019/020/022/023/024/025 amended).
- **Inputs:** `02-spec.md` v2 (REQ-001..032), `01-concept.md` (D1-D11), `.orky/baseline/architecture.md`,
  `findings.json` (the 41 review findings this loopback exists to close at the plan level —
  see "Findings → task map" below).
- **Baseline fit:** additive only — new privileged surface in `src/main`, a new third-party client
  outside the renderer/preload/main triangle. No existing module is restructured; every reuse point
  (F18 `createPaneReplay`, the status engine, `PtyManager`, `quick.json`'s coerce discipline, the
  `e2e-presentation.ts`/`e2e-remote.ts` seam pattern, `vite.agent.config.ts`'s third-build-target
  pattern, the `register-orky-action`/`register-registry`/`register-remote` sender-gating precedent)
  is an established convention, not a new one.

## v2 amendment summary (why this plan changed)

The prior implement→review cycle shipped a real, mostly-working feature but a full quality/
security/networking/ux/devils-advocate review surfaced 41 findings (`findings.json`), 15 of them
blocking (CRITICAL/HIGH or contract-violation). Kevin's ESC-001 decision: fix all 15, none
accepted as gaps, with two requiring a **spec** amendment (shift-left) because they were
requirement-level contradictions or missing acceptance, not implementation bugs:

1. **FINDING-025 (auth-relaunch contradiction, devils-advocate, HIGH)** — REQ-005's 401-on-
   token-less-GET directly contradicted REQ-022/23/24's promise that URL-stripping + PWA relaunch
   + app-restart survive without re-pairing. Resolved by REQ-028 (HttpOnly session cookie).
2. **FINDING-011/017/022/027/038 (REQ-011 stub inventory)** — the single-synthetic-workspace
   inventory is rejected; REQ-011 now mandates real workspace id/name, real pane titles, and
   membership currency (pane spawn/exit pushes).

The remaining 13 blocking findings are implementation-level bugs this plan now carries as new or
amended tasks (not new spec text) so they land WITH this loopback instead of being deferred.
Every finding ID below is closed by a task in this plan; none are recorded as an open issue.

## Target file/module layout

```
src/main/phone-remote/
  constants.ts          # port default, WS water marks, max frame, stall/ping/pong, proto ver,
                          # PHONE_COOKIE_NAME, PHONE_COOKIE_MAX_AGE_S
  token.ts               # CSPRNG token gen, sha-256 hash, timingSafeEqual verify
  cookie.ts               # NEW v2 — session-cookie issuance/parsing/verification (REQ-028),
                          # bound to tokenHash generation, no new persisted secret
  protocol.ts             # (re-exports from src/shared/phone-remote/protocol.ts for main-side use)
  inventory.ts             # workspace-grouped terminal-pane inventory + status source (REAL data,
                          # v2: fed by network-urls.ts's sibling metadata threading, not a stub)
  network-urls.ts           # NEW v2 — pure deterministic reachable-URL ranking (RFC1918 preference,
                          # name-sorted) + externalHost override (REQ-031)
  mirror-manager.ts         # per-pane @xterm/headless mirror registry (create/feed/resize/dispose)
  backpressure.ts            # PURE queue-policy module (high/low water, stale marking, resync
                          # trigger, v2: extended to cover status/grid coalescing — REQ-017)
  ws-session.ts                # per-client WS session: subscribe/unsubscribe/input, attach
                          # (identity-guarded supersession), backpressure wiring incl. real drain
                          # trigger + resync hold-window (v2)
  auth.ts                        # HTTP+WS auth gate (allowlist, constant-time compare of token
                          # OR cookie, 401/upgrade-refuse) — v2: cookie a first-class credential
  static-assets.ts                 # serves the built web client bundle + REQ-005 unauthenticated allowlist
  server.ts                         # HTTP+WS listener lifecycle (bind modes, unref, error handler,
                          # stop(); v2: serialized/idempotent lifecycle ops, no zombie listener)
  service.ts                         # composition: settings <-> quick.json, fan-out wiring,
                          # IPC-facing API, status().error/urls, cookie issuance, app-wide error push
src/main/e2e-phone-remote.ts         # single env-gated e2e seam (TERMHALLA_E2E_PHONE_REMOTE) —
                          # v2: actually consumed by the mandated e2e specs (REQ-025 acceptance)
src/main/ipc/register-phone-remote.ts # phoneRemote:* IPC channels; v2: every handler sender-gated
                          # via WindowManager.isKnownWindowSender (REQ-032) before logic runs, and
                          # real per-pane workspace/title metadata + onSpawn/onResize wired for
                          # remote-owned panes (REQ-011/008/013 amendments)
src/main/ipc/register-pty.ts        # v2: remote pane branches (adopt/spawn/resize) now invoke
                          # deps.onSpawn/deps.onResize so remote panes get real-grid mirrors + grid
                          # push parity with local panes (REQ-008/REQ-013 amendment)
src/shared/phone-remote/
  protocol.ts             # WS JSON message vocabulary (types + guards), protocol version constant
  settings.ts               # phoneRemote quick.json shape + PHONE_REMOTE_PORT_DEFAULT +
                          # externalHost field (REQ-031)
src/shared/ipc-contract.ts   # extended: phoneRemote:status/setEnabled/setBind/setPort/
                          # setExternalHost/regenerateToken/pairingUrl/changed + app-wide error push
src/shared/types.ts           # QuickStore.phoneRemote? field
src/main/persistence/quick-store.ts # normalizeQuick coercion for phoneRemote (+ externalHost)
src/renderer/store/phone-remote-slice.ts # settings state + QR pairing UI state + status().error
src/renderer/store/types.ts   # v2: SettingsSection gains 'phoneRemote'
src/renderer/components/SettingsPanel.tsx # v2: SECTIONS + render wiring for the phone-remote
                          # section (REQ-029 — the mount-path fix for FINDING-010/024)
src/renderer/components/PhoneRemoteSettings.tsx # Settings section: enable/bind/port/QR/regenerate,
                          # LAN warning, copyable pairing URL, externalHost field, not-running cue +
                          # last-error text, port validation message
src/renderer/App.tsx          # v2: root-mounted, always-subscribed phoneRemote error push consumer
                          # feeding the toast chokepoint (REQ-020 amendment — FINDING-034 fix)
vite.phone-client.config.ts   # third vite build target -> out/phone-client/
src/phone-client/
  index.html
  manifest.webmanifest, icons/
  main.ts, ws-client.ts, token-storage.ts
  pane-list.ts, terminal-view.ts
  key-bar.ts             # PURE key -> byte-sequence mapping module (unit-testable, no DOM)
electron-builder.yml       # packages out/phone-client
docs/features/phone-web-remote.md
CLAUDE.md                    # "Where things live" row
CHANGELOG.md                  # [Unreleased] entry
package.json                   # + ws, qrcode dependencies
```

## Tasks

### TASK-001 — Settings shape + persistence coercion
Add `phoneRemote?: { enabled, bind, port, tokenHash?, externalHost? }` to `QuickStore` in
`src/shared/types.ts` and `src/shared/phone-remote/settings.ts` (exports
`PHONE_REMOTE_PORT_DEFAULT = 8199` and a pure `normalizePhoneRemote(value: unknown)` coercion,
including `externalHost` — non-string/blank coerces to absent, REQ-031). Wire the coercion into
`src/main/persistence/quick-store.ts`'s `normalizeQuick` on both read and write, field-wise-invalid
values coerce to safe defaults, no `SCHEMA_VERSION` bump.
Files: `src/shared/types.ts`, `src/shared/phone-remote/settings.ts`, `src/main/persistence/quick-store.ts`
Deps: none
Satisfies: REQ-003

### TASK-002 — Pairing token: generate, hash, verify
`src/main/phone-remote/token.ts`: `generateToken()` (CSPRNG 32 bytes, base64url), `hashToken(token)`
(SHA-256), `verifyToken(token, storedHash)` using `crypto.timingSafeEqual` over equal-length digests
(pad/compare-length-mismatch safely — never leak via early return timing on length).
Files: `src/main/phone-remote/token.ts`
Deps: none
Satisfies: REQ-004, REQ-005 (verification primitive)

### TASK-003 — e2e seam module + structural guard
`src/main/e2e-phone-remote.ts`: sole reader of `TERMHALLA_E2E_PHONE_REMOTE` (JSON: fixed port,
injected token, deterministic-timer knobs — v2: also a deterministic backpressure/ping-pong timer
override so TASK-026's real-transport tests can run fast and deterministic), inert defaults when
unset. Mirrors `e2e-remote.ts`'s parse-safety discipline (malformed → undefined, never throw).
*(v2: this seam MUST be wired into the production service construction path in TASK-013/014 and
actually consumed by the mandated e2e specs — a decorative unconsumed seam, FINDING-012, is
non-conforming per REQ-025's v2 acceptance.)*
Files: `src/main/e2e-phone-remote.ts`
Deps: none
Satisfies: REQ-025

### TASK-004 — HTTP+WS server lifecycle *(amended v2 — FINDING-018)*
`src/main/phone-remote/server.ts`: `start(opts)`/`stop()`, binds `127.0.0.1` or `0.0.0.0` per
`bind`, listener + every accepted socket `unref()`'d, a listener-lifetime `'error'` handler
(EADDRINUSE/EACCES surfaced as a typed start-failure, not thrown), `stop()` destroys all accepted
sockets and closes WS connections. Consumes TASK-003's seam for a fixed test port. No mirror/auth
logic here — this is transport lifecycle only. **v2:** lifecycle mutation entry points expose a
`start`/`stop` pair whose caller (TASK-013's `service.ts`) is the sole place that may invoke them,
so a single serialized op-queue in the service can guarantee no zombie listener; `start()` on an
already-listening transport returns the existing bound port/status rather than rejecting (an
already-running transport is not a bind failure).
Files: `src/main/phone-remote/server.ts`
Deps: TASK-003
Satisfies: REQ-002, REQ-019, REQ-020

### TASK-005 — Auth gate (HTTP + WS upgrade) *(amended v2 — REQ-005/REQ-028)*
`src/main/phone-remote/auth.ts`: extracts a credential from query param `token` /
`X-Termhalla-Token` header **or the `PHONE_COOKIE_NAME` cookie (TASK-023)**, verifies either via
TASK-002/TASK-023's constant-time comparisons, applied to every route except the fixed REQ-022
allowlist (manifest, icons — byte-identical regardless of app state). `tokenHash` absent ⇒ all
authenticated routes reject regardless of a presented cookie. The 401 body is actionable and
secret-free (REQ-005 v2). Wire into TASK-004's request/upgrade handling.
Files: `src/main/phone-remote/auth.ts`, `src/main/phone-remote/static-assets.ts` (allowlist)
Deps: TASK-002, TASK-004, TASK-023
Satisfies: REQ-005, REQ-006 (rejection-on-regenerate half; closing sockets is TASK-013)

### TASK-006 — Pane inventory + status source (data shape only)
`src/main/phone-remote/inventory.ts`: builds the workspace-grouped terminal-pane inventory
(id/title/kind/cols/rows/status) from workspace-id/name and pane-title records it is HANDED (a
pure builder — it groups/formats real records; it does not itself source them), local and
remote-workspace panes only, non-terminal kinds excluded. Exposes a subscribe-to-status-changes
seam for push. *(The composition-level wiring that feeds this builder REAL workspace/pane data in
production, rather than the injected-seam-only data the v1 review found (FINDING-011/017/027), is
TASK-024 — kept as a separate task because it is the part that touches `register-pty.ts`/
`services.ts` composition, a materially different surface than this pure builder.)*
Files: `src/main/phone-remote/inventory.ts`
Deps: none
Satisfies: REQ-011 (builder half; TASK-024 is the production-wiring half)

### TASK-007 — Mirror manager (fan-out point)
`src/main/phone-remote/mirror-manager.ts`: per-pane `createPaneReplay` (F18 reuse,
`HISTORY_LIMIT_DEFAULT`), created at server-enable (existing panes) and at pane spawn (while
enabled), disposed on pane exit or server-disable. Taps `PtyManager.onData` and the
remote-workspace `pty:data` surface ADDITIVELY (existing renderer-forward callback receives the
identical chunk sequence, unchanged ordering/timing) so the disabled path costs one constant-time
enabled check and performs no `feed`, and does no standing per-chunk live-pane bookkeeping while
disabled — any live-pane registry is rebuilt at enable time from `PtyManager`/remote-manager state,
never maintained eagerly on the hot chunk path (REQ-001 v2 clarification, FINDING-005).
Files: `src/main/phone-remote/mirror-manager.ts`
Deps: none (wired into `PtyManager`/remote-workspace paths by TASK-011/TASK-025)
Satisfies: REQ-001, REQ-008, REQ-015 (fan-out purity), REQ-026 (mirror disposal on pane exit)

### TASK-008 — Backpressure policy (pure) *(amended v2 — REQ-017 full coverage)*
`src/main/phone-remote/backpressure.ts`: pure state machine over `{bufferedAmount}` inputs against
exported `PHONE_WS_HIGH_WATER`/`PHONE_WS_LOW_WATER` (in `src/main/phone-remote/constants.ts`,
alongside the v2-added `PHONE_WS_STALL_TIMEOUT_MS`/`PHONE_WS_PING_INTERVAL_MS`/
`PHONE_WS_PONG_TIMEOUT_MS`): above high-water stop enqueuing pane `data` + mark stale; on a drain
signal crossing low-water, emit exactly one resync trigger per stale pane. **v2:** the policy is
extended to also (a) coalesce `status`/`grid` pushes latest-wins per pane while saturated instead
of ignoring them (closes FINDING-002/019), (b) expose a stale-clear operation callable by
`unsubscribe`/`paneExit`/fresh-`subscribe` so backpressure state cannot outlive its subscription
(closes FINDING-020), and (c) expose a "held past deadline" query the caller uses to terminate a
connection whose buffer stays above high-water continuously for `PHONE_WS_STALL_TIMEOUT_MS`. No
I/O in this module — the REAL transport trigger (an event that actually fires) is TASK-026's job;
this module stays pure and testable as functions/state over synthetic inputs.
Files: `src/main/phone-remote/constants.ts`, `src/main/phone-remote/backpressure.ts`
Deps: none
Satisfies: REQ-017 (pure-policy half; TASK-026 is the real-transport half)

### TASK-009 — WS protocol vocabulary (shared)
`src/shared/phone-remote/protocol.ts`: JSON message types (server→client: `hello`, `panes`,
`status`, `grid`, `snapshot`, `data`, `resync`, `paneExit`, `error`; client→server: `subscribe`,
`unsubscribe`, `input`), the protocol-version constant, and a validating parser for inbound
messages (malformed JSON / wrong shape / unknown type / non-string `data` / oversized frame →
a typed parse-error result, never a throw). `PHONE_WS_MAX_FRAME` lives here or in TASK-008's
constants file (co-locate exported constants).
Files: `src/shared/phone-remote/protocol.ts`
Deps: none
Satisfies: REQ-010 (vocabulary + server-side check), REQ-014 (closed client→server set), REQ-018 (parse-time hardening)

### TASK-010 — WS session: attach (snapshot-then-stream, exactly-once, identity-guarded) *(amended v2 — FINDING-008)*
`src/main/phone-remote/ws-session.ts` attach/subscribe path: on `subscribe`, resolves
`PaneReplay.snapshot()` (write-flush barrier), sends `snapshot`, then routes all pane-data fed
after the snapshot's sequence point as `data` — a hold-window queue for output arriving between
subscribe-call and snapshot-resolution so nothing is lost or duplicated. `unsubscribe` stops
routing for that pane. **v2 — supersession is identity-guarded, not presence-guarded:** the pending
hold-window array reference captured by a given `subscribe` call is compared by identity
(`===`) when its snapshot resolves; a resolution whose captured reference no longer matches the
CURRENT attach state for that pane (i.e. a later `subscribe` superseded it) completes nothing —
only the latest subscribe's snapshot+queue pair ever completes the attach. This is the repo's
established session-identity re-check pattern (claim the slot, re-check `map.get(id) !== sess`
after every await — `UsageTracker`/`WatchManager`), applied here to per-pane attach state.
Files: `src/main/phone-remote/ws-session.ts`
Deps: TASK-007, TASK-009
Satisfies: REQ-009, REQ-010 (routing/ordering half)

### TASK-011 — WS session: input, no-resize enforcement, grid pushes, exit pushes
Extends `ws-session.ts` + `service.ts` composition: `input{paneId,data}` writes byte-faithfully to
`PtyManager.write`/the remote-workspace write equivalent for a subscribed live pane; unknown/exited
pane → typed `error`, connection stays usable. The client-message dispatch table has NO path to any
resize seam (structural coverage at test phase). A desktop-side grid change resizes the pane's
mirror (`PaneReplay.resize`) and pushes `grid` to attached clients. On pane exit: `paneExit` push,
`status: exited`, mirror disposed (TASK-007), pane removed from inventory (TASK-006/TASK-024) once
it leaves main's pane set.
Files: `src/main/phone-remote/ws-session.ts`, `src/main/phone-remote/service.ts`
Deps: TASK-006, TASK-007, TASK-010
Satisfies: REQ-012, REQ-013 (local-pane half; TASK-025 is the remote-pane parity half), REQ-026

### TASK-012 — No-lifecycle enforcement + untrusted-input hardening
Ensures the accepted client message type set is exactly `{subscribe, unsubscribe, input}` (plus
pure keepalive if added) with no lifecycle/filesystem/editor paths reachable; every malformed/
unknown/oversized/binary frame from TASK-009's parser and every handler exception is caught at the
WS session boundary and turned into a specific `error`/clean-close — never an uncaught throw in
main.
Files: `src/main/phone-remote/ws-session.ts` (handler wrapping), `src/main/phone-remote/protocol.ts`
Deps: TASK-009, TASK-011
Satisfies: REQ-014, REQ-018

### TASK-013 — Service composition: settings, regenerate, status, serialized lifecycle *(amended v2)*
`src/main/phone-remote/service.ts`: single composition object owning settings (TASK-001) <->
runtime server (TASK-004/005), token lifecycle (TASK-002) including `regenerateToken()` (atomic:
new hash persisted, all connected WS sessions closed, old token AND every issued cookie rejected
immediately — TASK-023), and a `status()` read (`enabled, bind, port, running, error, urls,
hasToken, tokenAvailableThisSession, externalHost`) for IPC. Registers mirrors (TASK-007) at
enable time for existing panes and at pane-spawn while enabled. **v2 — serialized + idempotent
lifecycle (FINDING-018):** every mutation (`setEnabled`/`setBind`/`setPort`/`setExternalHost`/
`regenerateToken`) is queued through a single promise-chain mutex so two racing calls never
interleave; a redundant `setEnabled(true)` while already listening is a no-op (never a
misclassified bind-failure toast — TASK-004's "already-running returns existing status" contract
is what makes this safe); `setBind`/`setPort` share one `restart()` helper (closes FINDING-014's
duplication) that the mutex serializes against a concurrent enable. `status().error` persists the
last startup failure so a late-subscribing window still sees it (FINDING-049/034, REQ-020 v2).
Files: `src/main/phone-remote/service.ts`
Deps: TASK-001, TASK-002, TASK-004, TASK-005, TASK-007, TASK-023
Satisfies: REQ-001, REQ-002, REQ-006, REQ-007 (service half), REQ-019, REQ-020

### TASK-014 — Desktop IPC contract + registrar *(amended v2 — REQ-032, REQ-031, REQ-020)*
Extend `src/shared/ipc-contract.ts` (`CH.phoneRemoteStatus/setEnabled/setBind/setPort/
setExternalHost/regenerateToken/pairingUrl`, `phoneRemote:changed` push, and an app-wide
`phoneRemote:error` push consumed at the root — TASK-028) and `TermhallaApi`; add
`src/main/ipc/register-phone-remote.ts` composed into `register.ts`, calling into TASK-013's
service; expose through `src/preload` and `src/renderer/api.ts`. **v2:** every handler in
`register-phone-remote.ts` — all write-capable, and `regenerateToken`/`pairingUrl` return the
plaintext token — checks `WindowManager.isKnownWindowSender(event.sender)` and rejects an unknown
sender BEFORE any handler logic runs, mirroring `register-orky-action.ts`/`register-registry.ts`
(REQ-032, FINDING per the register-orky-action precedent). **v2:** `setPort` coerces any
non-integer/out-of-range argument to `PHONE_REMOTE_PORT_DEFAULT` — port `0` is reachable ONLY via
TASK-003's e2e seam, never a production IPC call (REQ-003 v2, FINDING-032).
Files: `src/shared/ipc-contract.ts`, `src/main/ipc/register-phone-remote.ts`, `src/main/ipc/register.ts`, `src/renderer/api.ts`
Deps: TASK-013
Satisfies: REQ-007 (IPC plumbing), REQ-020 (error surfacing plumbing), REQ-031 (externalHost/pairingUrl plumbing), REQ-032

### TASK-015 — Desktop settings UI: enable/bind/port/QR/regenerate
`src/renderer/store/phone-remote-slice.ts` (settings + status state, wraps TASK-014's IPC) and
`src/renderer/components/PhoneRemoteSettings.tsx` (enable toggle, bind mode toggle with the LAN
plaintext warning shown only in LAN mode, port field, QR code render of the pairing URL using the
new `qrcode` dependency, "Regenerate" action with the post-restart no-stale-QR behavior). This task
builds the COMPONENT; **TASK-027 mounts it into the real Settings navigation** — building an
unmounted component is exactly the FINDING-010/024 gap this split exists to prevent from
recurring.
Files: `src/renderer/store/phone-remote-slice.ts`, `src/renderer/components/PhoneRemoteSettings.tsx`, `package.json` (+`qrcode`)
Deps: TASK-014
Satisfies: REQ-007 (component)

### TASK-016 — Static asset serving + PWA install allowlist
`src/main/phone-remote/static-assets.ts`: serves TASK-018's built `out/phone-client/` bundle over
the embedded server, plus the fixed unauthenticated allowlist (manifest, icons — byte-identical
responses regardless of app state, no user/pane data). Wired into TASK-004's request routing ahead
of TASK-005's auth gate for allowlisted paths only; `GET /` itself is auth-gated per REQ-005/028
(token OR cookie), never added to the allowlist.
Files: `src/main/phone-remote/static-assets.ts`
Deps: TASK-004, TASK-018
Satisfies: REQ-005 (allowlist), REQ-021, REQ-022

### TASK-017 — Web client: pure key-bar mapping module *(amended v2 — Ctrl-latch composes with typed input)*
`src/phone-client/key-bar.ts`: pure key -> byte-sequence table (Esc `\x1b`, Tab `\t`, arrows
`\x1b[A`-`\x1b[D`) plus a Ctrl modifier-latch whose armed state transforms the NEXT single-letter
input — whether it comes from a key-bar tap or a `term.onData` soft-keyboard datum — into its
control byte (`0x01`-`0x1a`) and then clears; exports a `press(letter)`-shaped pure function TASK-020
calls from `term.onData` so Ctrl+C is producible by tapping Ctrl then typing `c` on the iOS
keyboard (closes FINDING-033). Unit-testable with no DOM dependency.
Files: `src/phone-client/key-bar.ts`
Deps: none
Satisfies: REQ-023 (key-bar mapping + latch-composition half)

### TASK-018 — Web client build target + shell + install assets
`vite.phone-client.config.ts` (third build target sibling of `vite.agent.config.ts`) bundling
`src/phone-client/` (xterm.js + all assets inlined, no CDN references) into `out/phone-client/`;
`index.html` with the iOS PWA meta tags (`apple-mobile-web-app-capable`, `apple-touch-icon`,
`viewport-fit=cover`, and NOT `user-scalable=no`/a zoom-blocking `maximum-scale` — REQ-022 v2),
`manifest.webmanifest` (`display: standalone`, a token-free `start_url`), icons. Wire into the
root `npm run build` chain alongside the agent build.
Files: `vite.phone-client.config.ts`, `src/phone-client/index.html`, `src/phone-client/manifest.webmanifest`, `src/phone-client/icons/*`, `package.json` (build script chain)
Deps: none
Satisfies: REQ-021, REQ-022

### TASK-019 — Web client: cookie-durable session, URL stripping, WS client, reconnect *(amended v2)*
`src/phone-client/token-storage.ts` — **v2: no longer the durable credential.** On first load with
`?token=`, the client presents the token once to authenticate (which sets the REQ-028 cookie via
`Set-Cookie`), immediately strips it from the visible URL (`history.replaceState`), and does NOT
persist the plaintext token in any script-readable storage (closes the FINDING-025 contradiction
at the client: the browser's own cookie jar, not localStorage, is what survives a relaunch).
`main.ts` wiring: on any subsequent load/reconnect, the same-origin request carries the cookie
automatically — no client-side credential lookup needed. `ws-client.ts` opens the single
multiplexed WS (TASK-009 vocabulary), applies `resync` as a buffer REPLACE (reset+snapshot, never
append), and on drop retries with **capped exponential backoff**, distinguishing auth rejection
from transient failure: repeated immediate auth-refused attempts (probed via a cheap authenticated
fetch) transition to a terminal "pairing revoked — scan the new QR code" state instead of retrying
forever (closes FINDING-026/036), while transient network failures keep retrying with increasing
capped delays. Each successful reconnect performs a fresh REQ-009-shaped attach per subscribed
pane (no assumed stream continuity across reconnects).
Files: `src/phone-client/token-storage.ts`, `src/phone-client/main.ts`, `src/phone-client/ws-client.ts`
Deps: TASK-009, TASK-017, TASK-018, TASK-023
Satisfies: REQ-023 (URL-stripping/no-persisted-token half), REQ-024

### TASK-020 — Web client: pane list + terminal view, sized from real grid, subscription hygiene *(amended v2)*
`src/phone-client/pane-list.ts` (workspace-grouped list with live status chips driven by
TASK-006/TASK-024's `panes`/`status` pushes; renders the REQ-030 empty-inventory guidance message
when the pushed inventory is empty), `src/phone-client/terminal-view.ts` (tap -> full-screen
xterm.js). **v2 — size before snapshot (closes FINDING-016/031):** on pane select (and on
reconnect re-attach), the client resizes its xterm instance from the freshest known grid — the
inventory row's cols/rows, or a later `grid` push — BEFORE the `snapshot` message is applied, so a
non-80×24 pane never renders mis-wrapped; `pinch-zoom`/pan is the only client-driven visual fit,
and no client-originated resize call reaches the wire anywhere. **v2 — subscription hygiene
(closes FINDING-003/028):** switching panes or returning to the list sends `unsubscribe` for the
departing pane and keeps `subscribed` = at most the active pane, so a reconnect re-attaches at
most one pane. **v2:** `term.onData` routes single-letter data through TASK-017's Ctrl-latch
`press()` before `send()`. Wires the key bar to emit `input` messages.
Files: `src/phone-client/pane-list.ts`, `src/phone-client/terminal-view.ts`
Deps: TASK-017, TASK-019
Satisfies: REQ-011 (client rendering half), REQ-013 (client half), REQ-023

### TASK-021 — Packaging
`electron-builder.yml`: include `out/phone-client/` in the packaged artifact alongside the existing
`out/agent` handling.
Files: `electron-builder.yml`
Deps: TASK-018
Satisfies: REQ-021

### TASK-022 — Docs: feature doc + living-doc updates *(amended v2)*
`docs/features/phone-web-remote.md` covering the security posture (off by default, localhost
default, LAN warning, single hashed token, regenerate-revokes-all **including session cookies**),
the HttpOnly-cookie pairing/relaunch model (REQ-028), the `tailscale serve` anywhere-access recipe
**including its explicit pairing step** (external host / copyable URL, REQ-031), the no-cloud-relay
stance, the history-begins-at-enable and history-restarts-on-app-restart limits (REQ-008/REQ-024),
and the deferred follow-ons (Web Push, native iOS client, per-device grants, read-only tier, TLS,
renderer-seeded history). Add the CLAUDE.md "Where things live" row and the CHANGELOG
`[Unreleased]` entry per repo convention.
Files: `docs/features/phone-web-remote.md`, `CLAUDE.md`, `CHANGELOG.md`
Deps: TASK-001..032 (documents the shipped shape)
Satisfies: REQ-027

---

## New in v2

### TASK-023 — HttpOnly session cookie: issuance, verification, revocation (REQ-028)
`src/main/phone-remote/cookie.ts`: issues a `Set-Cookie` (`PHONE_COOKIE_NAME`, `HttpOnly`,
`SameSite=Lax`, `Path=/`, `Max-Age=PHONE_COOKIE_MAX_AGE_S`) on the first token-authenticated
response; the cookie value's validity is a PURE function of the presented value and the persisted
`tokenHash` (constant-time verify, TASK-002's primitive reused — no new secret persisted, so a
fresh service instance loading only `quick.json` accepts a previously issued cookie after a
simulated restart). `regenerateToken()` (TASK-013) invalidates every outstanding cookie simply by
changing `tokenHash` (the pure-function binding does this for free — no cookie registry to
maintain/leak). Cookie value never appears in a URL/Location header.
Files: `src/main/phone-remote/cookie.ts`, `src/main/phone-remote/auth.ts`, `src/main/phone-remote/constants.ts`
Deps: TASK-002
Satisfies: REQ-028

### TASK-024 — Real workspace/pane metadata threading into the inventory (REQ-011 amendment)
Feeds TASK-006's pure inventory builder REAL data through the production composition instead of
the injected-test-seam-only path the v1 review found (FINDING-011/017/027): main-owned workspace
records (id/name) and human-readable pane titles (desktop pane chrome's label, with a
shell/kind+index fallback — never the raw internal pane id) are threaded into
`register-phone-remote.ts`'s live-pane registry, sourced from existing main-owned workspace state
and/or an additive renderer-fed metadata push (exact threading mechanism is implementation detail;
the acceptance is that the inventory holds through the REAL wiring, not only an injected seam).
**v2 — membership currency (closes FINDING-022/038):** a pane spawned or removed while a client is
connected triggers a fresh `panes` push (full inventory re-push, treated by the client as a list
replace) via TASK-006's status-change seam extended to a membership-change seam.
Files: `src/main/ipc/register-phone-remote.ts`, `src/main/phone-remote/inventory.ts`, `src/main/services.ts` (workspace-record read wiring)
Deps: TASK-006, TASK-013
Satisfies: REQ-011

### TASK-025 — Remote-pane grid parity through the real registrar routing (REQ-008/REQ-013 amendment)
`src/main/ipc/register-pty.ts`'s remote branches (the adopt path, the `remote.spawn` path, and the
`remote.owns` resize path) currently early-return before `deps.onSpawn`/`deps.onResize` — the v1
review (FINDING-040) found this meant remote panes got 80×24 mirrors and never a `grid` push no
matter how the desktop resized them. **v2:** invoke `deps.onSpawn` with the real spawn-args grid on
the remote adopt/spawn paths, and `deps.onResize` with the requested cols/rows on the `remote.owns`
resize path, so `mirror-manager.ts` (TASK-007) constructs/resizes remote-pane mirrors at their true
grid and `ws-session.ts` (TASK-011) pushes `grid` to attached clients with the same discipline as
local panes.
Files: `src/main/ipc/register-pty.ts`, `src/main/phone-remote/mirror-manager.ts`
Deps: TASK-007, TASK-011
Satisfies: REQ-008, REQ-013

### TASK-026 — Real backpressure transport wiring: drain trigger, resync hold-window, keepalive (REQ-017 amendment)
`src/main/phone-remote/ws-session.ts` + `service.ts`: **v2 — real drain trigger (closes
FINDING-001/015/029/030):** `ws.on('drain', ...)` is a no-op (the `ws` library's `WebSocket` never
emits it — verified against `node_modules/ws/lib/websocket.js`). Replace it with an actually-firing
signal — the `ws.send(data, cb)` completion callback sampling `bufferedAmount`, or an armed timer
that runs only while any pane is stale (CONV-036) — that calls `session.socketDrained()`.
**v2 — resync hold-window (closes FINDING-009):** the resync path reuses TASK-010's attach
hold-window discipline: on the drain trigger, each stale pane moves into a queued state (output
arriving between the trigger and the resync snapshot's resolution is queued, not sent), the resync
is sent, then the queue flushes as `data` — so replace-then-append never erases a delivered byte.
**v2 — status/grid coalescing delivered on drain** using TASK-008's extended policy.
**v2 — stale-state lifecycle (closes FINDING-020):** `unsubscribe`/`paneExit`/fresh-`subscribe`
clear a pane's stale flag via TASK-008's clear operation; a drain never resyncs a pane no longer
subscribed/live.
**v2 — ceiling + keepalive (closes FINDING-019):** a connection saturated continuously past
`PHONE_WS_STALL_TIMEOUT_MS` is terminated (lossless — TASK-019's fresh-reconnect attach covers it);
WS ping/pong keepalive (`PHONE_WS_PING_INTERVAL_MS`/`PHONE_WS_PONG_TIMEOUT_MS`) terminates
unresponsive sockets so a half-open sleeping phone cannot hold unbounded memory.
Files: `src/main/phone-remote/ws-session.ts`, `src/main/phone-remote/service.ts`
Deps: TASK-008, TASK-010, TASK-011
Satisfies: REQ-017

### TASK-027 — Settings surface actually mounted, with validation and live status (REQ-029)
**v2 — closes FINDING-010/024, the CRITICAL "component built but never rendered" gap:** add a
`phoneRemote` variant to `SettingsSection` (`src/renderer/store/types.ts`), add it to
`SettingsPanel.tsx`'s `SECTIONS` array, and render `<PhoneRemoteSettings/>` (TASK-015) for that
section — mirroring the existing general/appearance/environment/terminal/keybindings wiring.
Invalid port entry (outside 1–65535) surfaces a specific validation message and reverts the field
to the currently-active port rather than silently discarding. With `enabled: true` and a
stopped/errored server, the section shows a not-running cue plus the specific error text from
`status()`. Pinned by a test exercising the REAL mount/navigation path (render the actual
`SettingsPanel`, or e2e: open Settings, select the section) — never only a source-scan of the
isolated component file.
Files: `src/renderer/store/types.ts`, `src/renderer/components/SettingsPanel.tsx`, `src/renderer/components/PhoneRemoteSettings.tsx`
Deps: TASK-015
Satisfies: REQ-029

### TASK-028 — App-wide error push, independent of Settings mount (REQ-020 amendment)
**v2 — closes FINDING-034, HIGH:** the current `phoneRemote:changed` push is consumed only by
`PhoneRemoteSettings`'s own mount effect, so an enable failure while Settings is closed (including
a startup failure with persisted `enabled: true` and the port occupied, before any window has
loaded) surfaces nowhere. Add a dedicated `phoneRemote:error` (or equivalent) push consumed at
`src/renderer/App.tsx` (component-independent, always-subscribed — mirrors the CONV-034-class
pattern used elsewhere in the app) feeding the store's toast chokepoint with the error severity
that bypasses `quick.toastsEnabled` (CONV-004). `status().error` (TASK-013) is what a
late-subscribing window reads to catch up on a pre-load failure.
Files: `src/main/phone-remote/service.ts`, `src/shared/ipc-contract.ts`, `src/renderer/App.tsx`, `src/renderer/store` (toast-chokepoint wiring)
Deps: TASK-013, TASK-014
Satisfies: REQ-020

### TASK-029 — Pairing reachability: deterministic URL ranking, externalHost, copyable URL (REQ-031)
**v2 — closes FINDING-006/039/044/045, the "only reachable pairing story is LAN mode" gap:**
`src/main/phone-remote/network-urls.ts` — a PURE module that enumerates ALL non-internal IPv4
addresses from `os.networkInterfaces()` and ranks them deterministically (RFC1918 class preference,
name-sorted within a rank — never raw OS enumeration order, replacing the FINDING-006
enumeration-order bug), returning the full ranked list for `status().urls`. `service.ts` derives
the QR/pairing-URL host from `externalHost` (TASK-001) when set, else the top-ranked candidate.
`PhoneRemoteSettings.tsx` (TASK-015/027) renders the pairing URL as selectable/copyable text
alongside the QR whenever the QR renders, accepts the `externalHost` override, and — with no
override in localhost bind — discloses that the QR is only phone-reachable via LAN mode or an
external host.
Files: `src/main/phone-remote/network-urls.ts`, `src/main/phone-remote/service.ts`, `src/shared/phone-remote/settings.ts`, `src/renderer/components/PhoneRemoteSettings.tsx`
Deps: TASK-001, TASK-013, TASK-015
Satisfies: REQ-031

### TASK-030 — phoneRemote IPC sender gating (REQ-032)
Every `phoneRemote:*` IPC handler in `register-phone-remote.ts` (TASK-014) — all write-capable, and
`regenerateToken`/`pairingUrl` return the plaintext pairing token — rejects a sender that is not a
currently-tracked app window (`WindowManager.isKnownWindowSender`) before any handler logic runs,
mirroring `register-orky-action.ts`/`register-registry.ts`/`register-remote.ts`'s established
gating. Pinned by a unit/structural test analogous to `tests/main/orky-ipc-validation.test.ts`.
Files: `src/main/ipc/register-phone-remote.ts`
Deps: TASK-014
Satisfies: REQ-032

### TASK-031 — Client hardening: error/exit rendering, hello-drift, Ctrl-latch-over-typed-input (REQ-030, REQ-010 client half, REQ-023 amendment)
Consolidates the remaining client-side v1-review findings that are all small, same-file changes to
`main.ts`/`terminal-view.ts`/`pane-list.ts`:
- **REQ-030 (closes FINDING-035):** server `error` frames render to a visible status strip naming
  the reason (never silently discarded); a `paneExit` for the actively viewed pane shows an in-view
  "process exited" notice and disables input for it (the hidden list's chip alone is insufficient).
- **REQ-010 client half (closes FINDING-021/037):** `handleMessage` gains a `hello` case comparing
  `msg.proto` against the bundled `PHONE_REMOTE_PROTO_VERSION`; on mismatch it stops processing
  further messages and surfaces a "new version — reload" state, attempting a reload of the served
  bundle (a stale cached PWA never silently misparses newer traffic).
Files: `src/phone-client/main.ts`, `src/phone-client/terminal-view.ts`, `src/phone-client/pane-list.ts`
Deps: TASK-019, TASK-020
Satisfies: REQ-030, REQ-010

## Findings → task map (v2 loopback closure)

Every CRITICAL/HIGH/contract-violation finding from `findings.json` is closed by exactly the tasks
below (LOW/MEDIUM non-blocking findings not listed here — e.g. FINDING-004/007/014 — are folded
into the task they touch as incidental cleanup, not separately tracked):

| Finding | Task(s) |
|---|---|
| FINDING-001/015/029/030 (dead drain trigger) | TASK-026 |
| FINDING-002/019 (non-data traffic unbounded) | TASK-008, TASK-026 |
| FINDING-003/028 (client never unsubscribes) | TASK-020 |
| FINDING-005 (standing bookkeeping while disabled) | TASK-007 |
| FINDING-006 (nondeterministic LAN URL) | TASK-029 |
| FINDING-008 (presence- not identity-guarded supersession) | TASK-010 |
| FINDING-009 (resync erases delivered bytes) | TASK-026 |
| FINDING-010/024 (settings component never mounted) | TASK-027 |
| FINDING-011/017/027 (stub single-workspace inventory) | TASK-024 |
| FINDING-012 (e2e seam unconsumed) | TASK-003 (wiring), TASK-013/014 |
| FINDING-013/023 (missing e2e coverage) | carried to phase 4 (REQ-015/019/023/025 acceptance now mandates it) |
| FINDING-016/031 (client never sizes from real grid) | TASK-020 |
| FINDING-018 (non-serialized/non-idempotent lifecycle, zombie listener) | TASK-004, TASK-013 |
| FINDING-020 (stale flag outlives subscription) | TASK-008, TASK-026 |
| FINDING-021/037 (hello drift dead on client) | TASK-031 |
| FINDING-022/038 (inventory not re-pushed on membership change) | TASK-024 |
| FINDING-025 (auth-relaunch contradiction) | TASK-023 (spec: REQ-028) |
| FINDING-026/036 (infinite reconnect loop on revoked token) | TASK-019 |
| FINDING-032 (setPort port-0 IPC bypass) | TASK-014 |
| FINDING-033 (Ctrl-latch never composes with soft-keyboard input) | TASK-017, TASK-020 |
| FINDING-034 (error surfaced only to a mounted Settings) | TASK-028 |
| FINDING-035 (client never renders error/exit) | TASK-031 (spec: REQ-030) |
| FINDING-039/044/045 (pairing unreachable outside LAN) | TASK-029 (spec: REQ-031) |
| FINDING-040 (remote panes excluded from grid observability) | TASK-025 |
| FINDING-047 (phoneRemote IPC not sender-gated) | TASK-030 (spec: REQ-032) |

## Sequencing summary

1. Pure/foundational (no deps): TASK-001, TASK-002, TASK-003, TASK-006, TASK-008, TASK-009,
   TASK-017
2. Cookie primitive: TASK-023 (needs TASK-002)
3. Server transport + auth: TASK-004 → TASK-005 (needs TASK-023)
4. Fan-out + attach: TASK-007 → TASK-010 → TASK-011 → TASK-012
5. Remote-pane grid parity: TASK-025 (needs TASK-007, TASK-011)
6. Real backpressure transport: TASK-026 (needs TASK-008, TASK-010, TASK-011)
7. Composition + IPC + desktop UI: TASK-013 (needs TASK-023) → TASK-014 (sender-gated, REQ-032) →
   TASK-015 → TASK-027 (mount) → TASK-028 (app-wide error) → TASK-029 (pairing reachability)
   → TASK-030 (sender-gating test)
8. Real inventory wiring: TASK-024 (needs TASK-006, TASK-013)
9. Static/client build: TASK-018 → TASK-016 → TASK-019 (needs TASK-023) → TASK-020 → TASK-031
10. Packaging + docs: TASK-021, TASK-022 (last — documents TASK-001..031)

## Open issues

None. Every REQ-NNN in `02-spec.md` v2 (REQ-001..032) maps to at least one TASK above (see
`traceability.json`). Every blocking finding in `findings.json` maps to at least one TASK above
(see "Findings → task map"). FINDING-013/023 (missing e2e coverage) is explicitly carried forward
as a phase-4 (tests) obligation, not silently dropped — REQ-015/REQ-019/REQ-023/REQ-025's v2
acceptance criteria already mandate exactly those specs.
