# Phone web remote (feature 0026)

An opt-in HTTP+WebSocket remote-access server embedded in the Electron main process, plus a
packaged, mobile-first static web client (xterm.js, iPhone-Safari PWA), that lets a phone read and
type into every Termhalla pane — a passive mirror + input injector that never resizes, never
manages pane lifecycle, and never perturbs the desktop renderer path (REQ-015).

## Security posture

- **Off by default.** With default settings (or any malformed/absent persisted setting) no TCP
  listener exists, no headless mirror instances exist, and the pane-data path costs one
  constant-time enabled check (`src/main/phone-remote/mirror-manager.ts`).
- **`127.0.0.1` (localhost) is the default bind.** LAN mode (`0.0.0.0`) is a SEPARATE, explicit
  toggle — enabling the feature never implies LAN. The desktop Settings UI shows a plaintext,
  unencrypted-transport warning whenever LAN mode is selected (there is no built-in TLS in v1); LAN
  mode means anyone on the local network can observe pane contents and keystrokes in flight.
- **Anywhere access without LAN/TLS: `tailscale serve`.** The documented recipe for reaching your
  panes from off-network is to run `tailscale serve https / http://127.0.0.1:8199` (or your
  configured port) against the LOCALHOST bind — Tailscale terminates TLS and tunnels over your
  private tailnet. There is intentionally **no cloud relay** and no built-in TLS in v1; all traffic
  either stays on localhost, stays on your LAN (with the plaintext warning), or rides your own
  Tailscale/VPN tunnel.
  - **The explicit pairing step:** because the phone reaches your desktop at the TAILSCALE
    origin — HTTPS on the tailnet hostname (normally port 443), reverse-proxied by `tailscale
    serve` to your localhost backend port — set the **external host** field in the phone-remote
    Settings section to that FULL origin (e.g. `https://my-machine.tailXXXX.ts.net`, exactly what
    `tailscale serve` prints) BEFORE scanning. The QR code and the copyable pairing URL are then
    built from that origin VERBATIM — https preserved, the backend port never appended — so the
    pairing link actually rides the proxy instead of pointing `http://<host>:<backend port>` at a
    listener the proxy fronts. (A bare hostname in the field keeps the plain-http +
    configured-port form, for proxies/DNS names that forward the port unchanged.) The bind mode
    itself stays `localhost`; only the ADVERTISED origin changes. `status().urls` also lists
    every other reachable candidate (deterministically ranked) for LAN-mode pairing without
    `tailscale serve`.
- **Single hashed pairing token.** The token is generated in main from a CSPRNG (`crypto.
  randomBytes(32)`, base64url, 256 bits of entropy). Only its sha-256 hash is ever persisted
  (`quick.json`'s `phoneRemote.tokenHash`) — the plaintext exists in main-process memory only, for
  the current app session. Every data-bearing HTTP request and every WS upgrade must present the
  token (query param `token` or the `X-Termhalla-Token` header) and is verified with a
  constant-time comparison (`crypto.timingSafeEqual`); a small fixed allowlist (the PWA manifest +
  icons — no user or pane data) is served unauthenticated so the phone can install to the home
  screen before pairing.
- **Regenerate revokes everything — including session cookies.** Regenerating the token atomically
  replaces the stored hash, invalidates the old token for all future requests, invalidates every
  outstanding session cookie (see below — a cookie's validity is a pure function of the CURRENT
  hash, so changing the hash revokes it for free, no cookie registry to maintain), and immediately
  closes every currently connected WS client — there is exactly one token (single-grant model in v1).

### HttpOnly session cookie (REQ-028) — pairing survives every entry path

The first token-authenticated HTTP response (`GET /?token=...`) sets an **HttpOnly** session
cookie (`SameSite=Lax`, `Path=/`, a 400-day `Max-Age`). The cookie is a full credential for every
authenticated route (HTTP and the WS upgrade) and is bound to the current token generation — its
validity is a pure function of the presented value and the persisted `tokenHash`, so it keeps
working after a desktop app restart/auto-update (only persisted state is needed) and dies the
instant Regenerate runs (see above). This closes the pairing/relaunch gap the v1 review found:
after the pairing URL's token is stripped from the visible address (`history.replaceState`), every
later entry path — an iOS home-screen PWA relaunch from `start_url`, a Safari reload, a jetsam
restore, a phone reboot — is token-less, and the cookie (not the URL, not any script-readable
storage) is what keeps the session authenticated. The cookie value never appears in a URL and is
never readable by page script.

## History limits (accepted, documented — REQ-008/REQ-024)

- **History begins at enable.** A pane's mirror (`@xterm/headless`, `HISTORY_LIMIT_DEFAULT` = 2000
  scrollback lines, the tmux `history-limit` analog) is created when the server is enabled (for
  already-live panes) or when a pane spawns while enabled; it does NOT seed from anything the
  desktop renderer already scrolled back before that point. Seeding a mirror from a renderer
  serialize snapshot is an explicitly deferred follow-on.
- **History restarts on app restart.** The server lives in-process (no daemon); an app close/reopen
  (including an auto-update restart) starts a fresh session, so pane mirror history restarts at
  the new session's enable point. A dropped WS (network blip, phone sleep, app restart) needs no
  re-pairing — the client retries with its stored token and performs a fresh snapshot-then-stream
  attach per subscribed pane on every reconnect; it never assumes stream continuity across
  connections.

## Architecture

| Concern | Path |
|---|---|
| Settings shape (`quick.json`, additive optional) | `src/shared/phone-remote/settings.ts` |
| Pairing token (generate/hash/verify) | `src/main/phone-remote/token.ts` |
| HTTP+WS listener lifecycle (unref'd, whole-lifetime `error` handler) | `src/main/phone-remote/server.ts` |
| Auth gate (query/header token, allowlist) | `src/main/phone-remote/auth.ts`, `src/main/phone-remote/static-assets.ts` |
| Per-pane mirror registry (the F18 `createPaneReplay` fan-out seam) | `src/main/phone-remote/mirror-manager.ts` |
| Backpressure (bounded queue, drop-and-resnapshot) | `src/main/phone-remote/backpressure.ts`, `src/main/phone-remote/constants.ts` |
| Per-client WS session (attach, input, no-resize enforcement) | `src/main/phone-remote/ws-session.ts` |
| Composition (settings <-> server <-> mirrors <-> sessions) | `src/main/phone-remote/service.ts` |
| WS wire protocol (shared, Electron-free) | `src/shared/phone-remote/protocol.ts` |
| Desktop IPC + Settings UI | `src/main/ipc/register-phone-remote.ts`, `src/renderer/components/PhoneRemoteSettings.tsx`, `src/renderer/store/phone-remote-slice.ts` |
| e2e seam (`TERMHALLA_E2E_PHONE_REMOTE`) | `src/main/e2e-phone-remote.ts` |
| Phone web client (built by a third vite target into `out/phone-client`) | `src/phone-client/`, `vite.phone-client.config.ts` |

### Backpressure

Per-client buffering is bounded by exported constants: `PHONE_WS_HIGH_WATER` (1 MiB of
socket-buffered bytes) and `PHONE_WS_LOW_WATER` (256 KiB). Above the high-water mark the server
stops enqueueing `data` for that client's stale panes; when the buffer drains below the low-water
mark, each stale pane is resynced with a fresh mirror snapshot that REPLACES the client's buffer —
driven by the transport's own drain event, never a lazily re-checked future chunk, so a stream that
goes quiet mid-backpressure can never strand a pane un-resynced.

### The phone never resizes

No client message can reach a PTY resize (structurally: `WsSessionDeps` exposes no resize
capability, and no `src/main/phone-remote/*` source references `PtyManager`/`ptyResize`). The
client renders each pane at its current cols/rows and relies on pinch-zoom/pan for fit; when the
desktop resizes a pane, the mirror is resized and a `grid` push updates every attached client.

## Deferred follow-ons (out of scope for v1)

- Web Push notifications for needs-you state (the phone stays a pull/live-stream client only).
- A native iOS client (the v1 client is a Safari PWA, home-screen installable).
- Per-device pairing grants and a read-only access tier (v1 is a single, full-access shared token).
- Built-in TLS (the `tailscale serve` recipe above is the anywhere-access story instead).
- Renderer-serialize mirror seeding at enable (history begins at enable, not at the desktop's
  current scrollback).
