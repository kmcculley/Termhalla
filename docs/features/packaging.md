# Packaging & Distribution

> Build Termhalla into a per-user Windows installer that ships a custom icon and updates itself in the background.

**Status:** Shipped · **Config:** [`electron-builder.yml`](../../electron-builder.yml) · **Decision:** [decisions.md → Packaging](../decisions.md)

## What it does

`npm run package` turns the `electron-vite` output (`out/`) into a Windows NSIS
installer in `dist/`; `npm run release` does the same and publishes the installer plus
its update manifest to the configured feed. Both run `electron-vite build` first, then
hand off to [electron-builder](https://www.electron.build/).

| Command | Result |
|---|---|
| `npm run package` | `dist/Termhalla Setup <version>.exe` + `latest.yml` + `.blockmap` (no upload) |
| `npm run release` | Same, then `electron-builder --publish always` uploads them to the feed |

## How it's wired

- **`electron-builder.yml`** — `appId: com.localhostworks.termhalla`, per-user NSIS
  (`oneClick: false`, `perMachine: false` → no UAC prompt), unsigned. `buildResources`
  is `build/`, so **`build/icon.ico`** (multi-res 256→16) is auto-discovered as the app
  icon — no `icon:` key needed.
- **`asarUnpack: node-pty`** — native `.node` binaries (and the bundled ConPTY
  `OpenConsole.exe` / `winpty-agent.exe`) can't be `require`'d from inside an asar, so
  node-pty is unpacked to `app.asar.unpacked/`. **This is the one packaging failure mode
  dev never exercises** — omit it and the packaged app crashes on first PTY spawn.
- **`src/main/updater.ts`** — `initAutoUpdate()` (called from `index.ts` after the
  windows start) runs `autoUpdater.checkForUpdatesAndNotify()`. It is a **no-op in dev**:
  `app.isPackaged` gates it, because the `app-update.yml` it reads only exists in a
  packaged build. The feed coordinates come from the `publish:` block, which
  electron-builder bakes into that bundled `app-update.yml`.

## Auto-update feed

`publish:` is the **GitHub** provider — `electron-updater` fetches `latest.yml` + the
installer delta from the public repo's **Releases** (no token at runtime, since the repo
is public). electron-builder bakes `owner`/`repo` into the bundled `app-update.yml`.
`releaseType: release` means a tag push publishes a full (non-draft) release, so installed
apps poll Releases on launch and install on restart.

## CI & releases (GitHub Actions)

- **`.github/workflows/ci.yml`** — on push to `main` / any PR, runs `npm ci` →
  `npm run typecheck` → `npm test` on `windows-latest` (Node 22). No e2e on CI
  (it's `workers: 1` and flaky on hosted runners — kept local).
- **`.github/workflows/release.yml`** — on a `v*` tag push, verifies the tag matches
  `package.json` version, then runs `npm run release` (`electron-vite build` +
  `electron-builder --win --publish always`) with the built-in `GITHUB_TOKEN`, uploading
  the installer + `latest.yml` + `.blockmap` to the tag's Release.

**Cutting a release:** bump `version` in `package.json`, commit, then
`git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow builds and publishes; installed
apps pick it up on next launch. (To review release notes before going live, switch
`releaseType: release` → `draft` in `electron-builder.yml` — electron-updater ignores
drafts until you publish them.)

## Gotchas

- **Run after `npm install`.** patch-package applies the node-pty Spectre patch on
  install; electron-builder then recompiles that already-patched source for Electron's
  ABI. Packaging a tree where the patch hasn't been applied ships the wrong binary.
- **Clear `NoDefaultCurrentDirectoryInExePath`** before packaging — the native rebuild
  invokes `.bat`s and a sandbox-set value of this var breaks them (same constraint as
  `npx electron-rebuild`; see README → Native modules).
- **Unsigned by default.** Internal builds click through SmartScreen. Add
  `certificateFile`/`certificatePassword` under `win:` (or rely on a cert already in the
  Windows store) to sign. macOS/Linux targets would additionally need notarization /
  their own targets — not configured (Windows-only today).

## The app icon

`build/icon.ico` is generated from a design candidate by
[`design/gen_icons.py`](../../design/gen_icons.py), which drives a ComfyUI instance over
its HTTP API to render terminal-×-Valhalla emblem candidates (the candidates themselves
are gitignored under `design/icon-candidates/`; regenerate with `python
design/gen_icons.py`). To swap the icon, drop a new 256² source through the `.ico`
multi-resolution export and rebuild.
