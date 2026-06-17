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

`publish:` is a **generic** HTTP provider — electron-updater fetches `latest.yml` + the
installer delta from a plain static host (no GitHub token / private-repo dance). The
configured `url` is a **placeholder (`https://updates.localhostworks.dev/termhalla`) and
must point at a real host before the first `npm run release`.** The release uploads
`latest.yml` + the `.exe` there; installed apps poll it on launch and install on restart.

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
