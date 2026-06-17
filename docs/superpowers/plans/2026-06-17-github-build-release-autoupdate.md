# GitHub Build, Releases & Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move CI/build/release to GitHub Actions, repoint the auto-updater at GitHub Releases, and add a Help → "Check for Updates" menu item with interactive feedback.

**Architecture:** Two GitHub Actions workflows (CI on push/PR; Release on `v*` tag) build on a Windows runner and publish the NSIS installer + `latest.yml` to GitHub Releases. `electron-builder.yml`'s `publish:` switches from a generic HTTP feed to the `github` provider so `electron-updater` reads the public repo's Releases. A new pure `update-ui.ts` mapper (unit-tested) drives the dialogs for both the silent launch-time check and a new menu-driven interactive check.

**Tech Stack:** GitHub Actions, electron-builder 26, electron-updater 6, Electron 33 (`Menu`/`dialog`), TypeScript, vitest.

## Global Constraints

- **Repo:** `kmcculley/Termhalla` (public). Runtime updater needs **no** token.
- **Runner:** `windows-latest`. **CI Node:** `22`.
- **Release trigger:** push a git tag matching `v*`.
- **Release visibility:** full (non-draft) release (`releaseType: release`).
- **Unsigned** builds (no code-signing cert). Windows-only target.
- **TDD:** pure logic gets a failing vitest test first (`tests/main/`). Electron glue (menu, dialogs, workflows) is thin and verified by typecheck + a real tag-push dry run, not e2e.
- **Commits:** conventional-commit subjects; end every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **CRLF note:** git may warn "LF will be replaced by CRLF" on commit — that is normal on this repo, not an error.

---

### Task 1: Pure update-dialog mapper (`update-ui.ts`)

The one piece with real branching logic: given an updater event and context (packaged? interactive? version?), decide which dialog to show (or `null` for silent).

**Files:**
- Create: `src/main/update-ui.ts`
- Test: `tests/main/update-ui.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `type UpdateEvent = 'checking' | 'available' | 'not-available' | 'downloaded' | 'error'`
  - `interface UpdateContext { isPackaged: boolean; interactive: boolean; version?: string; error?: string }`
  - `interface UpdateDialog { kind: 'info' | 'error' | 'restart'; title: string; message: string; buttons?: string[] }`
  - `function updateDialog(event: UpdateEvent, ctx: UpdateContext): UpdateDialog | null`

- [ ] **Step 1: Write the failing test**

Create `tests/main/update-ui.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { updateDialog } from '../../src/main/update-ui'

describe('updateDialog', () => {
  const packaged = { isPackaged: true, interactive: true }

  it('returns null for every event when not interactive (background check is silent)', () => {
    for (const e of ['checking', 'available', 'not-available', 'downloaded', 'error'] as const) {
      expect(updateDialog(e, { isPackaged: true, interactive: false })).toBeNull()
    }
  })

  it('dev + interactive: a check reports that updates need an installed build', () => {
    const d = updateDialog('checking', { isPackaged: false, interactive: true })
    expect(d).toMatchObject({ kind: 'info' })
    expect(d?.message).toMatch(/installed build/i)
    // other events in dev are silent
    expect(updateDialog('error', { isPackaged: false, interactive: true })).toBeNull()
  })

  it('packaged + interactive: checking is silent (no blocking dialog mid-check)', () => {
    expect(updateDialog('checking', packaged)).toBeNull()
  })

  it('packaged + interactive: not-available says up to date with the current version', () => {
    const d = updateDialog('not-available', { ...packaged, version: '0.1.0' })
    expect(d?.kind).toBe('info')
    expect(d?.message).toMatch(/up to date/i)
    expect(d?.message).toContain('0.1.0')
  })

  it('packaged + interactive: available announces a background download', () => {
    const d = updateDialog('available', { ...packaged, version: '0.2.0' })
    expect(d?.kind).toBe('info')
    expect(d?.message).toContain('0.2.0')
    expect(d?.message).toMatch(/download/i)
  })

  it('packaged + interactive: downloaded offers a restart with two buttons', () => {
    const d = updateDialog('downloaded', { ...packaged, version: '0.2.0' })
    expect(d?.kind).toBe('restart')
    expect(d?.buttons).toEqual(['Restart now', 'Later'])
    expect(d?.message).toContain('0.2.0')
  })

  it('packaged + interactive: error surfaces the error text', () => {
    const d = updateDialog('error', { ...packaged, error: 'ENOTFOUND' })
    expect(d?.kind).toBe('error')
    expect(d?.message).toContain('ENOTFOUND')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/update-ui.test.ts`
Expected: FAIL — `Cannot find module '../../src/main/update-ui'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/update-ui.ts`:

```ts
// Pure decision core for update dialogs. No Electron imports → unit-testable.
// The impure shell (updater.ts) maps autoUpdater events + app state onto these
// descriptors and renders them with dialog.showMessageBox.

export type UpdateEvent = 'checking' | 'available' | 'not-available' | 'downloaded' | 'error'

export interface UpdateContext {
  isPackaged: boolean
  /** True only for a user-initiated (menu) check. Background checks are silent. */
  interactive: boolean
  /** Current app version (not-available) or the new version (available/downloaded). */
  version?: string
  error?: string
}

export interface UpdateDialog {
  kind: 'info' | 'error' | 'restart'
  title: string
  message: string
  /** Present only for kind === 'restart': ['Restart now', 'Later']. */
  buttons?: string[]
}

/** Map an updater event + context to the dialog to show, or null to stay silent. */
export function updateDialog(event: UpdateEvent, ctx: UpdateContext): UpdateDialog | null {
  // Background checks never pop a dialog (checkForUpdatesAndNotify handles its own
  // native "ready" notification).
  if (!ctx.interactive) return null

  // Dev / unpackaged: there is no app-update.yml, so a real check would throw.
  if (!ctx.isPackaged) {
    if (event === 'checking') {
      return { kind: 'info', title: 'Check for Updates', message: 'Updates are only available in installed builds.' }
    }
    return null
  }

  switch (event) {
    case 'checking':
      return null
    case 'not-available':
      return { kind: 'info', title: 'Check for Updates', message: `You're up to date (v${ctx.version}).` }
    case 'available':
      return {
        kind: 'info',
        title: 'Update Available',
        message: `An update (v${ctx.version}) is available and is downloading in the background. You'll be prompted to restart when it's ready.`,
      }
    case 'downloaded':
      return {
        kind: 'restart',
        title: 'Update Ready',
        message: `Version ${ctx.version} has been downloaded. Restart Termhalla to apply it.`,
        buttons: ['Restart now', 'Later'],
      }
    case 'error':
      return {
        kind: 'error',
        title: 'Update Error',
        message: `Could not check for updates.\n\n${ctx.error ?? 'Unknown error'}`,
      }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/update-ui.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/update-ui.ts tests/main/update-ui.test.ts
git commit -m "$(cat <<'EOF'
feat(updater): pure update-dialog mapper for interactive/background checks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Updater shell — wire events + interactive check

Refactor `updater.ts` into a thin Electron shell over the Task 1 mapper. Keep `initAutoUpdate()`'s silent behavior; add `checkForUpdatesInteractive(win)` for the menu.

**Files:**
- Modify: `src/main/updater.ts` (full rewrite of the 19-line file)

**Interfaces:**
- Consumes: `updateDialog`, `UpdateEvent` from `./update-ui` (Task 1).
- Produces:
  - `function initAutoUpdate(): void` (unchanged signature)
  - `function checkForUpdatesInteractive(win: BrowserWindow | null): void`

- [ ] **Step 1: Rewrite `src/main/updater.ts`**

```ts
import { app, dialog, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { updateDialog, type UpdateEvent } from './update-ui'

// electron-updater is CommonJS; under "type": "module" the named export isn't reachable
// directly, so reach autoUpdater off the default import.
const { autoUpdater } = electronUpdater

// A user-initiated (menu) check pops dialogs; the launch-time check stays silent.
// The flag is shared across the global autoUpdater event emitter. Safe here because the
// only background check runs once at startup, before any interactive check can fire.
let interactive = false
let wired = false
let parentWin: BrowserWindow | null = null

function present(event: UpdateEvent, info?: { version?: string; error?: string }): void {
  const d = updateDialog(event, {
    isPackaged: app.isPackaged,
    interactive,
    version: info?.version,
    error: info?.error,
  })
  if (!d) return
  const opts: Electron.MessageBoxOptions = {
    type: d.kind === 'restart' ? 'info' : d.kind,
    title: d.title,
    message: d.message,
    ...(d.buttons ? { buttons: d.buttons, defaultId: 0, cancelId: 1 } : {}),
  }
  const p = parentWin ? dialog.showMessageBox(parentWin, opts) : dialog.showMessageBox(opts)
  if (d.kind === 'restart') {
    void p.then(r => { if (r.response === 0) autoUpdater.quitAndInstall() })
  } else {
    void p
  }
}

function wireOnce(): void {
  if (wired) return
  wired = true
  autoUpdater.on('checking-for-update', () => present('checking'))
  autoUpdater.on('update-available', info => present('available', { version: info.version }))
  autoUpdater.on('update-not-available', () => present('not-available', { version: app.getVersion() }))
  autoUpdater.on('update-downloaded', info => present('downloaded', { version: info.version }))
  autoUpdater.on('error', err => present('error', { error: err?.message }))
}

/**
 * Background auto-update against the GitHub Releases feed (packaged builds only).
 * Silent: dialogs are suppressed (interactive=false); checkForUpdatesAndNotify shows its
 * own native notification when an update is ready. No-op in dev (no app-update.yml).
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  wireOnce()
  interactive = false
  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.error('[updater] update check failed', err)
  })
}

/** Menu-driven check that reports results to the user (up-to-date / downloading / restart). */
export function checkForUpdatesInteractive(win: BrowserWindow | null): void {
  parentWin = win
  interactive = true
  if (!app.isPackaged) { present('checking'); return }
  wireOnce()
  autoUpdater.checkForUpdates().catch(err => {
    present('error', { error: err instanceof Error ? err.message : String(err) })
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). Confirms the `electronUpdater` default-import access, `MessageBoxOptions`, and event-payload types all resolve.

- [ ] **Step 3: Run the unit suite**

Run: `npx vitest run tests/main/update-ui.test.ts`
Expected: PASS — the mapper is unchanged; this guards against an accidental edit.

- [ ] **Step 4: Commit**

```bash
git add src/main/updater.ts
git commit -m "$(cat <<'EOF'
feat(updater): interactive Check for Updates with restart prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Application menu with Help → Check for Updates

The app sets no menu today (Electron shows its default). Install a small custom menu: a useful View submenu plus a Help submenu with "Check for Updates…" and "About Termhalla".

**Files:**
- Create: `src/main/menu.ts`
- Modify: `src/main/index.ts` (add import + call after `wm.start()`)

**Interfaces:**
- Consumes: `checkForUpdatesInteractive` from `./updater` (Task 2).
- Produces: `function installAppMenu(): void`

- [ ] **Step 1: Create `src/main/menu.ts`**

```ts
import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from 'electron'
import { checkForUpdatesInteractive } from './updater'

/**
 * Install the application menu. Replaces Electron's default menu bar with a minimal
 * template: View (reload / devtools / zoom / fullscreen) and Help (Check for Updates,
 * About). Call once after the windows start.
 */
export function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => checkForUpdatesInteractive(BrowserWindow.getFocusedWindow()),
        },
        { type: 'separator' },
        {
          label: 'About Termhalla',
          click: () => {
            const win = BrowserWindow.getFocusedWindow()
            const opts: Electron.MessageBoxOptions = {
              type: 'info',
              title: 'About Termhalla',
              message: 'Termhalla',
              detail: `Version ${app.getVersion()}`,
            }
            void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

- [ ] **Step 2: Wire it in `src/main/index.ts`**

Add the import near the other `./` imports (after the `initAutoUpdate` import line):

```ts
import { installAppMenu } from './menu'
```

Then, inside `start()`, install the menu right after `wm.start()` and before `initAutoUpdate()`:

```ts
  wm.start()

  // Replace Electron's default menu with our Help (Check for Updates) + View menu.
  installAppMenu()

  // Background check against the GitHub Releases feed (packaged builds only).
  initAutoUpdate()
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Confirms `MenuItemConstructorOptions` roles and the `installAppMenu` import resolve.

- [ ] **Step 4: Build smoke (renderer/main compile)**

Run: `npm run build`
Expected: completes without error (the new main-process modules are bundled into `out/`).

- [ ] **Step 5: Commit**

```bash
git add src/main/menu.ts src/main/index.ts
git commit -m "$(cat <<'EOF'
feat(menu): Help -> Check for Updates and About in a custom app menu

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Point the auto-updater at GitHub Releases

Switch `electron-builder.yml`'s `publish:` from the generic placeholder feed to the GitHub provider. This is what makes both the background and interactive checks read the public repo's Releases.

**Files:**
- Modify: `electron-builder.yml` (repo root — the `publish:` block at the bottom)

- [ ] **Step 1: Replace the `publish:` block**

Find:

```yaml
# Generic HTTP update feed. electron-updater writes these coordinates into the bundled
# app-update.yml; electron-updater reads it to find latest.yml + the installer delta.
# CHANGE this url to wherever you host the feed before the first real release.
publish:
  provider: generic
  url: https://updates.localhostworks.dev/termhalla
```

Replace with:

```yaml
# GitHub Releases update feed. electron-builder bakes these coordinates into the bundled
# app-update.yml; electron-updater reads it to find latest.yml + the installer delta from
# the public repo's Releases (no runtime token needed). releaseType: release publishes a
# full (non-draft) release so a tag push goes live and auto-update flows immediately.
publish:
  provider: github
  owner: kmcculley
  repo: Termhalla
  releaseType: release
```

- [ ] **Step 2: Validate the YAML parses**

Run: `node -e "const fs=require('fs');const yaml=require('js-yaml');console.log(JSON.stringify(yaml.load(fs.readFileSync('electron-builder.yml','utf8')).publish))"`

If `js-yaml` is not installed, instead run:
`npx --yes js-yaml electron-builder.yml > /dev/null && echo OK`

Expected: prints the publish object showing `provider: github`, `owner: kmcculley`, `repo: Termhalla`, `releaseType: release` (or `OK`).

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "$(cat <<'EOF'
build: auto-update from GitHub Releases instead of generic feed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: CI workflow (typecheck + unit tests on push/PR)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      # npm ci runs postinstall -> patch-package, applying the node-pty Spectre patch.
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run: `npx --yes js-yaml .github/workflows/ci.yml > /dev/null && echo OK`
Expected: `OK` (no parse error).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: typecheck + unit tests on push and PR (windows-latest, node 22)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Release workflow (tag push → build → publish to Releases)

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write # create the Release and upload installer + latest.yml

jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      # Guard: a v0.2.0 tag must ship a latest.yml that says 0.2.0, or the updater's
      # version comparison silently breaks. Fail fast on a mismatch.
      - name: Verify tag matches package.json version
        shell: bash
        run: |
          PKG=$(node -p "require('./package.json').version")
          TAG="${GITHUB_REF_NAME#v}"
          echo "package.json=$PKG tag=$TAG"
          if [ "$PKG" != "$TAG" ]; then
            echo "::error::Tag v$TAG does not match package.json version $PKG"
            exit 1
          fi

      # electron-builder builds out/, rebuilds node-pty for Electron's ABI, packs the NSIS
      # installer, and uploads it + latest.yml + .blockmap to the tag's GitHub Release.
      - name: Build and publish
        run: npx electron-builder --win --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run: `npx --yes js-yaml .github/workflows/release.yml > /dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
ci: release workflow publishes NSIS installer to GitHub Releases on v* tag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Documentation

Update the living docs to reflect GitHub CI/Releases, the GitHub auto-update provider, and the new menu. No code; doc-only.

**Files:**
- Modify: `docs/features/packaging.md`
- Modify: `docs/decisions.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md` (release/how-to-cut-a-release section)

- [ ] **Step 1: Update `docs/features/packaging.md`**

Replace the "Auto-update feed" section's generic-provider description with the GitHub provider, and add a short "CI & releases" subsection. Use this content for the feed section:

```markdown
## Auto-update feed

`publish:` is the **GitHub** provider — `electron-updater` fetches `latest.yml` + the
installer delta from the public repo's **Releases** (no token at runtime, since the repo
is public). electron-builder bakes `owner`/`repo` into the bundled `app-update.yml`.
`releaseType: release` means a tag push publishes a full (non-draft) release, so installed
apps poll Releases on launch and install on restart.

## CI & releases (GitHub Actions)

- **`.github/workflows/ci.yml`** — on push to `main` / any PR, runs `npm ci` →
  `npm run typecheck` → `npm test` on `windows-latest` (Node 22). No e2e on CI.
- **`.github/workflows/release.yml`** — on a `v*` tag push, verifies the tag matches
  `package.json` version, then runs `electron-builder --win --publish always` with the
  built-in `GITHUB_TOKEN`, uploading the installer + `latest.yml` + `.blockmap` to the
  tag's Release.

**Cutting a release:** bump `version` in `package.json`, commit, then
`git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow builds and publishes; installed
apps pick it up on next launch.
```

Also update the "Gotchas" note that previously said the URL is a placeholder — remove that sentence (the feed is now real).

- [ ] **Step 2: Add a decision entry to `docs/decisions.md`**

Append a new dated section at the end:

```markdown
### [2026-06-17] CI/build/releases on GitHub Actions; auto-update from GitHub Releases

The repo went public, so build/release moved off the local machine. Two workflows run on
`windows-latest` (the only supported target; native node-pty rebuilds there): **CI**
(typecheck + unit tests on push/PR — e2e stays local, it's `workers: 1` and flaky on
hosted runners) and **Release** (on a `v*` tag → `electron-builder --publish always`).
The updater's `publish:` switched from the placeholder generic feed to the `github`
provider (`releaseType: release`), so `electron-updater` reads the public repo's Releases
with no runtime token. A workflow guard fails the release if the tag and `package.json`
version disagree, preventing a `latest.yml`/installer version skew that would wedge the
updater. The Help menu's "Check for Updates…" drives an interactive check whose dialog
copy is decided by a pure `update-ui.ts` mapper (unit-tested), keeping the Electron shell
thin. Builds remain unsigned (SmartScreen prompt accepted).
```

- [ ] **Step 3: Update `CHANGELOG.md`** — add under `## [Unreleased]` → `### Added`:

```markdown
- **GitHub Actions CI & releases.** Push/PR runs typecheck + unit tests on
  `windows-latest`; pushing a `v*` tag builds the NSIS installer and publishes it to
  GitHub Releases. The auto-updater now reads GitHub Releases (was a placeholder generic
  feed).
- **Help → Check for Updates.** A new application menu adds Help → "Check for Updates…"
  (with up-to-date / downloading / restart-now feedback) and "About Termhalla", plus a
  View submenu (reload, DevTools, zoom, fullscreen).
```

- [ ] **Step 4: Update `README.md`**

In the release/distribution section (search for the existing `npm run release` / feed
mention), replace the local-publish guidance with the tag-push flow:

```markdown
Releases are built by GitHub Actions. To cut one: bump `version` in `package.json`,
commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`. The Release workflow builds the
Windows installer and publishes it (plus `latest.yml`) to GitHub Releases; installed apps
auto-update from there on next launch. `npm run package` still builds an installer
locally for testing.
```

If the README has no such section, add the above under a new `## Releases` heading near
the existing build/native-modules docs.

- [ ] **Step 5: Verify docs reference real paths**

Run: `npx --yes js-yaml electron-builder.yml > /dev/null && echo "config OK"` and skim
the four edited docs for any lingering mention of `localhostworks.dev` /
`provider: generic`.
Run: `grep -rn "localhostworks.dev\|provider: generic" docs README.md` — expected: no
matches (or only inside this plan/spec history).

- [ ] **Step 6: Commit**

```bash
git add docs/features/packaging.md docs/decisions.md CHANGELOG.md README.md
git commit -m "$(cat <<'EOF'
docs: GitHub CI/releases, GitHub auto-update provider, Check for Updates menu

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after all tasks)

- [ ] `npm run typecheck` — PASS
- [ ] `npm test` — PASS (includes the new `update-ui` suite)
- [ ] `npm run build` — completes
- [ ] `npx --yes js-yaml .github/workflows/ci.yml .github/workflows/release.yml electron-builder.yml > /dev/null && echo OK` — `OK`
- [ ] **Live dry run (manual, requires pushing to GitHub):** bump `package.json` to a test patch version, tag `vX.Y.Z`, push the tag. Confirm: (1) the Release workflow succeeds, (2) a non-draft Release appears with `Termhalla Setup X.Y.Z.exe` + `latest.yml` + `.blockmap`, (3) an installed older build offered the update on launch, and (4) Help → "Check for Updates…" reports correctly in the installed build.

## Notes / risks

- **node-pty native build on the runner:** `windows-latest` ships MSVC build tools; the Spectre patch (applied by `postinstall`) avoids the missing Spectre-mitigated libs. If `npm ci` fails compiling node-pty, check the runner's VS toolchain and that `patches/` applied (`patch-package` output in the log).
- **First release & `latest.yml`:** auto-update only works from the *second* release onward (an installed build needs a newer `latest.yml` to find). The first GitHub release just establishes the baseline.
- **Draft alternative:** if you later prefer to review release notes before going live, change `releaseType: release` → `releaseType: draft` in `electron-builder.yml`; electron-updater ignores drafts until you publish them.
