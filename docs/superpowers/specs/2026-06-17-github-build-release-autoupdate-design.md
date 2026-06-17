# GitHub-hosted build, releases, and auto-update

**Date:** 2026-06-17
**Status:** Approved (design)
**Topic:** Move CI/build/release to GitHub Actions; point the auto-updater at GitHub Releases; add a Help → "Check for Updates" menu item.

## Context

The repo (`github.com/kmcculley/Termhalla`) is now **public**. Today:

- **Packaging** is local-only: `npm run package` / `npm run release` produce an
  unsigned Windows NSIS installer; native `node-pty` is rebuilt for Electron's ABI
  with a Spectre-off patch applied by `patch-package` on `npm install`.
- **Auto-update** uses a `generic` HTTP provider pointing at a **placeholder** host
  (`https://updates.localhostworks.dev/termhalla`). `initAutoUpdate()` runs a silent
  `checkForUpdatesAndNotify()` on launch, gated by `app.isPackaged`.
- **Menus:** no application menu is installed, so Electron shows its *default* menu
  bar; there is no Help → "Check for Updates" item.
- **CI:** no `.github/workflows/` exists.

## Goals

1. Run the build/CI on GitHub instead of locally.
2. Cut releases on GitHub (installer + update manifest published to GitHub Releases).
3. Point the auto-updater at GitHub Releases.
4. Add a Help menu with a "Check for Updates" option that gives interactive feedback.

## Decisions (confirmed)

- **Release trigger:** push a `v*` git tag.
- **CI scope:** `typecheck` + unit tests (`npm test`) on push/PR. No e2e on CI.
- **Runner:** `windows-latest` (Windows-only product; native rebuild + tests run on
  the real target OS).
- **CI Node:** 22 LTS.
- **Release visibility:** publish a **full (non-draft) release** so tag-push → live
  release → auto-update is fully automated. (Alternative considered: `draft` +
  manual publish; electron-updater ignores drafts until published.)
- **Signing:** remain **unsigned** (no code-signing cert; SmartScreen prompt on first
  run is expected, as documented).
- **Runtime token:** none required — the repo is public, so `electron-updater` reads
  Releases anonymously.

## Design

### 1. CI workflow — `.github/workflows/ci.yml`

- **Triggers:** `push` to `main`, all `pull_request`.
- **Runner:** `windows-latest`.
- **Steps:** checkout → `actions/setup-node@v4` (Node 22, `cache: npm`) → `npm ci`
  (runs `postinstall` → `patch-package`, applying the node-pty Spectre patch) →
  `npm run typecheck` → `npm test`.
- Rationale for no e2e: Playwright-for-Electron is slow/flaky on hosted Windows
  runners (needs the native rebuild + a display) and e2e is pinned to `workers: 1`
  by design. Kept to local runs.

### 2. Release workflow — `.github/workflows/release.yml`

- **Trigger:** `push` of tags matching `v*`.
- **Permissions:** `contents: write` (create the Release + upload assets).
- **Runner:** `windows-latest`.
- **Version guard:** a step asserts the pushed tag equals `v$(node -p \
  "require('./package.json').version")` and fails on mismatch. This prevents a
  `v0.2.0` tag from shipping a `latest.yml` that reports `0.1.0`, which would
  silently wedge the updater's version comparison.
- **Build/publish step:** `npx electron-builder --win --publish always` with
  `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (the built-in Actions token; no PAT or
  manually-created secret needed). This compiles `out/`, rebuilds node-pty for
  Electron's ABI, packs the NSIS installer, and uploads
  `Termhalla Setup <version>.exe` + `latest.yml` + `.blockmap` to the tag's GitHub
  Release.
- electron-builder is configured (see §3) to publish a non-draft release.

### 3. Auto-update → GitHub Releases — `electron-builder.yml`

Replace the `generic` `publish:` block with:

```yaml
publish:
  provider: github
  owner: kmcculley
  repo: Termhalla
```

These coordinates are baked into the bundled `app-update.yml`; `electron-updater`
then polls the public repo's Releases. No runtime token (public repo). The existing
launch-time `initAutoUpdate()` background check continues to work unchanged, now
against GitHub.

`package.json` has no `repository` field; rather than rely on inference we set
`owner`/`repo` explicitly in the publish block. (Optionally also add a `repository`
field to package.json for ecosystem correctness — non-load-bearing.)

### 4. Help → "Check for Updates" + interactive update flow

**Menu — new `src/main/menu.ts`**, installed via `Menu.setApplicationMenu` from
`index.ts` after windows start:

- Replaces Electron's default menu with a small custom template:
  - **View** submenu: reload, force-reload, toggle DevTools, zoom in/out/reset,
    toggle fullscreen (standard roles — useful for an Electron app).
  - **Help** submenu: **"Check for Updates…"** and **"About Termhalla"** (About shows
    name + version via a simple message box).
- The "Check for Updates…" click calls into the updater's interactive entry point,
  passing the focused `BrowserWindow` as the dialog parent.

**Updater — refactor `src/main/updater.ts` into thin shell + pure core:**

- **New pure module `src/main/update-ui.ts`** — the testable core. A pure function
  maps `(updaterEvent, ctx)` → a dialog descriptor or `null`, where:
  - `updaterEvent` ∈ {`checking`, `available`, `not-available`, `downloaded`,
    `error`}.
  - `ctx` = `{ isPackaged: boolean, interactive: boolean, version?, error? }`.
  - Returns `{ kind, title, message, buttons? }` (or `null` to show nothing — e.g. a
    *background* `not-available` is silent; an *interactive* one yields
    *"You're up to date (vX)"*).
  - Unpackaged + interactive → a *"Updates are only available in installed builds"*
    descriptor (so the menu item never throws in dev).
- **Shell (`updater.ts`):**
  - `initAutoUpdate()` — unchanged behavior: background, silent except the existing
    "ready" notification; no-op when `!app.isPackaged`.
  - `checkForUpdatesInteractive(win)` — new. Marks the next check as interactive,
    wires `autoUpdater` events (`checking-for-update`, `update-available`,
    `update-not-available`, `update-downloaded`, `error`) to the pure mapper, shows
    `dialog.showMessageBox(win, …)`. On `update-downloaded` the descriptor offers
    **Restart now / Later**; "Restart now" → `autoUpdater.quitAndInstall()`.
    `autoDownload` stays at its default (true), so an available update downloads then
    surfaces the restart prompt.
  - Event listeners are registered once and shared between background and interactive
    paths; an `interactive` flag (reset after a check resolves) decides whether the
    silent descriptors are suppressed.

### 5. Documentation (done in the implementation plan's doc step)

- `docs/features/packaging.md` — generic → GitHub provider; document the CI and
  release workflows and the tag-push flow.
- `README` — release/native-modules notes (how to cut a release: bump version, tag,
  push).
- `docs/decisions.md` — record the GitHub Actions CI + Releases + GitHub-provider
  auto-update decision and its rationale.
- `CHANGELOG.md` — entry for the release pipeline + Check-for-Updates menu.

## Testing

- **`update-ui.ts`** pure mapper → vitest unit tests in `tests/` (the one piece with
  real branching logic: background-vs-interactive, packaged-vs-dev, each event →
  expected descriptor / null).
- **Workflows + menu/dialog wiring** are thin glue. Verified by a real `v*` tag-push
  dry run (e.g. a `v0.1.1` test release) confirming: Actions builds, a Release is
  created with the three assets, and an installed older build auto-updates. Not
  covered by e2e — `autoUpdater` cannot be meaningfully driven in the Playwright
  harness without a live release endpoint.

## Out of scope

- Code signing / notarization.
- macOS / Linux targets.
- Delta-update tuning beyond electron-builder defaults.
