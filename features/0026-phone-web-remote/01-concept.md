# 0026-phone-web-remote — Concept (phase 1 outcome)

- **Brainstormed:** 2026-07-18 (interactive, four forks put to the human via structured questions;
  all four landed on the recommended option)
- **Status:** confirmed pending final human sign-off recorded at the brainstorm gate

## Concept in one paragraph

An opt-in remote-access server in the Electron main process (HTTP + WebSocket) plus a
mobile-friendly static web client (xterm.js, iPhone-Safari-first, home-screen PWA), letting the
user read and type into every Termhalla pane from a phone. The phone is a **passive mirror plus
input injector** — it never resizes, never manages pane lifecycle, and never disturbs the desktop
renderer path. Scrollback-on-attach comes from always-on main-side `@xterm/headless` mirrors
(direct F18 `createPaneReplay` reuse) active while the server is enabled. Security is
local-first: off by default, localhost bind by default (pairs with `tailscale serve` for
encrypted anywhere-access), explicit LAN toggle, single hashed pairing token surfaced as a QR
code.

## Decisions

- **D1 — Scrollback: always-on headless mirrors while the server is enabled.** Every pane feeds a
  bounded `@xterm/headless` mirror in main (F18 `createPaneReplay` reuse, `HISTORY_LIMIT_DEFAULT`
  2000-line analog); phone attach = serialize(mirror) → live stream, with an F18-style
  hold-window so no `pty:data` crosses the snapshot (exactly-once reconstruction). *Why:*
  deterministic, renderer-independent attach with zero IPC on the attach path, riding a proven
  ordering discipline. *Accepted trade-offs:* steady-state mirror feed cost (only while the
  opt-in server is enabled); history begins at server-enable time. *Rejected:*
  snapshot-on-attach from the owning renderer (couples attach to renderer responsiveness and to
  pane-transit routing gaps — a documented pain area); live-only. Seeding mirrors from a one-shot
  renderer serialize at enable time is a **deferred enhancement**, not v1.
- **D2 — Exposure: default bind `127.0.0.1`; explicit settings toggle for LAN (`0.0.0.0`).**
  Anywhere-access + TLS story is documented as `tailscale serve` proxying to the localhost bind —
  no cloud relay, no built-in TLS in v1. LAN mode is plaintext, mitigated by token auth, and is
  opt-in behind its own toggle. *Why:* both access stories work day one; the risky one requires a
  deliberate act; TLS stays Tailscale's problem.
- **D3 — Auth: single high-entropy pairing token, stored hashed only.** Desktop settings shows a
  QR encoding URL + token; the phone persists it client-side. "Regenerate" revokes every paired
  device at once. Every HTTP/WS session must present the token; the server compares against the
  hash (constant-time; presentation mechanics — query/cookie/header — are spec detail). *Why:*
  minimal UI, fits the no-secrets-persisted posture, one-user app. Per-device grants and a
  read-only grant tier are **deferred**.
- **D4 — Phone scope v1: pane list + single-pane terminal, read/type only.** Workspace-grouped
  pane list with live status chips (busy/idle/needs-input/exited), tap → full-screen terminal
  with an accessory key bar (Ctrl, Esc, Tab, arrows). Input goes to `PtyManager.write` (and the
  remote-workspace equivalent). **No** pane lifecycle actions (kill/spawn/rearrange), **no**
  resize ever — the phone renders at the pane's current cols/rows with pinch-zoom/pan (guards the
  ConPTY repaint / status-tail-eviction / busy-flip cascade). Utility action buttons and an Orky
  needs-you tab are **deferred**.
- **D5 — Transport: one WebSocket per client, multiplexing all panes.** JSON control channel
  (pane inventory, status pushes, subscribe/unsubscribe) + pane-scoped data messages. Attach
  semantics per D1. *Why:* one connection is battery/socket-friendly on iOS and makes ordering
  per client trivial.
- **D6 — Fan-out point is main, alongside the renderer forward.** `PtyManager.onData` (and the
  remote-workspace data path) feeds the mirror + any subscribed clients in addition to the
  existing renderer IPC — the desktop renderer path is byte-identical when the feature is off
  AND when it is on. Remote-workspace panes are included wherever their bytes surface in main
  (desktop as hub).
- **D7 — The phone mirrors; it never steals.** No reuse of the F15 wire protocol or the F20
  exclusive attach lease (that lease is deliberately single-holder; the phone must coexist with
  the desktop view). Only pure pieces (replay; concepts from the F17 flow gate) are reused.
- **D8 — Lifecycle + e2e discipline.** The server and every accepted socket are abortable and
  `unref()`'d; stop is wired to app shutdown so `app.close()` / the e2e suite never hang
  (established repo pattern). Any e2e-only behavior rides a single env-gated seam module with a
  structural test forbidding the env var elsewhere (the `e2e-presentation.ts` /
  `e2e-remote.ts` discipline).
- **D9 — Web client assets: a third vite build target** (sibling of `vite.agent.config.ts`)
  emitting a self-contained static bundle into `out/`, served by the embedded server and packaged
  into the installer. No CDN, no runtime downloads.
- **D10 — Settings live in `quick.json`** (quick-store): enabled flag, bind mode, port, token
  hash. Additive optional fields; expected **no** `SCHEMA_VERSION` bump (spec must confirm
  against the store's migration rules).
- **D11 — Backpressure direction: bounded per-client queueing with drop-and-resnapshot.** The
  server watches per-socket buffered amount; when a slow phone falls too far behind on a pane,
  queued data for that pane is dropped and the pane is re-synced from a fresh mirror snapshot.
  *Why:* a browser client has no ack protocol; resnapshot beats unbounded buffering, and the
  mirror (D1) makes resync cheap. Exact thresholds/mechanics are spec detail.

## Concerns (review-routing tags)

`security` (network listener + auth in the privileged main process, LAN exposure mode),
`networking` (WS transport, multiplexing, backpressure, bind modes),
`performance` (always-on mirrors on the hot pty:data path, fan-out cost),
`determinism` (snapshot⊕stream exactly-once ordering, resync semantics).

## Open questions

| # | Question | Status | Outcome |
|---|---|---|---|
| 1 | Scrollback-on-attach strategy | **resolved** | D1 — always-on mirrors while enabled |
| 2 | Network exposure modes for v1 | **resolved** | D2 — localhost default + explicit LAN toggle; tailscale serve documented |
| 3 | Pairing/auth model | **resolved** | D3 — single hashed token + QR; regenerate revokes all |
| 4 | Phone UI scope v1 | **resolved** | D4 — pane list + single-pane read/type terminal only |
| 5 | WS connection model | **resolved** | D5 — one multiplexed WS per client |
| 6 | Web client asset pipeline | **resolved** | D9 — third vite target, packaged static bundle |
| 7 | Settings persistence home | **resolved** | D10 — quick.json additive fields (spec confirms no version bump) |
| 8 | Backpressure toward a slow phone | **resolved** (direction) | D11 — bounded queue + drop-and-resnapshot; thresholds in spec |
| 9 | e2e strategy for the server | **resolved** | D8 — env-gated seam + structural test |
| 10 | Seed mirrors from renderer serialize at enable time | **deferred** | enhancement on top of D1 |
| 11 | Per-device grants / read-only grant tier | **deferred** | D3 is single-token v1 |
| 12 | Built-in TLS (self-signed) for LAN mode | **deferred** | tailscale serve covers encrypted access |
| 13 | Utility actions (paste/clear/Ctrl-C buttons, run-commands) on phone | **deferred** | follow-on |
| 14 | Orky needs-you queue tab on phone | **deferred** | follow-on, pairs with Web Push |
| 15 | needs-you Web Push notifications | **deferred** | explicit follow-on feature |
| 16 | Native iOS client | **deferred** | explicit follow-on feature |

No **blocking** open questions remain.
