# 0026-phone-web-remote — Intake

- **Feature id:** 0026
- **Slug:** phone-web-remote
- **Captured:** 2026-07-18
- **Phase:** intake → awaiting brainstorm (phase 1, interactive)
- **Origin:** Option A of a remote-capabilities options discussion (embedded web remote), chosen
  over: (B) a WebSocket binding of the F15 wire protocol, (C) tmux + iPhone ssh client, (D) a
  native iOS app, (E) a cloud relay. See "Context from the options discussion" below.

## Idea (raw, verbatim)

Phone remote for Termhalla — an opt-in HTTP+WebSocket server in the Electron main process plus a
mobile-friendly xterm.js web client, so the user can read and type into each terminal pane from an
iPhone (Safari home-screen PWA). Fan pty:data out to WS subscribers alongside the renderer
forward; input goes to PtyManager.write. Scrollback-on-attach via main-side per-pane
@xterm/headless replay mirrors reusing the F18 createPaneReplay machinery. Phone never resizes the
PTY (renders at the pane's current grid, pinch-zoom/pan). Security posture: off by default, bind
localhost by default with explicit LAN/tailnet opt-in, QR-code pairing token, no secrets persisted
beyond a hashed token; Tailscale is the documented anywhere-access story (no cloud relay). Server
must be abortable/unref'd so app.close() and e2e never hang. Mobile UI needs an accessory key bar
(Ctrl/Esc/Tab/arrows) for iOS Safari keyboard quirks. Remote-workspace panes come for free since
their bytes flow through main (desktop as hub). Follow-on (out of scope here): needs-you Web Push,
native iOS client.

## Raw requirements (as captured, pre-brainstorm)

1. Opt-in HTTP + WebSocket server hosted in the Electron **main** process; **off by default**.
2. Mobile-friendly web client (xterm.js) usable from iPhone Safari, installable as a home-screen
   PWA.
3. Read every terminal pane's live output from the phone; type input into any pane
   (`PtyManager.write`).
4. `pty:data` fans out to WS subscribers **alongside** the existing renderer forward — the
   desktop renderer path is untouched.
5. Scrollback on attach: main-side per-pane `@xterm/headless` replay mirrors, reusing the F18
   `createPaneReplay` machinery (`src/agent/replay.ts`), bounded history.
6. The phone **never resizes the PTY** — it renders at the pane's current cols/rows with
   pinch-zoom/pan. (Guards the ConPTY repaint / status-tail-eviction / busy-flip cascade.)
7. Security: bind localhost by default; LAN/tailnet exposure is an explicit toggle; pairing via
   QR-code token; no secrets persisted beyond a hashed token; Tailscale documented as the
   anywhere-access story — **no cloud relay**.
8. Lifecycle: server sockets/listeners abortable + `unref()`'d so `app.close()` and the e2e suite
   never hang (established repo pattern for long-lived children).
9. Mobile UI: accessory key bar (Ctrl / Esc / Tab / arrows) to work around iOS Safari keyboard
   limitations with xterm.js.
10. Remote-workspace panes are included automatically (their bytes already flow through main —
    desktop acts as hub).
11. Out of scope (follow-on features): needs-you Web Push notifications; native iOS client.

## Context from the options discussion (non-binding)

- Main already sees every byte of every pane (`PtyManager.onData`) and owns `write`/`resize`;
  the phone problem is a main-process fan-out + transport + client problem.
- The F20 exclusive attach lease was a reason **not** to reuse the F15 wire protocol wholesale:
  the phone must *mirror*, not steal. Cherry-picking pure pieces (replay, possibly flow gate)
  is expected instead.
- `@xterm/headless` and `@xterm/addon-serialize` are already dependencies.
- iOS Safari Web Push (16.4+, home-screen PWA) was noted as the killer follow-on pairing with
  the Orky needs-you notifier — explicitly deferred, but the server built here should not
  preclude it.

## Open questions for brainstorm (phase 1)

- Pane discovery UX on the phone: workspace/pane list? follow-active-pane? per-pane URLs?
- One WS connection multiplexing all panes vs one per viewed pane; subscribe/unsubscribe model.
- Replay mirror lifecycle: mirror every pane always, or lazily on first remote view (memory vs
  instant-attach trade-off)?
- Pairing/session model: token lifetime, revocation, how the QR is surfaced in the desktop UI,
  what "unpair" looks like; single hashed token vs per-device.
- Read-only mode as a separate grant level?
- Where settings live (`quick.json`? new store?) and whether any `SCHEMA_VERSION` bump is needed.
- Web client asset pipeline: third vite build target (like `vite.agent.config.ts`) vs served
  static bundle; xterm.js licensing/packaging into the installer.
- WS backpressure toward a slow phone (reuse F17 flow-gate concepts vs socket-level
  backpressure vs drop-and-resnapshot).
- e2e strategy: env-gated seam like `e2e-presentation.ts` / `e2e-remote.ts` (structural-test
  discipline) for driving the server under Playwright.

## Likely concern tags (advisory — to be committed in the spec)

`security`, `networking`, `performance`, `determinism`
