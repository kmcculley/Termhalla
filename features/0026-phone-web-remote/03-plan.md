# 0026-phone-web-remote — Plan (phase 3)

- **Planned:** 2026-07-18
- **Inputs:** `02-spec.md` (REQ-001..027), `01-concept.md` (D1-D11), `.orky/baseline/architecture.md`
- **Baseline fit:** additive only — new privileged surface in `src/main`, a new third-party client
  outside the renderer/preload/main triangle. No existing module is restructured; every reuse point
  (F18 `createPaneReplay`, the status engine, `PtyManager`, `quick.json`'s coerce discipline, the
  `e2e-presentation.ts`/`e2e-remote.ts` seam pattern, `vite.agent.config.ts`'s third-build-target
  pattern) is an established convention, not a new one.

## Target file/module layout

```
src/main/phone-remote/
  constants.ts          # exported named constants (port default, WS water marks, max frame, proto ver)
  token.ts               # CSPRNG token gen, sha-256 hash, timingSafeEqual verify
  protocol.ts             # (re-exports from src/shared/phone-remote/protocol.ts for main-side use)
  inventory.ts             # workspace-grouped terminal-pane inventory + status source
  mirror-manager.ts         # per-pane @xterm/headless mirror registry (create/feed/resize/dispose)
  backpressure.ts            # PURE queue-policy module (high/low water, stale marking, resync trigger)
  ws-session.ts                # per-client WS session: subscribe/unsubscribe/input, attach, backpressure wiring
  auth.ts                        # HTTP+WS auth gate (allowlist, constant-time compare, 401/upgrade-refuse)
  static-assets.ts                 # serves the built web client bundle + REQ-005 unauthenticated allowlist
  server.ts                         # HTTP+WS listener lifecycle (bind modes, unref, error handler, stop())
  service.ts                         # composition: settings <-> quick.json, fan-out wiring, IPC-facing API
src/main/e2e-phone-remote.ts         # single env-gated e2e seam (TERMHALLA_E2E_PHONE_REMOTE)
src/main/ipc/register-phone-remote.ts # phoneRemote:* IPC channels
src/shared/phone-remote/
  protocol.ts             # WS JSON message vocabulary (types + guards), protocol version constant
  settings.ts               # phoneRemote quick.json shape + PHONE_REMOTE_PORT_DEFAULT
src/shared/ipc-contract.ts   # extended: phoneRemote:status/setEnabled/setBind/setPort/regenerateToken/changed
src/shared/types.ts           # QuickStore.phoneRemote? field
src/main/persistence/quick-store.ts # normalizeQuick coercion for phoneRemote
src/renderer/store/phone-remote-slice.ts # settings state + QR pairing UI state
src/renderer/components/PhoneRemoteSettings.tsx # Settings panel: enable/bind/port/QR/regenerate + LAN warning
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
Add `phoneRemote?: { enabled, bind, port, tokenHash? }` to `QuickStore` in `src/shared/types.ts` and
`src/shared/phone-remote/settings.ts` (exports `PHONE_REMOTE_PORT_DEFAULT = 8199` and a pure
`normalizePhoneRemote(value: unknown)` coercion). Wire the coercion into
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
injected token, deterministic-timer knobs as needed by later tasks), inert defaults when unset.
Mirrors `e2e-remote.ts`'s parse-safety discipline (malformed → undefined, never throw).
Files: `src/main/e2e-phone-remote.ts`
Deps: none
Satisfies: REQ-025

### TASK-004 — HTTP+WS server lifecycle
`src/main/phone-remote/server.ts`: `start(opts)`/`stop()`, binds `127.0.0.1` or `0.0.0.0` per
`bind`, listener + every accepted socket `unref()`'d, a listener-lifetime `'error'` handler
(EADDRINUSE/EACCES surfaced as a typed start-failure, not thrown), `stop()` destroys all accepted
sockets and closes WS connections. Consumes TASK-003's seam for a fixed test port. No mirror/auth
logic here — this is transport lifecycle only.
Files: `src/main/phone-remote/server.ts`
Deps: TASK-003
Satisfies: REQ-002, REQ-019, REQ-020

### TASK-005 — Auth gate (HTTP + WS upgrade)
`src/main/phone-remote/auth.ts`: extracts token from query param `token` or
`X-Termhalla-Token`, verifies via TASK-002, applied to every route except the fixed REQ-022
allowlist (manifest, icons — byte-identical regardless of app state). `tokenHash` absent ⇒ all
authenticated routes reject. Wire into TASK-004's request/upgrade handling.
Files: `src/main/phone-remote/auth.ts`, `src/main/phone-remote/static-assets.ts` (allowlist)
Deps: TASK-002, TASK-004
Satisfies: REQ-005, REQ-006 (rejection-on-regenerate half; closing sockets is TASK-007)

### TASK-006 — Pane inventory + status source
`src/main/phone-remote/inventory.ts`: builds the workspace-grouped terminal-pane inventory
(id/title/kind/cols/rows/status) from the existing status engine + workspace records, local and
remote-workspace panes only, non-terminal kinds excluded. Exposes a subscribe-to-status-changes
seam for push.
Files: `src/main/phone-remote/inventory.ts`
Deps: none (reads existing status engine / workspace state — read-only)
Satisfies: REQ-011

### TASK-007 — Mirror manager (fan-out point)
`src/main/phone-remote/mirror-manager.ts`: per-pane `createPaneReplay` (F18 reuse,
`HISTORY_LIMIT_DEFAULT`), created at server-enable (existing panes) and at pane spawn (while
enabled), disposed on pane exit or server-disable. Taps `PtyManager.onData` and the
remote-workspace `pty:data` surface ADDITIVELY (existing renderer-forward callback receives the
identical chunk sequence, unchanged ordering/timing) so the disabled path costs one constant-time
enabled check and performs no `feed`.
Files: `src/main/phone-remote/mirror-manager.ts`
Deps: none (wired into `PtyManager`/remote-workspace paths by TASK-011)
Satisfies: REQ-001, REQ-008, REQ-015 (fan-out purity), REQ-026 (mirror disposal on pane exit)

### TASK-008 — Backpressure policy (pure)
`src/main/phone-remote/backpressure.ts`: pure state machine over `{bufferedAmount}` inputs against
exported `PHONE_WS_HIGH_WATER`/`PHONE_WS_LOW_WATER` (in `src/main/phone-remote/constants.ts`):
above high-water stop enqueuing + mark stale; on a drain signal crossing low-water, emit exactly
one resync trigger per stale pane (driven by an actual drain event/armed timer per CONV-036, never
lazy re-check). No I/O — testable as pure functions/state.
Files: `src/main/phone-remote/constants.ts`, `src/main/phone-remote/backpressure.ts`
Deps: none
Satisfies: REQ-017

### TASK-009 — WS protocol vocabulary (shared)
`src/shared/phone-remote/protocol.ts`: JSON message types (server→client: `hello`, `panes`,
`status`, `grid`, `snapshot`, `data`, `resync`, `paneExit`, `error`; client→server: `subscribe`,
`unsubscribe`, `input`), the protocol-version constant, and a validating parser for inbound
messages (malformed JSON / wrong shape / unknown type / non-string `data` / oversized frame →
a typed parse-error result, never a throw). `PHONE_WS_MAX_FRAME` lives here or in TASK-008's
constants file (co-locate exported constants).
Files: `src/shared/phone-remote/protocol.ts`
Deps: none
Satisfies: REQ-010, REQ-014 (closed client→server set), REQ-018 (parse-time hardening)

### TASK-010 — WS session: attach (snapshot-then-stream, exactly-once)
`src/main/phone-remote/ws-session.ts` attach/subscribe path: on `subscribe`, resolves
`PaneReplay.snapshot()` (write-flush barrier), sends `snapshot`, then routes all pane-data fed
after the snapshot's sequence point as `data` — a hold-window queue for output arriving between
subscribe-call and snapshot-resolution so nothing is lost or duplicated. `unsubscribe` stops
routing for that pane.
Files: `src/main/phone-remote/ws-session.ts`
Deps: TASK-007, TASK-009
Satisfies: REQ-009, REQ-010 (routing/ordering half)

### TASK-011 — WS session: input, no-resize enforcement, grid pushes, exit pushes
Extends `ws-session.ts` + `service.ts` composition: `input{paneId,data}` writes byte-faithfully to
`PtyManager.write`/the remote-workspace write equivalent for a subscribed live pane; unknown/exited
pane → typed `error`, connection stays usable. The client-message dispatch table has NO path to any
resize seam (structural coverage at test phase). A desktop-side grid change resizes the pane's
mirror (`PaneReplay.resize`) and pushes `grid` to attached clients. On pane exit: `paneExit` push,
`status: exited`, mirror disposed (TASK-007), pane removed from inventory (TASK-006) once it leaves
main's pane set.
Files: `src/main/phone-remote/ws-session.ts`, `src/main/phone-remote/service.ts`
Deps: TASK-006, TASK-007, TASK-010
Satisfies: REQ-012, REQ-013, REQ-026

### TASK-012 — No-lifecycle enforcement + untrusted-input hardening
Ensures the accepted client message type set is exactly `{subscribe, unsubscribe, input}` (plus
pure keepalive if added) with no lifecycle/filesystem/editor paths reachable; every malformed/
unknown/oversized/binary frame from TASK-009's parser and every handler exception is caught at the
WS session boundary and turned into a specific `error`/clean-close — never an uncaught throw in
main.
Files: `src/main/phone-remote/ws-session.ts` (handler wrapping), `src/main/phone-remote/protocol.ts`
Deps: TASK-009, TASK-011
Satisfies: REQ-014, REQ-018

### TASK-013 — Service composition: settings, regenerate, status
`src/main/phone-remote/service.ts`: single composition object owning settings (TASK-001) <->
runtime server (TASK-004/005), token lifecycle (TASK-002) including `regenerateToken()` (atomic:
new hash persisted, all connected WS sessions closed via TASK-004's socket registry, old token
rejected immediately), and a `status()` read (`enabled, bind, port, running, urls, hasToken,
tokenAvailableThisSession`) for IPC. Registers mirrors (TASK-007) at enable time for existing panes
and at pane-spawn while enabled.
Files: `src/main/phone-remote/service.ts`
Deps: TASK-001, TASK-002, TASK-004, TASK-005, TASK-007
Satisfies: REQ-001, REQ-002, REQ-006, REQ-007 (service half), REQ-019, REQ-020

### TASK-014 — Desktop IPC contract + registrar
Extend `src/shared/ipc-contract.ts` (`CH.phoneRemoteStatus/setEnabled/setBind/setPort/
regenerateToken`, `phoneRemote:changed` push) and `TermhallaApi`; add
`src/main/ipc/register-phone-remote.ts` composed into `register.ts`, calling into TASK-013's
service; expose through `src/preload` and `src/renderer/api.ts`.
Files: `src/shared/ipc-contract.ts`, `src/main/ipc/register-phone-remote.ts`, `src/main/ipc/register.ts`, `src/renderer/api.ts`
Deps: TASK-013
Satisfies: REQ-007 (IPC plumbing), REQ-020 (error surfacing plumbing)

### TASK-015 — Desktop settings UI: enable/bind/port/QR/regenerate
`src/renderer/store/phone-remote-slice.ts` (settings + status state, wraps TASK-014's IPC) and
`src/renderer/components/PhoneRemoteSettings.tsx` (enable toggle, bind mode toggle with the LAN
plaintext warning shown only in LAN mode, port field, QR code render of the pairing URL using the
new `qrcode` dependency, "Regenerate" action with the post-restart no-stale-QR behavior). Routed
error from TASK-020's toast chokepoint bypasses `quick.toastsEnabled`.
Files: `src/renderer/store/phone-remote-slice.ts`, `src/renderer/components/PhoneRemoteSettings.tsx`, `package.json` (+`qrcode`)
Deps: TASK-014
Satisfies: REQ-002 (UI warning), REQ-007, REQ-020 (surfaced error UI)

### TASK-016 — Static asset serving + PWA install allowlist
`src/main/phone-remote/static-assets.ts`: serves TASK-018's built `out/phone-client/` bundle over
the embedded server, plus the fixed unauthenticated allowlist (manifest, icons — byte-identical
responses regardless of app state, no user/pane data). Wired into TASK-004's request routing ahead
of TASK-005's auth gate for allowlisted paths only.
Files: `src/main/phone-remote/static-assets.ts`
Deps: TASK-004, TASK-018
Satisfies: REQ-005 (allowlist), REQ-021, REQ-022

### TASK-017 — Web client: pure key-bar mapping module
`src/phone-client/key-bar.ts`: pure key -> byte-sequence table (Ctrl modifier-latch applied to the
next key including Ctrl+letter -> `0x01`-`0x1a`, Esc `\x1b`, Tab `\t`, arrows `\x1b[A`-`\x1b[D`),
unit-testable with no DOM dependency.
Files: `src/phone-client/key-bar.ts`
Deps: none
Satisfies: REQ-023 (key-bar mapping half)

### TASK-018 — Web client build target + shell + install assets
`vite.phone-client.config.ts` (third build target sibling of `vite.agent.config.ts`) bundling
`src/phone-client/` (xterm.js + all assets inlined, no CDN references) into `out/phone-client/`;
`index.html` with the iOS PWA meta tags (`apple-mobile-web-app-capable`, `apple-touch-icon`,
`viewport-fit=cover`), `manifest.webmanifest` (`display: standalone`, correct start URL), icons.
Wire into the root `npm run build` chain alongside the agent build.
Files: `vite.phone-client.config.ts`, `src/phone-client/index.html`, `src/phone-client/manifest.webmanifest`, `src/phone-client/icons/*`, `package.json` (build script chain)
Deps: none
Satisfies: REQ-021, REQ-022

### TASK-019 — Web client: token storage + URL stripping + WS client + reconnect
`src/phone-client/token-storage.ts` (persist token client-side, e.g. `localStorage`), `main.ts`
wiring: on load with `?token=`, store it and `history.replaceState` to strip it from the visible
URL immediately while the session stays authenticated; `ws-client.ts` opens the single multiplexed
WS (TASK-009 vocabulary), applies `resync` as a buffer REPLACE (reset+snapshot, never append), and
on drop retries with the stored token performing a fresh REQ-009-shaped attach per subscribed pane
(no assumed stream continuity across reconnects).
Files: `src/phone-client/token-storage.ts`, `src/phone-client/main.ts`, `src/phone-client/ws-client.ts`
Deps: TASK-009, TASK-017, TASK-018
Satisfies: REQ-023 (token/URL half), REQ-024

### TASK-020 — Web client: pane list + terminal view
`src/phone-client/pane-list.ts` (workspace-grouped list with live status chips driven by
TASK-006/011's `panes`/`status` pushes), `src/phone-client/terminal-view.ts` (tap -> full-screen
xterm.js rendered at the pane's current cols/rows per `grid` pushes, pinch-zoom/pan, no
client-originated resize call anywhere; wires TASK-017's key bar to emit `input` messages).
Files: `src/phone-client/pane-list.ts`, `src/phone-client/terminal-view.ts`
Deps: TASK-017, TASK-019
Satisfies: REQ-011 (client rendering half), REQ-013 (client half), REQ-023

### TASK-021 — Packaging
`electron-builder.yml`: include `out/phone-client/` in the packaged artifact alongside the existing
`out/agent` handling.
Files: `electron-builder.yml`
Deps: TASK-018
Satisfies: REQ-021

### TASK-022 — Docs: feature doc + living-doc updates
`docs/features/phone-web-remote.md` covering the security posture (off by default, localhost
default, LAN warning, single hashed token, regenerate-revokes-all), the `tailscale serve`
anywhere-access recipe, no-cloud-relay stance, history-begins-at-enable and
history-restarts-on-app-restart limits, and the deferred follow-ons list from the spec's "Out of
scope" section. Add the CLAUDE.md "Where things live" row and the CHANGELOG `[Unreleased]` entry
per repo convention.
Files: `docs/features/phone-web-remote.md`, `CLAUDE.md`, `CHANGELOG.md`
Deps: TASK-001..021 (documents the shipped shape)
Satisfies: REQ-027

## Sequencing summary

1. Pure/foundational (no deps): TASK-001, TASK-002, TASK-003, TASK-006, TASK-008, TASK-009, TASK-017
2. Server transport + auth: TASK-004 → TASK-005
3. Fan-out + attach: TASK-007 → TASK-010 → TASK-011 → TASK-012
4. Composition + IPC + desktop UI: TASK-013 → TASK-014 → TASK-015
5. Static/client build: TASK-018 → TASK-016 → TASK-019 → TASK-020
6. Packaging + docs: TASK-021, TASK-022 (last)

## Open issues

None. Every REQ-NNN in `02-spec.md` maps to at least one TASK above (see `traceability.json`).
