# 0026-phone-web-remote — Specification (phase 2)

- **Spec written:** 2026-07-18
- **Inputs:** `00-intake.md`, `01-concept.md` (decisions D1–D11, all four brainstorm forks resolved),
  `.orky/conventions.md`, `.orky/baseline/` (architecture + inferred spec)
- **Feature in one line:** an opt-in HTTP+WebSocket remote-access server in the Electron main
  process plus a packaged, mobile-first static web client (xterm.js, iPhone-Safari PWA) that lets
  the user read and type into every Termhalla pane from a phone — a passive mirror + input
  injector that never resizes, never manages pane lifecycle, and never perturbs the desktop
  renderer path.

## Concerns

`security`, `networking`, `performance`, `determinism`, `ux`

## Baseline fit

This feature adds a new privileged surface in **main** and a new client outside the three-layer
model; it supersedes **no** baseline requirement. Constraints it must uphold, not change:

- **Baseline REQ-001/REQ-002** — the desktop renderer still reaches main only through the typed
  `window.api`; all new desktop-side control (settings, QR) rides new `ipc-contract.ts` channels.
  The phone client is NOT a renderer: it talks only to the new server, never to IPC.
- **Baseline REQ-024** — persistence stays under `userData`, `quick.json` stays inside
  `normalizeQuick`'s coerce-on-read+write discipline, and **no secret material is persisted**
  (token stored as a hash only, see REQ-004).
- **CLAUDE.md load-bearing gotchas** — the phone must never trigger a PTY resize (ConPTY
  repaint / status-tail-eviction / busy-flip cascade — REQ-013), and no untrusted network input
  may ever produce an uncaught throw in main (Electron's modal-error-dialog freeze — REQ-018).

Terminology: "the server" = the embedded HTTP+WS listener; "a client" = one connected phone/browser
session; "pane data" = the pty output byte stream for one pane (local `PtyManager.onData` or the
remote-workspace `pty:data` surface in main).

---

## Server lifecycle & exposure

### REQ-001 — Off by default; disabled means inert
The feature MUST be off by default. While disabled (including on every fresh install and for any
malformed/absent persisted setting): no TCP listener exists, no headless mirror instances exist,
and no per-chunk work beyond a constant-time enabled check is added to the pane-data path.
**Acceptance:** with default settings, no socket is bound on the configured port and the mirror
registry is empty; enabling then disabling returns to that state (listener closed, all mirrors
disposed); a unit test on the fan-out seam shows the disabled path performs no mirror `feed`.

### REQ-002 — Bind modes: localhost default, LAN explicit
The server MUST bind `127.0.0.1` unless the user has explicitly selected LAN mode (`0.0.0.0`).
LAN mode MUST be a separate toggle from "enabled" (enabling the feature never implies LAN), and
the desktop settings UI MUST show a plaintext-transport warning when LAN mode is selected. The
documented anywhere-access story is `tailscale serve` proxying to the localhost bind — no cloud
relay and no built-in TLS in v1.
**Acceptance:** enabled with default settings ⇒ the port accepts connections on `127.0.0.1` and
refuses/does not listen on other interfaces; flipping the LAN toggle rebinds to `0.0.0.0`; the
settings surface renders the warning text only in LAN mode; `docs/features/phone-web-remote.md`
documents the tailscale story (see REQ-027).

### REQ-003 — Settings persist in quick.json as additive optional fields
Settings MUST persist in `quick.json` as one additive optional object field (proposed shape:
`phoneRemote?: { enabled: boolean; bind: 'localhost' | 'lan'; port: number; tokenHash?: string }`),
coerced by `normalizeQuick` on read AND write (non-object or field-wise-invalid values coerce to
absent = feature off, `bind` to `'localhost'`, `port` to the default). There MUST be **no**
`SCHEMA_VERSION` bump — `quick.json` is outside the migration chain (confirmed against
`src/main/persistence/quick-store.ts`, which already carries two additive optional fields with
this exact discipline). The default port MUST be an exported named constant (proposed
`PHONE_REMOTE_PORT_DEFAULT = 8199`).
**Acceptance:** `normalizeQuick` unit tests: a legacy `quick.json` without the field loads with
the feature off; `phoneRemote: 'junk'`, `{ enabled: 'yes' }`, `{ port: -1 }`, `{ bind: 'wan' }`
each coerce to the safe value; a valid object round-trips; `SCHEMA_VERSION` is untouched by this
feature (frozen-test discipline per CONV-022: pin the feature's own invariant, not the global's
current value).

### REQ-019 — Abortable, unref'd, shutdown-safe lifecycle
The server, every accepted socket, and every WS connection MUST be closable via a single `stop()`
wired to app shutdown, and the listener/sockets MUST be `unref()`'d so they never keep the main
process alive: `app.close()` and the e2e suite MUST NOT hang while the server is enabled with
live clients. The listener MUST retain a process-surviving `'error'` handler for its whole
serving lifetime — never only a bind-time handler (CONV-071).
**Acceptance:** an integration test enables the server, attaches a client, then closes the app
and observes exit within the normal teardown budget; a unit/structural test verifies the listener
has an `'error'` handler after successful bind and that `stop()` destroys accepted sockets.

### REQ-020 — Enable failures are surfaced, specific, and never suppressed
A failure to start the server (e.g. `EADDRINUSE`, `EACCES`) MUST leave the feature in a coherent
disabled/errored state and surface a user-visible error naming what failed, the configured port,
and how to fix it (change the port / free it) — never a bare "error" (CONV-001). Because this is
an error notification, the `quick.toastsEnabled` opt-in MUST NOT suppress it (CONV-004).
**Acceptance:** with the port already occupied, enabling yields an error message containing the
port number and a corrective hint, delivered through the store toast chokepoint with the
error severity that bypasses the toasts opt-in; the persisted/reported state does not claim the
server is running.

## Pairing & auth

### REQ-004 — High-entropy pairing token, hash-only at rest
The pairing token MUST be generated in main from a CSPRNG with ≥ 256 bits of entropy
(`crypto.randomBytes(32)`, base64url-encoded). Only a cryptographic hash of the token (SHA-256)
is ever persisted (`tokenHash` in REQ-003's shape); the plaintext token exists in main-process
memory only, for the current app session. No other secret material is written to disk.
**Acceptance:** the token generator's output is 43+ chars of base64url from `randomBytes`; the
persisted settings object contains `tokenHash` and no field containing the plaintext token
(serialize-and-scan test); after generating, the hash verifies against the plaintext.

### REQ-005 — Every data-bearing request authenticates; constant-time verification
Every WebSocket upgrade and the app-shell `GET /` MUST present the pairing token (query parameter
`token` or `X-Termhalla-Token` header) and MUST be rejected (HTTP 401 / upgrade refused) when the
token is absent or wrong — before any pane-derived data, pane inventory, or input handling is
reachable. Verification MUST compare hash-to-hash with a constant-time comparison
(`crypto.timingSafeEqual` over equal-length digests). A small fixed allowlist of secret-free,
state-independent install assets (PWA manifest, icons) MAY be served unauthenticated and MUST
contain no user or pane data; every other route is 404/401. When no token has ever been
generated (`tokenHash` absent), ALL authenticated routes MUST reject.
**Acceptance:** unauthenticated / wrong-token requests to `/` and to the WS endpoint are
rejected with no pane information in the response; the allowlist responses are byte-identical
regardless of app state; the comparison call site uses `timingSafeEqual` (structural test);
with `tokenHash` absent, a request presenting any token is rejected.

### REQ-006 — Regenerate revokes everything
Regenerating the token MUST atomically: replace the stored hash, invalidate the old token for all
future requests, and immediately close every currently connected WS client. There is exactly one
token (single-grant model; per-device grants and read-only tier are out of scope, deferred).
**Acceptance:** with a client attached under token A, regenerate ⇒ the client's WS is closed by
the server, token A is rejected on reconnect, and the new token B is accepted.

### REQ-007 — QR pairing surface on the desktop
While the server is enabled, the desktop settings UI MUST offer pairing: it shows the reachable
URL(s) for the current bind mode and a QR code encoding a pairing URL that includes the plaintext
token. Because the plaintext exists only in session memory (REQ-004), after an app restart the UI
MUST NOT claim to show a valid QR; it MUST instead offer "Regenerate" (with the disclosed
consequence: all paired devices must re-scan) — already-paired phones, which stored the token
client-side, keep working across restarts without re-pairing (see REQ-024).
**Acceptance:** enabling + generating renders a QR whose decoded content is a URL containing the
host:port and the plaintext token; after a simulated restart (fresh service instance loading only
persisted state), the pairing surface offers regenerate and renders no stale QR; a paired
client's stored token still authenticates after the restart.

## Mirrors & attach (scrollback)

### REQ-008 — Always-on bounded mirrors while enabled
While the server is enabled, every live pane whose bytes surface in main — local PTY panes AND
remote-workspace panes — MUST feed a per-pane bounded `@xterm/headless` mirror created via the
F18 `createPaneReplay` factory (`src/agent/replay.ts`), sized to the pane's current cols/rows
with bounded scrollback (`HISTORY_LIMIT_DEFAULT` = 2000 lines, the tmux `history-limit` analog;
the bound is stated here and asserted by test per CONV-003). Mirrors are created at server-enable
(for existing panes) and at pane spawn (while enabled); a mirror is disposed when its pane exits
or when the server is disabled. Mirror history begins at enable time (seeding from a renderer
serialize is explicitly deferred).
**Acceptance:** with the server enabled, spawning a pane creates exactly one mirror; feeding it
output then attaching yields that output in the snapshot; disabling disposes all mirrors
(REQ-001); the mirror is constructed with the pane's current grid and the 2000-line scrollback
bound; a remote-workspace pane's forwarded bytes reach its mirror through the same discipline.

### REQ-009 — Attach is snapshot-then-stream, exactly-once
A client subscribing to a pane MUST receive: (1) one snapshot message containing the mirror's
serialized state, then (2) the live pane-data stream, under a hold-window ordering guarantee —
no pane-data byte fed before the snapshot point is missing from the snapshot, and no byte is
delivered both in the snapshot and again as live data (exactly-once reconstruction, riding
`PaneReplay.snapshot()`'s write-flush barrier). This MUST hold under interleaving: output
arriving concurrently with the attach is either in the snapshot or in the post-snapshot stream,
never dropped, never duplicated (CONV-060: this concurrency guarantee carries its own interleaved
acceptance vector at the tests phase — never prose-only).
**Acceptance:** a deterministic interleaving test feeds output before, during (between subscribe
and snapshot resolution), and after attach, and asserts the client's reconstructed byte sequence
(snapshot ⊕ stream) renders exactly the reference terminal's final state with no duplicated or
lost region; repeated with output racing the subscribe call.

## Transport & protocol

### REQ-010 — One multiplexed WS per client with a versioned JSON vocabulary
Each client uses exactly ONE WebSocket multiplexing all panes. The message vocabulary is JSON:
server→client at minimum `hello` (protocol version), `panes` (inventory), `status`, `grid`,
`snapshot`, `data`, `resync`, `paneExit`, `error`; client→server at minimum `subscribe`,
`unsubscribe`, `input`. `data`/`snapshot`/`resync` are pane-scoped. The `hello` protocol version
lets a stale cached client detect drift and prompt a reload. Per-pane delivery order to one
client MUST match main's observed pane-data order.
**Acceptance:** a protocol unit test drives one socket through inventory → subscribe(A) →
subscribe(B) → data on both → unsubscribe(A) and asserts pane-scoped routing, ordering per pane,
and that unsubscribed panes stop flowing; `hello` carries the exported protocol-version constant.

### REQ-011 — Pane inventory with live status
The server MUST expose a workspace-grouped pane inventory (workspace name/id, pane id, title/kind,
current cols/rows, status) sourced from the existing status engine, and MUST push status changes
(`idle | busy | needs-input | exited`) to connected clients while they hold the inventory. The
inventory includes local and remote-workspace terminal panes; non-terminal panes (editor,
explorer, orky, notes) are not listed in v1.
**Acceptance:** with two workspaces and a mix of pane kinds, the inventory lists only terminal
panes grouped by workspace with their current status; a status flip in main (e.g. busy→idle)
produces a `status` push observed by an attached client without re-requesting inventory.

### REQ-012 — Input injection
An authenticated client's `input` message for a subscribed, live pane MUST be written to that
pane's input path — `PtyManager.write` for local panes, the remote-workspace write equivalent for
remote panes — byte-faithfully (UTF-8 text as sent, including control bytes from the key bar).
`input` for an unknown or exited pane MUST yield a specific `error` message (CONV-001) and MUST
NOT throw or crash the connection.
**Acceptance:** an input round-trip test sends `input` and observes the bytes at the pane write
seam unmodified; input to a bogus pane id returns an `error` naming the pane id and the reason,
and the socket stays usable.

### REQ-013 — The phone never resizes; grid follows the desktop
No server code path reachable from a client message may invoke a PTY resize, and the protocol
MUST NOT contain a resize request. The client renders each pane at the pane's current cols/rows
(pinch-zoom/pan for fit). When the desktop resizes a pane, the server MUST resize that pane's
mirror (`PaneReplay.resize`) and push a `grid` message so attached clients re-render at the new
dimensions — still without any client-originated resize.
**Acceptance:** a structural/unit test asserts the client-message dispatch table contains no path
to `PtyManager.resize` (or the remote resize seam); a desktop-side grid change produces a `grid`
push with the new cols/rows and the mirror reports the new size; fuzzing arbitrary client
messages never reaches a resize seam.

### REQ-014 — No pane lifecycle actions
The protocol MUST expose no pane lifecycle capability: no kill/spawn/close/rearrange/split, no
workspace mutation, no filesystem or editor access. The server's writable surface is exactly
`input` (REQ-012); everything else is read-only.
**Acceptance:** a table-driven test enumerates the accepted client message types and asserts the
set is exactly `{subscribe, unsubscribe, input}` (plus any pure keepalive); unknown types get the
REQ-018 error treatment.

### REQ-015 — The desktop renderer path is byte-identical
The fan-out MUST be additive at main's existing pane-data surfaces: with the feature disabled AND
with it enabled (clients attached or not), the bytes, ordering, and timing semantics of the
existing renderer forward (`pty:data` IPC), the status engine feed, recording, and search
indexing are unchanged. Backpressure from a slow client (REQ-017) MUST never block or delay the
renderer path.
**Acceptance:** a unit test on the fan-out seam asserts the renderer-forward callback receives
the identical chunk sequence with and without an attached subscriber; an e2e drives a pane with
the server enabled + a client attached and asserts the desktop terminal renders exactly as the
server-off baseline.

### REQ-016 — Concurrent clients coexist without exclusivity
Multiple simultaneously connected clients MUST be supported, each with independent subscriptions
and independent backpressure state; there is NO attach lease and no steal semantics (D7 — the
phone mirrors, it never steals; the F20 exclusive lease is deliberately not reused). Input from
any authenticated client is accepted; the desktop is never displaced (CONV-064: this shared-state
concurrency granularity is stated and tested, not implied).
**Acceptance:** two clients subscribe to the same pane and both receive the full stream; one
client's slow-consumer state (REQ-017) does not degrade the other's delivery; both may send input;
disconnecting one leaves the other and the desktop unaffected.

### REQ-017 — Backpressure: bounded queue, drop-and-resnapshot
Per-client buffering MUST be bounded by exported named constants (proposed:
`PHONE_WS_HIGH_WATER = 1 MiB` of socket-buffered bytes, `PHONE_WS_LOW_WATER = 256 KiB`). When a
client's buffered amount exceeds the high-water mark, the server stops enqueueing pane `data` for
that client and marks its subscribed panes stale; when the buffer drains below the low-water
mark, each stale pane is re-synced with a `resync` message carrying a fresh mirror snapshot that
REPLACES the client's buffer for that pane. Memory per client is thereby bounded; no unbounded
queue may exist (CONV-003: the limits are stated here and asserted by test; CONV-036: any
deferred flush/resync MUST be driven by an actually-scheduled trigger — a drain event or armed
timer — never only lazily re-checked on the next inbound chunk, so a gone-quiet stream cannot
strand a stale pane un-resynced forever).
**Acceptance:** a pure queue-policy unit test drives the policy over the thresholds and asserts:
above high water no data is enqueued, panes are marked stale, below low water exactly one resync
per stale pane is emitted even if the pane's stream went quiet before the drain (the resync fires
from the drain signal, not from a future data chunk); the constants are exported and equal the
stated values; the client applies `resync` as a buffer replacement (reset + snapshot), not an
append.

### REQ-018 — Untrusted input never crashes main; errors are specific
Every inbound HTTP request and WS frame is untrusted. Malformed JSON, schema-invalid messages,
unknown message types, oversized frames (bound stated as an exported constant, proposed
`PHONE_WS_MAX_FRAME = 1 MiB`), and mid-handshake garbage MUST each produce a specific, actionable
`error` message (CONV-001) and/or a clean connection close — and MUST NEVER propagate an uncaught
throw in the main process (an uncaught throw in a listener raises Electron's modal error dialog
and freezes the app). Boundary and malformed inputs are first-class tested (CONV-002).
**Acceptance:** a table-driven test feeds not-JSON, wrong-shaped JSON, unknown `type`, missing
fields, non-string `data`, an over-limit frame, and binary frames, asserting each yields the
documented error/close with no throw escaping the handler; the frame-size constant is exported
and enforced.

## Web client

### REQ-021 — Packaged, self-contained static client
The web client MUST be built by a third vite build target (sibling of `vite.agent.config.ts`)
into `out/`, served by the embedded server, and packaged into the installer. The served app
makes NO network requests to any origin other than the serving host (no CDN, no runtime
downloads); xterm.js and all assets ship in the bundle.
**Acceptance:** `npm run build` emits the client bundle under `out/`; a scan of the emitted
HTML/JS finds no absolute `http(s)://` asset/script/fetch references to foreign origins; the
packaged-artifact config (`electron-builder.yml`) includes the bundle.

### REQ-022 — iOS home-screen PWA installability
The client MUST be installable to the iPhone home screen: it serves a web app manifest and the
iOS-specific tags (`apple-mobile-web-app-capable`, `apple-touch-icon`, viewport configured for a
full-screen terminal with `viewport-fit=cover`), and runs standalone from the home screen. These
install assets are the REQ-005 unauthenticated allowlist.
**Acceptance:** the served shell contains the manifest link, apple meta tags, and touch icon;
the manifest parses with `display: standalone` (or `fullscreen`) and correct start URL; icons
and manifest are fetchable per REQ-005's allowlist rules.

### REQ-023 — Phone UI: pane list, terminal view, accessory key bar
The client UI is v1-scoped to: (a) a workspace-grouped pane list rendering each pane's live
status chip (busy / idle / needs-input / exited, driven by REQ-011 pushes); (b) tap → a
full-screen xterm.js terminal for that pane, rendered at the pane's grid (REQ-013) with
pinch-zoom/pan; (c) an accessory key bar with at least Ctrl (modifier-latch applied to the next
key), Esc, Tab, and arrow keys, emitting the correct byte sequences (`\x1b`, `\t`,
`\x1b[A`–`\x1b[D`, Ctrl+letter → `0x01`–`0x1a`). The key→bytes mapping MUST be a pure,
unit-testable module. On first load from a pairing URL the client stores the token client-side
and immediately strips it from the visible URL (`history.replaceState`) so it does not linger in
browser history.
**Acceptance:** unit tests on the key-bar mapping cover each listed key and the Ctrl latch
(including Ctrl+C → `\x03`) and malformed/no-op cases; a DOM-level test (or e2e against the
served client) shows list → terminal navigation and that key-bar taps produce `input` messages
with the mapped bytes; after load with `?token=`, the address no longer contains the token while
the session remains authenticated.

## Sessions, exit, and reconnection

### REQ-026 — Pane exit is pushed; the mirror ends with the pane
When a subscribed pane exits, attached clients MUST receive a `paneExit` (and terminal `status`
of `exited`); subsequent `input` for it gets the REQ-012 error. The pane's mirror is disposed on
pane exit (final output already delivered flows through the normal stream); an exited pane
disappears from the inventory when it leaves main's pane set.
**Acceptance:** killing a pane's process with a client attached yields the exit push, the mirror
is disposed (no leak — mirror count returns to the live-pane count), and input afterward returns
the specific error.

### REQ-024 — Reconnection is a fresh attach; pairing survives restarts and updates
A dropped WS (network blip, phone sleep, app restart) requires no re-pairing: the client retries
with its stored token and each successful reconnect performs fresh REQ-009 attach semantics per
subscribed pane (snapshot replaces the client's buffer — the client MUST NOT assume stream
continuity across connections). Because the server lives in-process (no daemon), an app
auto-update restart behaves exactly like any restart: the persisted `tokenHash` keeps the paired
phone valid with zero user action (CONV-065: the close → update → reopen lifecycle is the
analyzed default, and it degrades to nothing worse than a reconnect; pane history restarts at
the new session's enable point per REQ-008 — an accepted, documented limit, not silent loss).
**Acceptance:** kill and re-establish a client's WS mid-stream: the reconnect attach renders the
pane correctly from snapshot ⊕ new stream with no duplicated region; a fresh server instance
loading only persisted state accepts the previously paired token; the history-restart limit is
stated in the feature doc (REQ-027).

## Testing & docs discipline

### REQ-025 — e2e seam: one env-gated module with a structural guard
Any test-only server behavior (fixed port, injected token, deterministic timers) MUST ride a
single env-gated seam module in `src/main` (the `e2e-presentation.ts` / `e2e-remote.ts`
discipline): exactly ONE module reads the env var (proposed `TERMHALLA_E2E_PHONE_REMOTE`), a
structural test forbids the variable name anywhere else under `src/main`, and with the variable
unset, production behavior is byte-identical. The structural guard's scan MUST key on the
feature-specific variable name (CONV-037) and be anchored (CONV-032).
**Acceptance:** the structural test enumerates `src/main` sources and fails on any occurrence of
the env var outside the seam module; the seam's exports are inert (identity/defaults) when the
var is unset.

### REQ-027 — Documentation ships with the feature
`docs/features/phone-web-remote.md` MUST exist and document: the security posture (off by
default, localhost default, LAN warning, single hashed token, regenerate-revokes-all), the
`tailscale serve` anywhere-access recipe, the no-cloud-relay stance, the history-begins-at-enable
and history-restarts-on-app-restart limits (REQ-008/REQ-024), and the deferred follow-ons (Web
Push, native iOS client, per-device grants, read-only tier, TLS, renderer-seeded history). The
CLAUDE.md "Where things live" table and CHANGELOG gain their entries per repo convention.
**Acceptance:** the doc exists and contains each listed topic (string-presence checkable); the
CLAUDE.md table row and `[Unreleased]` changelog entry exist.

---

## Public interface

### Persisted settings (quick.json — additive, REQ-003)
```ts
phoneRemote?: {
  enabled: boolean
  bind: 'localhost' | 'lan'
  port: number            // default PHONE_REMOTE_PORT_DEFAULT (8199)
  tokenHash?: string      // sha-256 of the pairing token, base64url; absent = never paired
}
```

### Desktop IPC (extends `src/shared/ipc-contract.ts`, `domain:verb` — baseline REQ-002)
Indicative set (exact channel names are plan detail; all go through the contract + preload):
- `phoneRemote:status` (invoke) → `{ enabled, bind, port, running, urls: string[], hasToken, tokenAvailableThisSession }`
- `phoneRemote:setEnabled` / `phoneRemote:setBind` / `phoneRemote:setPort` (invoke)
- `phoneRemote:regenerateToken` (invoke) → `{ pairingUrl }` (contains the plaintext token; renderer renders the QR and never persists it)
- `phoneRemote:changed` (main→renderer push)

### WS protocol (REQ-010 vocabulary)
- server→client: `hello{proto}`, `panes{workspaces[]}`, `status{paneId,status}`,
  `grid{paneId,cols,rows}`, `snapshot{paneId,data}`, `data{paneId,data}`,
  `resync{paneId,data}` (buffer-replacing), `paneExit{paneId,…}`, `error{code,message}`
- client→server: `subscribe{paneId}`, `unsubscribe{paneId}`, `input{paneId,data}`
- Exact JSON field shapes are plan detail; the message-type sets above are normative
  (REQ-014 pins the client→server set closed).

### Exported constants (each pinned by test — CONV-003)
`PHONE_REMOTE_PORT_DEFAULT = 8199`, `PHONE_WS_HIGH_WATER = 1_048_576`,
`PHONE_WS_LOW_WATER = 262_144`, `PHONE_WS_MAX_FRAME = 1_048_576`, protocol version constant;
mirror scrollback reuses `HISTORY_LIMIT_DEFAULT` (2000) from `src/agent/replay.ts`.

## Out of scope (recorded, deferred per concept)
needs-you Web Push; native iOS client; per-device grants / read-only tier; built-in TLS;
renderer-serialize mirror seeding at enable; utility action buttons / run-commands on phone;
Orky needs-you tab on phone; non-terminal pane kinds in the inventory.

## Open questions
None blocking. All brainstorm forks were resolved in `01-concept.md` (D1–D11); the spec-level
details the concept delegated (auth presentation mechanics, backpressure thresholds, default
port, exit/reconnect semantics) are decided above as testable requirements.
