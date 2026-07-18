# 0026-phone-web-remote — Specification (phase 2)

- **Spec written:** 2026-07-18 · **Amended (v2):** 2026-07-18, ESC-001 shift-left loopback
- **Inputs:** `00-intake.md`, `01-concept.md` (decisions D1–D11, all four brainstorm forks resolved),
  `.orky/conventions.md`, `.orky/baseline/` (architecture + inferred spec), review `findings.json`
  + the ESC-001 human decision (Kevin, 2026-07-18).
- **Feature in one line:** an opt-in HTTP+WebSocket remote-access server in the Electron main
  process plus a packaged, mobile-first static web client (xterm.js, iPhone-Safari PWA) that lets
  the user read and type into every Termhalla pane from a phone — a passive mirror + input
  injector that never resizes, never manages pane lifecycle, and never perturbs the desktop
  renderer path.

## Concerns

`security`, `networking`, `performance`, `determinism`, `ux`

## Amendment history (v2 — ESC-001 loopback)

Per CONV-018, every review decision that changes or disambiguates a REQ is propagated here in the
same loopback. No REQ was renumbered; REQ-028…REQ-032 are new.

- **REQ-005 / REQ-006 / REQ-007 / REQ-022 / REQ-023 / REQ-024 amended + REQ-028 new** — the
  authenticated-relaunch contradiction (FINDING-025) is resolved by the human-chosen **HttpOnly
  session cookie** model: the first token-authenticated request sets it; `GET /` passes with token
  OR valid cookie, 401 otherwise; Regenerate revokes cookies too (cookie bound to the token
  generation).
- **REQ-011 amended** — the single-synthetic-workspace inventory stub is **rejected**: the
  inventory carries REAL workspace ids/names and human-readable pane titles, includes
  remote-workspace panes, and stays current on pane spawn/close (FINDING-011/017/022/027/038).
- **REQ-008 / REQ-013 amended** — remote-workspace panes get full server-side grid observability
  (mirror built at the real grid; desktop resize of a remote pane produces mirror resize + `grid`
  push — FINDING-040); the client sizes its terminal from the freshest known grid before the
  snapshot renders (FINDING-016/031).
- **REQ-009 amended** — attach supersession is identity-guarded (FINDING-008); **REQ-017
  amended** — real drain trigger (FINDING-001/015/029/030), resync hold-window exactly-once
  (FINDING-009), bound covers ALL message classes + keepalive/stall termination
  (FINDING-002/019), stale-state lifecycle (FINDING-020).
- **REQ-010 amended** — client half of the `hello` drift check (FINDING-021/037).
- **REQ-015 / REQ-019 / REQ-023 / REQ-025 acceptance amended** — the four review-mandated e2e
  coverages (desktop-byte-identical, app-close liveness, backpressure saturation + resync
  arrival, served-client DOM) are now required acceptance, not residual obligations
  (FINDING-013/023/041; CONV-052).
- **REQ-020 amended** — errors ride an app-wide, always-subscribed path and `status()` carries
  the last error (FINDING-034/043/049); lifecycle ops serialized/idempotent, no zombie listener
  (FINDING-018).
- **New:** REQ-028 (session cookie), REQ-029 (settings surface actually mounted + state rendered
  — FINDING-010/024/043/046), REQ-030 (client renders errors/exit — FINDING-035/050/048),
  REQ-031 (pairing usability/reachability — FINDING-039/044/045/006), REQ-032 (IPC sender
  gating — FINDING-047).

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
and no per-chunk work beyond a constant-time enabled check is added to the pane-data path — in
particular no standing per-chunk live-pane bookkeeping while disabled; any registry the server
needs is rebuilt at enable time from `PtyManager`/remote-manager state (v2 clarification,
FINDING-005).
**Acceptance:** with default settings, no socket is bound on the configured port and the mirror
registry is empty; enabling then disabling returns to that state (listener closed, all mirrors
disposed); a unit test on the fan-out seam shows the disabled path performs no mirror `feed` and
no per-chunk map/set mutation.

### REQ-002 — Bind modes: localhost default, LAN explicit
The server MUST bind `127.0.0.1` unless the user has explicitly selected LAN mode (`0.0.0.0`).
LAN mode MUST be a separate toggle from "enabled" (enabling the feature never implies LAN), and
the desktop settings UI (the REQ-029 mounted surface) MUST show a plaintext-transport warning
when LAN mode is selected. The documented anywhere-access story is `tailscale serve` proxying to
the localhost bind — no cloud relay and no built-in TLS in v1.
**Acceptance:** enabled with default settings ⇒ the port accepts connections on `127.0.0.1` and
refuses/does not listen on other interfaces; flipping the LAN toggle rebinds to `0.0.0.0`; the
settings surface renders the warning text only in LAN mode, verified through the REAL mount path
(REQ-029); `docs/features/phone-web-remote.md` documents the tailscale story incl. its pairing
step (see REQ-027/REQ-031).

### REQ-003 — Settings persist in quick.json as additive optional fields
Settings MUST persist in `quick.json` as one additive optional object field (proposed shape:
`phoneRemote?: { enabled: boolean; bind: 'localhost' | 'lan'; port: number; tokenHash?: string;
externalHost?: string }`), coerced by `normalizeQuick` on read AND write (non-object or
field-wise-invalid values coerce to absent = feature off, `bind` to `'localhost'`, `port` to the
default, `externalHost` to absent). There MUST be **no** `SCHEMA_VERSION` bump — `quick.json` is
outside the migration chain (confirmed against `src/main/persistence/quick-store.ts`, which
already carries additive optional fields with this exact discipline). The default port MUST be an
exported named constant (proposed `PHONE_REMOTE_PORT_DEFAULT = 8199`). The same coercion
discipline MUST apply at the IPC boundary: an invalid port argument coerces to the default —
port `0` (OS-assigned) is reserved strictly to the REQ-025 e2e seam and MUST NOT be reachable
from a production IPC call (v2 clarification, FINDING-032).
**Acceptance:** `normalizeQuick` unit tests: a legacy `quick.json` without the field loads with
the feature off; `phoneRemote: 'junk'`, `{ enabled: 'yes' }`, `{ port: -1 }`, `{ bind: 'wan' }`
each coerce to the safe value; a valid object round-trips; `SCHEMA_VERSION` is untouched by this
feature (frozen-test discipline per CONV-022: pin the feature's own invariant, not the global's
current value); the setPort IPC handler given `NaN`/float/out-of-range yields the default port,
never `0`.

### REQ-019 — Abortable, unref'd, shutdown-safe lifecycle
The server, every accepted socket, and every WS connection MUST be closable via a single `stop()`
wired to app shutdown, and the listener/sockets MUST be `unref()`'d so they never keep the main
process alive: `app.close()` and the e2e suite MUST NOT hang while the server is enabled with
live clients. The listener MUST retain a process-surviving `'error'` handler for its whole
serving lifetime — never only a bind-time handler (CONV-071). Service lifecycle mutations
(enable/disable/setPort/setBind/regenerate) MUST be serialized (one op-queue/mutex) and
idempotent: a redundant enable while already listening is a no-op, never a misclassified bind
failure, and a stop racing an in-flight start MUST NOT leak the freshly bound listener — the
reported state and the actual listening state can never diverge (no zombie listener; v2,
FINDING-018).
**Acceptance:** an **e2e** (Playwright, riding the REQ-025 seam) enables the server, attaches a
live WS client, then closes the app and observes teardown complete within the normal worker
budget (v2, FINDING-023); a unit/structural test verifies the listener has an `'error'` handler
after successful bind and that `stop()` destroys accepted sockets; a double `setEnabled(true)`
leaves exactly one healthy listener with `status().running === true`, and `setPort` racing a
pending enable converges to exactly one listener on the final port.

### REQ-020 — Failures are surfaced app-wide, specific, and never suppressed
A failure to start the server (e.g. `EADDRINUSE`, `EACCES`) MUST leave the feature in a coherent
disabled/errored state and surface a user-visible error naming what failed, the configured port,
and how to fix it (change the port / free it) — never a bare "error" (CONV-001). Because this is
an error notification, the `quick.toastsEnabled` opt-in MUST NOT suppress it (CONV-004). The
error MUST travel a component-independent, always-subscribed app-wide path (a main→renderer error
push consumed at the root, reaching the store toast chokepoint) — never only a settings-component
mount listener (v2, FINDING-034; CONV-034 class). A startup failure occurring before any window
has loaded MUST still surface: `status()` MUST carry the last failure message so late-subscribing
windows report it (v2, FINDING-049).
**Acceptance:** with the port already occupied, enabling yields an error toast containing the
port number and a corrective hint, delivered through the store toast chokepoint with the error
severity that bypasses the toasts opt-in, **with the Settings panel closed** (component-independent
path); with persisted `enabled: true` and the port occupied at app startup, the first loaded
window still surfaces the error and `status().error` names it; the persisted/reported state does
not claim the server is running.

## Pairing & auth

### REQ-004 — High-entropy pairing token, hash-only at rest
The pairing token MUST be generated in main from a CSPRNG with ≥ 256 bits of entropy
(`crypto.randomBytes(32)`, base64url-encoded). Only a cryptographic hash of the token (SHA-256)
is ever persisted (`tokenHash` in REQ-003's shape); the plaintext token exists in main-process
memory only, for the current app session. No other secret material is written to disk on the
desktop — in particular the REQ-028 cookie model introduces NO new desktop-persisted secret
(cookie validity is a pure function of the persisted `tokenHash`).
**Acceptance:** the token generator's output is 43+ chars of base64url from `randomBytes`; the
persisted settings object contains `tokenHash` and no field containing the plaintext token
(serialize-and-scan test); after generating, the hash verifies against the plaintext.

### REQ-005 — Every data-bearing request authenticates; token OR session cookie; constant-time
*(amended v2 — ESC-001 / FINDING-025)* Every WebSocket upgrade and the app-shell `GET /` MUST
present a valid credential — the pairing token (query parameter `token` or `X-Termhalla-Token`
header) **or a valid REQ-028 session cookie** — and MUST be rejected (HTTP 401 / upgrade refused)
when both are absent or wrong — before any pane-derived data, pane inventory, or input handling
is reachable. Verification of either credential MUST compare hash-to-hash with a constant-time
comparison (`crypto.timingSafeEqual` over equal-length digests) against the persisted
`tokenHash`. A small fixed allowlist of secret-free, state-independent install assets (PWA
manifest, icons) MAY be served unauthenticated and MUST contain no user or pane data; every other
route is 404/401. When no token has ever been generated (`tokenHash` absent), ALL authenticated
routes MUST reject. The 401 response body MUST be actionable and secret-free (e.g. "missing or
invalid pairing token — open this page from the pairing QR in Termhalla Settings"; CONV-001, v2
FINDING-048).
**Acceptance:** unauthenticated / wrong-token / wrong-cookie requests to `/` and to the WS
endpoint are rejected with no pane information in the response; a valid cookie alone passes both
(see REQ-028 vectors); the allowlist responses are byte-identical regardless of app state; the
comparison call sites use `timingSafeEqual` (structural test); with `tokenHash` absent, a request
presenting any token or cookie is rejected; the 401 body contains the actionable hint.

### REQ-006 — Regenerate revokes everything
*(amended v2)* Regenerating the token MUST atomically: replace the stored hash, invalidate the
old token for all future requests, **invalidate every previously issued session cookie** (the
cookie is bound to the token generation — REQ-028), and immediately close every currently
connected WS client. There is exactly one token (single-grant model; per-device grants and
read-only tier are out of scope, deferred).
**Acceptance:** with a client attached under token A (and a cookie issued under A), regenerate ⇒
the client's WS is closed by the server, token A AND cookie A are rejected on reconnect, and the
new token B is accepted.

### REQ-028 — HttpOnly session cookie: pairing survives every entry path *(new in v2)*
The first token-authenticated HTTP response MUST set a persistent session cookie
(`Set-Cookie`, name `PHONE_COOKIE_NAME`) with `HttpOnly`, `SameSite=Lax`, `Path=/`, and
`Max-Age = PHONE_COOKIE_MAX_AGE_S` (exported constants). The cookie is a full credential for
REQ-005 routes (HTTP and WS upgrade) and is **bound to the current token generation**: its
validity is a pure function of the presented cookie value and the persisted `tokenHash`
(constant-time verification per REQ-005), so (a) it keeps working after a desktop app
restart/auto-update (only persisted state needed — CONV-065), and (b) regenerating the token
invalidates every outstanding cookie (REQ-006), with **no new secret persisted on the desktop**
(REQ-004). The cookie value MUST never appear in any URL, and being `HttpOnly` it is not readable
by page script. This closes the FINDING-025 contradiction: after the REQ-023 URL strip, every
token-less entry path — home-screen PWA relaunch from `start_url`, Safari reload, jetsam restore,
phone reboot — authenticates via the cookie.
**Acceptance:** `GET /?token=<valid>` responds with a `Set-Cookie` carrying `HttpOnly`,
`SameSite=Lax`, `Path=/`, and the constant Max-Age; a subsequent token-less `GET /` and a
token-less WS upgrade presenting only that cookie succeed; a fresh service instance loading only
persisted state accepts the same cookie (simulated restart); after regenerate the same cookie is
rejected with 401; the cookie value never appears in a `Location`/URL; a serialize-and-scan of
desktop-persisted state finds no cookie-related secret beyond the existing `tokenHash`.

### REQ-007 — QR pairing surface on the desktop
*(amended v2 — FINDING-045)* While the server is enabled, the desktop settings UI MUST offer
pairing: it shows the reachable URL(s) for the current bind mode and a QR code encoding a pairing
URL that includes the plaintext token. While the plaintext token remains available in session
memory (`tokenAvailableThisSession`), closing and reopening the settings surface MUST re-render
the QR **without regenerating** — pairing a second device an hour later never forces revoking the
first. Because the plaintext exists only in session memory (REQ-004), after an app restart the UI
MUST NOT claim to show a valid QR; it MUST instead offer "Regenerate" (with the disclosed
consequence: all paired devices must re-scan) — already-paired phones, which hold the REQ-028
cookie (and/or stored token), keep working across restarts without re-pairing (see REQ-024).
**Acceptance:** enabling + generating renders a QR whose decoded content is a URL containing the
pairing host:port and the plaintext token; unmount and remount the settings surface in the same
session ⇒ the QR is re-rendered from a re-fetch (e.g. `phoneRemote:pairingUrl`) without a second
regenerate; after a simulated restart (fresh service instance loading only persisted state), the
pairing surface offers regenerate and renders no stale QR; a paired client still authenticates
after the restart via its cookie.

### REQ-031 — Pairing must be reachable and copyable *(new in v2 — FINDING-039/044/045/006)*
The pairing URL MUST be pairable under every documented access story, not only LAN mode:
(a) the settings surface MUST render the pairing URL as selectable/copyable text alongside the QR
(so it can reach the phone via any channel); (b) the settings MUST accept an optional
**external host** override (`externalHost` in REQ-003's shape — a hostname, not a secret): when
set, the QR and pairing URL use it as the host (the `tailscale serve` hostname being the
motivating case), while the bind address is unaffected; (c) `status().urls` MUST enumerate ALL
candidate reachable URLs — in LAN mode every non-internal IPv4 address, ordered by a stated
deterministic ranking (RFC1918 class preference, name-sorted within a rank — never raw OS
enumeration order, CONV-025/CONV-063 class), with the QR host taken from the external-host
override when present, else the top-ranked candidate; (d) the feature doc's tailscale recipe MUST
include the explicit pairing step (REQ-027).
**Acceptance:** with `externalHost` set, the decoded QR/pairing URL uses that host and the
configured port; a copyable pairing-URL text node exists whenever the QR renders; a unit test
over a fake multi-adapter interface table asserts the full ranked URL list and that the ranking
is deterministic under permuted enumeration order; with no override in localhost bind, the UI
discloses that the QR is only phone-reachable via LAN mode or an external host.

## Mirrors & attach (scrollback)

### REQ-008 — Always-on bounded mirrors while enabled
*(amended v2 — FINDING-040)* While the server is enabled, every live pane whose bytes surface in
main — local PTY panes AND remote-workspace panes — MUST feed a per-pane bounded
`@xterm/headless` mirror created via the F18 `createPaneReplay` factory (`src/agent/replay.ts`),
sized to the pane's **actual current cols/rows** with bounded scrollback
(`HISTORY_LIMIT_DEFAULT` = 2000 lines, the tmux `history-limit` analog; the bound is stated here
and asserted by test per CONV-003). Remote-workspace panes MUST get grid parity with local panes:
their mirrors are constructed at the real grid reported by the remote spawn/adopt path, never a
hard-coded default (the v1 review found remote panes minted 80×24 mirrors — rejected). Mirrors
are created at server-enable (for existing panes) and at pane spawn (while enabled); a mirror is
disposed when its pane exits or when the server is disabled. Mirror history begins at enable time
(seeding from a renderer serialize is explicitly deferred).
**Acceptance:** with the server enabled, spawning a pane creates exactly one mirror; feeding it
output then attaching yields that output in the snapshot; disabling disposes all mirrors
(REQ-001); the mirror is constructed with the pane's current grid and the 2000-line scrollback
bound; a remote-workspace pane driven **through the real pty registrar routing** (not an injected
seam) gets a mirror at its true grid, with the same create/dispose discipline.

### REQ-009 — Attach is snapshot-then-stream, exactly-once, supersession-safe
*(amended v2 — FINDING-008)* A client subscribing to a pane MUST receive: (1) one snapshot
message containing the mirror's serialized state, then (2) the live pane-data stream, under a
hold-window ordering guarantee — no pane-data byte fed before the snapshot point is missing from
the snapshot, and no byte is delivered both in the snapshot and again as live data (exactly-once
reconstruction, riding `PaneReplay.snapshot()`'s write-flush barrier). This MUST hold under
interleaving: output arriving concurrently with the attach is either in the snapshot or in the
post-snapshot stream, never dropped, never duplicated (CONV-060). Attach supersession MUST be
**identity-guarded** (the repo's session-identity re-check pattern): a re-subscribe for a pane
whose attach is still in flight supersedes it — only the latest subscribe's snapshot+queue pair
completes the attach, and bytes fed between the two subscribes appear exactly once in the
reconstruction; a superseded snapshot resolution completes nothing.
**Acceptance:** a deterministic interleaving test feeds output before, during (between subscribe
and snapshot resolution), and after attach, and asserts the client's reconstructed byte sequence
(snapshot ⊕ stream) renders exactly the reference terminal's final state with no duplicated or
lost region; repeated with output racing the subscribe call; a supersession vector — subscribe,
feed C, subscribe again, feed D, resolve the FIRST snapshot first — asserts the reconstruction
contains both C and D exactly once.

## Transport & protocol

### REQ-010 — One multiplexed WS per client with a versioned JSON vocabulary — checked by BOTH ends
*(amended v2 — FINDING-021/037)* Each client uses exactly ONE WebSocket multiplexing all panes.
The message vocabulary is JSON: server→client at minimum `hello` (protocol version), `panes`
(inventory), `status`, `grid`, `snapshot`, `data`, `resync`, `paneExit`, `error`; client→server
at minimum `subscribe`, `unsubscribe`, `input`. `data`/`snapshot`/`resync` are pane-scoped.
Per-pane delivery order to one client MUST match main's observed pane-data order. The **client**
MUST compare `hello`'s protocol version against its bundled `PHONE_REMOTE_PROTO_VERSION`; on
mismatch it MUST stop processing messages and surface a "new version — reload" state (attempting
a reload of the served bundle) — a stale cached PWA never silently misparses newer traffic.
**Acceptance:** a protocol unit test drives one socket through inventory → subscribe(A) →
subscribe(B) → data on both → unsubscribe(A) and asserts pane-scoped routing, ordering per pane,
and that unsubscribed panes stop flowing; `hello` carries the exported protocol-version constant;
a client-core unit test: a `hello` with a different proto yields the reload state and suppresses
further message handling.

### REQ-011 — REAL workspace-grouped pane inventory with live status and current membership
*(amended v2 — ESC-001 decision; FINDING-011/017/022/027/038. The single-synthetic-workspace
stub is explicitly rejected.)* The server MUST expose a workspace-grouped pane inventory whose
fields are **real**: each entry carries the pane's actual workspace id and user-visible workspace
name (the same grouping the desktop shows), the pane id, a human-readable title (the label the
desktop pane chrome shows, with a shell/kind+index fallback — never the raw internal pane id),
kind, current cols/rows, and status sourced from the existing status engine. How the metadata is
threaded (main-owned workspace records and/or an additive renderer-fed metadata surface) is plan
detail, but the acceptance MUST hold through the production composition — not only an injected
test seam. The inventory includes local AND remote-workspace terminal panes; non-terminal panes
(editor, explorer, orky, notes) are not listed in v1. While clients are connected the inventory
MUST stay current: (a) status changes (`idle | busy | needs-input | exited`) are pushed; (b) a
pane spawned or removed while a client is connected re-pushes the inventory (or an equivalent
membership delta) so the phone's list reflects membership without reconnecting — a full `panes`
re-push is an acceptable mechanism (the client treats it as a list replace).
**Acceptance:** a composition-level test through the REAL wiring: with two workspaces with
distinct names and a mix of pane kinds (including a remote-workspace pane), the wire inventory
groups the terminal panes under their true workspace names with human-readable titles and true
cols/rows; a status flip in main (e.g. busy→idle) produces a `status` push observed by an
attached client without re-requesting inventory; a pane spawned while a client is connected
appears to that client via a push (and an exited pane leaves the list when it leaves main's pane
set) without reconnecting.

### REQ-012 — Input injection
An authenticated client's `input` message for a subscribed, live pane MUST be written to that
pane's input path — `PtyManager.write` for local panes, the remote-workspace write equivalent for
remote panes — byte-faithfully (UTF-8 text as sent, including control bytes from the key bar).
`input` for an unknown or exited pane MUST yield a specific `error` message (CONV-001) and MUST
NOT throw or crash the connection.
**Acceptance:** an input round-trip test sends `input` and observes the bytes at the pane write
seam unmodified; input to a bogus pane id returns an `error` naming the pane id and the reason,
and the socket stays usable.

### REQ-013 — The phone never resizes; grid follows the desktop — for local AND remote panes
*(amended v2 — FINDING-016/031/040; ESC-001 decision)* No server code path reachable from a
client message may invoke a PTY resize, and the protocol MUST NOT contain a resize request. The
client renders each pane at the pane's current cols/rows (pinch-zoom/pan for fit): on pane select
(and on reconnect re-attach) the client MUST size its terminal from the freshest known grid — the
inventory row's cols/rows or the latest `grid` push — **before** the snapshot is applied, so a
non-80×24 pane never renders mis-wrapped. When the desktop resizes a pane — local **or
remote-workspace** — the server MUST resize that pane's mirror (`PaneReplay.resize`) and push a
`grid` message so attached clients re-render at the new dimensions — still without any
client-originated resize. Remote-workspace panes MUST have grid-push parity with local panes
through the real pty routing.
**Acceptance:** a structural/unit test asserts the client-message dispatch table contains no path
to `PtyManager.resize` (or the remote resize seam); a desktop-side grid change on a local AND on
a remote-owned pane (driven through the real registrar routing) each produce a `grid` push with
the new cols/rows and the mirror reports the new size; a client test taps a 120×30 pane and
asserts the xterm grid is 120×30 before snapshot application; fuzzing arbitrary client messages
never reaches a resize seam.

### REQ-014 — No pane lifecycle actions
The protocol MUST expose no pane lifecycle capability: no kill/spawn/close/rearrange/split, no
workspace mutation, no filesystem or editor access. The server's writable surface is exactly
`input` (REQ-012); everything else is read-only.
**Acceptance:** a table-driven test enumerates the accepted client message types and asserts the
set is exactly `{subscribe, unsubscribe, input}` (plus any pure keepalive); unknown types get the
REQ-018 error treatment.

### REQ-015 — The desktop renderer path is byte-identical
*(acceptance amended v2 — the e2e half is mandatory, FINDING-013/023)* The fan-out MUST be
additive at main's existing pane-data surfaces: with the feature disabled AND with it enabled
(clients attached or not), the bytes, ordering, and timing semantics of the existing renderer
forward (`pty:data` IPC), the status engine feed, recording, and search indexing are unchanged.
Backpressure from a slow client (REQ-017) MUST never block or delay the renderer path.
**Acceptance:** a unit test on the fan-out seam asserts the renderer-forward callback receives
the identical chunk sequence with and without an attached subscriber; a **required** Playwright
e2e (riding the REQ-025 seam) drives a pane with the server enabled + a live client attached and
asserts the desktop terminal renders exactly as the server-off baseline.

### REQ-016 — Concurrent clients coexist without exclusivity
Multiple simultaneously connected clients MUST be supported, each with independent subscriptions
and independent backpressure state; there is NO attach lease and no steal semantics (D7 — the
phone mirrors, it never steals; the F20 exclusive lease is deliberately not reused). Input from
any authenticated client is accepted; the desktop is never displaced (CONV-064: this shared-state
concurrency granularity is stated and tested, not implied).
**Acceptance:** two clients subscribe to the same pane and both receive the full stream; one
client's slow-consumer state (REQ-017) does not degrade the other's delivery; both may send input;
disconnecting one leaves the other and the desktop unaffected.

### REQ-017 — Backpressure: bounded for ALL traffic, real drain trigger, exactly-once resync
*(amended v2 — FINDING-001/002/009/015/019/020/029/030; ESC-001 decision)* Per-client buffering
MUST be bounded by exported named constants (`PHONE_WS_HIGH_WATER = 1 MiB` of socket-buffered
bytes, `PHONE_WS_LOW_WATER = 256 KiB`), and the bound MUST cover **every message class**, not
only pane `data`:
- **Data:** when a client's buffered amount exceeds the high-water mark, the server stops
  enqueueing pane `data` for that client and marks its subscribed panes stale; when the buffer
  drains below the low-water mark, each stale pane is re-synced with a `resync` message carrying
  a fresh mirror snapshot that REPLACES the client's buffer for that pane.
- **Real trigger (CONV-036):** the drain signal MUST be an actually-occurring transport signal —
  e.g. the `ws.send` completion callback sampling `bufferedAmount`, or an armed timer that runs
  only while any pane is stale — never a listener on an event the transport does not emit (the
  `ws` library's `WebSocket` has no `'drain'` event). A gone-quiet stream can never strand a
  stale pane un-resynced.
- **Resync exactly-once (CONV-060):** the resync path MUST reuse the attach hold-window
  discipline: pane data arriving between the drain trigger and the resync snapshot's resolution
  is queued behind the resync, never sent ahead of it, so the client's replace-then-append
  reconstructs exactly the mirror state plus post-barrier bytes — no delivered byte is erased by
  the buffer replacement.
- **Status/grid:** `status` and `grid` pushes to a saturated client MUST be coalesced
  latest-wins per pane and delivered on drain, never accumulated unboundedly.
- **Stale-state lifecycle:** a pane's stale flag is cleared by `unsubscribe`, `paneExit`, and a
  fresh `subscribe` (the attach snapshot IS the resync); a drain never resyncs a pane no longer
  subscribed/live.
- **Ceiling + keepalive:** a connection whose buffered amount stays above the high-water mark
  continuously for `PHONE_WS_STALL_TIMEOUT_MS` MUST be terminated (lossless by REQ-024's fresh
  reconnect attach), and the server MUST run WS ping/pong keepalive (`PHONE_WS_PING_INTERVAL_MS`,
  `PHONE_WS_PONG_TIMEOUT_MS`) terminating unresponsive sockets, so a half-open sleeping phone
  cannot hold unbounded memory or an immortal session.
No unbounded queue may exist (CONV-003: all limits are stated here, exported, and asserted by
test).
**Acceptance:** a pure queue-policy unit test drives the policy over the thresholds and asserts:
above high water no data is enqueued, panes are marked stale, below low water exactly one resync
per stale pane is emitted even if the pane's stream went quiet before the drain; an interleaved
vector feeds output between the drain signal and the resync resolution and asserts the
reference-terminal reconstruction (no erased bytes); stale-then-unsubscribe-then-drain emits no
resync, and stale-then-resubscribe delivers post-snapshot chunks as data; a **real-transport**
integration/e2e test saturates a live ws connection past high water and observes a resync arrive
with NO test code invoking the drain seam directly; a saturated socket receiving N status flips
never exceeds the bound (latest-wins observed on drain); a peer that stops answering pings is
terminated within the deadline; the constants are exported and equal the stated values; the
client applies `resync` as a buffer replacement (reset + snapshot), not an append.

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

### REQ-022 — iOS home-screen PWA installability — relaunch stays authenticated
*(amended v2 — FINDING-025)* The client MUST be installable to the iPhone home screen: it serves
a web app manifest and the iOS-specific tags (`apple-mobile-web-app-capable`,
`apple-touch-icon`, viewport configured for a full-screen terminal with `viewport-fit=cover`),
and runs standalone from the home screen. These install assets are the REQ-005 unauthenticated
allowlist. The manifest `start_url` carries no token; a standalone relaunch from the home screen
authenticates via the REQ-028 session cookie. The viewport meta MUST NOT disable user scaling
(`user-scalable=no` / `maximum-scale=1` are forbidden — pinch-zoom is the spec's only fit
mechanism, REQ-013).
**Acceptance:** the served shell contains the manifest link, apple meta tags, and touch icon;
the manifest parses with `display: standalone` (or `fullscreen`) and a token-free start URL;
icons and manifest are fetchable per REQ-005's allowlist rules; a load of `start_url` presenting
only the session cookie returns the authenticated shell (the FINDING-025 relaunch vector); the
viewport meta contains neither `user-scalable=no` nor a `maximum-scale` that blocks zoom.

### REQ-023 — Phone UI: pane list, terminal view, accessory key bar
*(amended v2 — ESC-001 decision; FINDING-016/031/033/003/028/051)* The client UI is v1-scoped
to: (a) a workspace-grouped pane list rendering each pane's live status chip (busy / idle /
needs-input / exited, driven by REQ-011 pushes, membership kept current per REQ-011); (b) tap →
a full-screen xterm.js terminal for that pane, sized from the inventory's cols/rows before the
snapshot renders (REQ-013) with pinch-zoom/pan; (c) an accessory key bar with at least Ctrl
(modifier-latch), Esc, Tab, and arrow keys, emitting the correct byte sequences (`\x1b`, `\t`,
`\x1b[A`–`\x1b[D`, Ctrl+letter → `0x01`–`0x1a`). The Ctrl latch MUST compose with
**soft-keyboard input**: with the latch armed, the next typed letter (via `term.onData`) is
transformed to its control byte and the latch clears — Ctrl+C MUST be producible by tapping Ctrl
then typing `c` on the iOS keyboard. The key→bytes mapping MUST be a pure, unit-testable module,
and typed input MUST route through the latch. Subscription hygiene: the client keeps at most the
active pane subscribed — switching panes or returning to the list sends `unsubscribe` for the
departing pane (reconnect re-attaches at most the active pane). On first load from a pairing URL
the client authenticates (setting the REQ-028 cookie), immediately strips the token from the
visible URL (`history.replaceState`) so it does not linger in browser history, and MUST NOT
persist the plaintext token in script-readable storage (the HttpOnly cookie is the durable
client credential).
**Acceptance:** unit tests on the key-bar mapping cover each listed key and the Ctrl latch
(including Ctrl+C → `\x03`) and malformed/no-op cases; a **required** DOM-level e2e against the
SERVED client shows list → terminal navigation, that key-bar taps produce `input` messages with
the mapped bytes, and that tapping Ctrl then typing `c` emits `input` with `\x03`; after load
with `?token=`, the address no longer contains the token, the session remains authenticated, and
script-readable storage contains no plaintext token; switching pane A → pane B emits
`unsubscribe{A}`.

### REQ-030 — The client RENDERS errors and in-view exit state *(new in v2 — FINDING-035/050/048)*
Server `error` frames MUST be rendered to the phone user (a visible status strip/banner naming
the reason — CONV-001's surfacing half), never silently discarded. When the actively viewed
pane exits, the terminal view itself MUST show an in-view "process exited" indication and stop
accepting input for it (the hidden list's chip is not sufficient). An empty pane inventory MUST
render a guidance message (e.g. "open a terminal in Termhalla to see it here"), not a blank
screen.
**Acceptance:** a DOM-level test sends `input` to an exited pane and asserts the server's error
message becomes visible in the client; a `paneExit` for the active pane renders the in-view
notice and disables input; an empty inventory renders the guidance text.

## Sessions, exit, and reconnection

### REQ-026 — Pane exit is pushed; the mirror ends with the pane
When a subscribed pane exits, attached clients MUST receive a `paneExit` (and terminal `status`
of `exited`); subsequent `input` for it gets the REQ-012 error. The pane's mirror is disposed on
pane exit (final output already delivered flows through the normal stream); an exited pane
disappears from the inventory when it leaves main's pane set (membership push per REQ-011).
**Acceptance:** killing a pane's process with a client attached yields the exit push, the mirror
is disposed (no leak — mirror count returns to the live-pane count), and input afterward returns
the specific error.

### REQ-024 — Reconnection: fresh attach, cookie-backed pairing, honest failure states
*(amended v2 — ESC-001 decision; FINDING-025/026/036)* A dropped WS (network blip, phone sleep,
app restart) requires no re-pairing: the client retries — its durable credential is the REQ-028
session cookie (sent automatically on the same-origin upgrade) — and each successful reconnect
performs fresh REQ-009 attach semantics per subscribed pane (snapshot replaces the client's
buffer — the client MUST NOT assume stream continuity across connections). Reconnect attempts
MUST use capped exponential backoff, and the client MUST distinguish **auth rejection from
transient failure**: repeated immediate auth-refused attempts (e.g. probed via a cheap
authenticated fetch) transition to a terminal "pairing revoked — scan the new QR code" state
instead of retrying forever, while transient network failures keep retrying with backoff.
Because the server lives in-process (no daemon), an app auto-update restart behaves exactly like
any restart: the persisted `tokenHash` keeps the paired phone's cookie valid with zero user
action (CONV-065: the close → update → reopen lifecycle is the analyzed default, and it degrades
to nothing worse than a reconnect; pane history restarts at the new session's enable point per
REQ-008 — an accepted, documented limit, not silent loss).
**Acceptance:** kill and re-establish a client's WS mid-stream: the reconnect attach renders the
pane correctly from snapshot ⊕ new stream with no duplicated region; a fresh server instance
loading only persisted state accepts the previously issued cookie; after a desktop regenerate,
the client reaches the terminal re-pair state (no infinite silent retry loop) within a bounded
number of attempts; transient-failure retries observe increasing (capped) delays; the
history-restart limit is stated in the feature doc (REQ-027).

## Desktop control surface

### REQ-029 — The settings surface is actually mounted, reachable, and stateful *(new in v2 — FINDING-010/024/043/046)*
The phone-remote settings/pairing surface MUST be reachable by a real user through the app's
Settings UI: a phone-remote section registered in the Settings panel's section list, rendering
the enable toggle, bind toggle (+ LAN warning, REQ-002), port field, pairing surface
(REQ-007/REQ-031), and a live status line derived from `status()` — showing running-on-port when
running, and the specific last error plus a not-running cue whenever `enabled` is true but
`running` is false. Invalid port entry MUST surface a specific validation message (allowed range
1–65535; CONV-001), never a silent discard. Reachability MUST be pinned by a test exercising the
REAL mount/navigation path (component render of the Settings panel or e2e: open Settings, select
the section) — never only a source-scan of the isolated component file (an unmounted component
satisfies every source-scan).
**Acceptance:** a mount-path test opens the real Settings panel, selects the phone-remote
section, and asserts the surface renders (and, flipping LAN, that the warning is visible); with
`enabled: true` and a stopped/errored server the section shows the not-running cue and the error
text from `status()`; an out-of-range port entry shows the validation message and reverts to the
active port.

### REQ-032 — phoneRemote IPC is sender-gated *(new in v2 — FINDING-047)*
Every `phoneRemote:*` IPC handler (all write-capable, and `regenerateToken` returns the
plaintext pairing token) MUST reject senders that are not currently-tracked app windows
(`WindowManager.isKnownWindowSender`), mirroring the repo's established gating for privileged /
secret-bearing registrars (register-orky-action / register-registry / register-remote
precedent), before any handler logic runs.
**Acceptance:** a unit/structural test (analogous to `tests/main/orky-ipc-validation.test.ts`)
asserts an unknown sender is rejected before `regenerateToken`/`setEnabled`/`setBind`/`setPort`
execute, and a known-window sender passes.

## Testing & docs discipline

### REQ-025 — e2e seam: one env-gated module with a structural guard — and it is consumed
*(amended v2 — FINDING-012)* Any test-only server behavior (fixed port, injected token,
deterministic timers) MUST ride a single env-gated seam module in `src/main` (the
`e2e-presentation.ts` / `e2e-remote.ts` discipline): exactly ONE module reads the env var
(proposed `TERMHALLA_E2E_PHONE_REMOTE`), a structural test forbids the variable name anywhere
else under `src/main`, and with the variable unset, production behavior is byte-identical. The
structural guard's scan MUST key on the feature-specific variable name (CONV-037) and be
anchored (CONV-032). The seam MUST be wired into the production service construction path (so
setting the var actually affects the real server) and MUST be consumed by this feature's
Playwright e2e specs (REQ-015/REQ-017/REQ-019/REQ-023) — a decorative unconsumed seam is
non-conforming.
**Acceptance:** the structural test enumerates `src/main` sources and fails on any occurrence of
the env var outside the seam module; the seam's exports are inert (identity/defaults) when the
var is unset; the feature's e2e specs launch the app with the var set and successfully reach the
server on the seam-fixed port/token (proving consumption).

### REQ-027 — Documentation ships with the feature
*(amended v2)* `docs/features/phone-web-remote.md` MUST exist and document: the security posture
(off by default, localhost default, LAN warning, single hashed token, regenerate-revokes-all
**including session cookies**), the HttpOnly-cookie pairing/relaunch model (REQ-028), the
`tailscale serve` anywhere-access recipe **including its explicit pairing step** (external host /
copyable URL, REQ-031), the no-cloud-relay stance, the history-begins-at-enable and
history-restarts-on-app-restart limits (REQ-008/REQ-024), and the deferred follow-ons (Web
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
  externalHost?: string   // optional phone-reachable host override for the pairing URL/QR (REQ-031); not a secret
}
```

### Desktop IPC (extends `src/shared/ipc-contract.ts`, `domain:verb` — baseline REQ-002)
Indicative set (exact channel names are plan detail; all go through the contract + preload, and
ALL handlers are known-window sender-gated per REQ-032):
- `phoneRemote:status` (invoke) → `{ enabled, bind, port, running, error?, urls: string[], hasToken, tokenAvailableThisSession, externalHost? }`
- `phoneRemote:setEnabled` / `phoneRemote:setBind` / `phoneRemote:setPort` / `phoneRemote:setExternalHost` (invoke)
- `phoneRemote:regenerateToken` (invoke) → `{ pairingUrl }` (contains the plaintext token; renderer renders the QR and never persists it)
- `phoneRemote:pairingUrl` (invoke) → `{ pairingUrl } | { unavailable: true }` — re-fetch while `tokenAvailableThisSession` (REQ-007), so reopening Settings never forces a revoking regenerate
- `phoneRemote:changed` (main→renderer push) + an app-wide error push consumed at the root (REQ-020)

### HTTP auth surface (REQ-005/REQ-028)
- Credentials: `?token=` / `X-Termhalla-Token` header, or the `PHONE_COOKIE_NAME` session cookie
  (`HttpOnly; SameSite=Lax; Path=/; Max-Age=PHONE_COOKIE_MAX_AGE_S`), set on the first
  token-authenticated response; both verified constant-time against the persisted `tokenHash`.
- Unauthenticated allowlist: PWA manifest + icons only (secret-free, state-independent).

### WS protocol (REQ-010 vocabulary)
- server→client: `hello{proto}`, `panes{workspaces[]}`, `status{paneId,status}`,
  `grid{paneId,cols,rows}`, `snapshot{paneId,data}`, `data{paneId,data}`,
  `resync{paneId,data}` (buffer-replacing, hold-window-ordered per REQ-017), `paneExit{paneId,…}`,
  `error{code,message}`
- client→server: `subscribe{paneId}`, `unsubscribe{paneId}`, `input{paneId,data}` (+ transport
  ping/pong keepalive per REQ-017)
- Exact JSON field shapes are plan detail; the message-type sets above are normative
  (REQ-014 pins the client→server set closed).

### Exported constants (each pinned by test — CONV-003)
`PHONE_REMOTE_PORT_DEFAULT = 8199`, `PHONE_WS_HIGH_WATER = 1_048_576`,
`PHONE_WS_LOW_WATER = 262_144`, `PHONE_WS_MAX_FRAME = 1_048_576`,
`PHONE_WS_STALL_TIMEOUT_MS = 60_000`, `PHONE_WS_PING_INTERVAL_MS = 30_000`,
`PHONE_WS_PONG_TIMEOUT_MS = 10_000`, `PHONE_COOKIE_NAME = 'termhalla-phone'`,
`PHONE_COOKIE_MAX_AGE_S = 34_560_000` (400 days), `PHONE_REMOTE_PROTO_VERSION`;
mirror scrollback reuses `HISTORY_LIMIT_DEFAULT` (2000) from `src/agent/replay.ts`.

## Out of scope (recorded, deferred per concept)
needs-you Web Push; native iOS client; per-device grants / read-only tier; built-in TLS;
renderer-serialize mirror seeding at enable; utility action buttons / run-commands on phone;
Orky needs-you tab on phone; non-terminal pane kinds in the inventory. NOTE (v2): the
single-synthetic-workspace inventory is NOT a deferred item — it was reviewed and rejected
(ESC-001); REQ-011's real grouping is in scope.

## Open questions
None blocking. All brainstorm forks were resolved in `01-concept.md` (D1–D11); the v2 amendments
encode the ESC-001 human decisions (HttpOnly session cookie, real workspace-grouped inventory,
mandated e2e coverage) and the reviewer-identified spec-origin gaps
(FINDING-002/009/019/021/022/035/036/037/038/039/043/044/045/049/050) as testable requirements.
