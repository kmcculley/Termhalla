# Scoop manifest for Termhalla

`termhalla.json` installs the **portable zip** build (not the NSIS installer — Scoop's model is
extract-and-run, and Electron NSIS installers don't extract cleanly). The zip is produced by the
`zip` target in `electron-builder.yml` and uploaded to each GitHub release alongside the installer.

## Install (until a public bucket exists)

```powershell
scoop install https://raw.githubusercontent.com/kmcculley/Termhalla/main/packaging/scoop/termhalla.json
```

## Publishing as a bucket (recommended for `scoop install termhalla`)

Host the manifest in a Scoop bucket repo (a repo with a `bucket/` folder, conventionally named
`scoop-<name>`), then users:

```powershell
scoop bucket add termhalla https://github.com/kmcculley/scoop-termhalla
scoop install termhalla
```

`checkver: github` + the `autoupdate` block let the standard Scoop bucket auto-PR bot bump the
version, URL, and hash automatically on each new GitHub release — no manual edits per release.

## Notes

- **No signing dependency.** Scoop verifies the download by SHA-256 (the `hash` field), independent
  of Authenticode signing — so this channel sidesteps the SmartScreen prompt entirely.
- **App data** lives in the Electron `userData` dir (AppData), not the install dir, so no `persist`
  block is needed; `scoop uninstall` leaves your workspaces/settings intact.
- The `hash` here is the SHA-256 of the exact published `Termhalla-0.2.0-win.zip` asset. On the next
  release, autoupdate recomputes it; if you bump the manifest by hand, update both `version` and
  `hash`.
