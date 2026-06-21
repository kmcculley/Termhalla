# Clickable terminal links + image preview — design

**Date:** 2026-06-21
**Status:** Approved (brainstorm) — proceeding straight to plan + implementation per user request.

## Goal

Two related terminal quality-of-life features, both **shell/tmux-agnostic** (detection runs on
the rendered xterm buffer, not the shell):

1. **Clickable http/https URLs** — Ctrl/Cmd+click a URL in any terminal (cmd, PowerShell, tmux,
   ssh, …) to open it in the default browser.
2. **Image preview** — Ctrl/Cmd+click a referenced image (local file path *or* http(s) image URL)
   to open it in a lightbox overlay.

## Locked decisions (from brainstorm)

- **Trigger:** explicit **Ctrl/Cmd+click**; hover underlines the region. No auto-popups, no
  plain-click (keeps plain click free for cursor positioning / TUI mouse).
- **Image sources:** local filesystem paths **and** http(s) image URLs. Remote-over-SSH local
  paths are *not* linkified (the file lives on the remote; we can't read it locally). Image URLs
  still work in SSH panes. No SCP-from-remote (explicit non-goal).
- **Preview UI:** **lightbox overlay** (portal to `<body>`), so it never reflows the terminal grid.
- **Image extensions:** `.png .jpg .jpeg .gif .webp .svg .bmp .avif .ico` (case-insensitive).

## Routing (on Ctrl/Cmd+click)

| Detected | Action |
|---|---|
| http(s) URL, non-image | open in browser (`shell:openExternal`) |
| http(s) URL, image extension | lightbox (main fetches → data URL) |
| local path, image extension (local pane only) | lightbox (main reads file → data URL) |
| local path, non-image | not linkified (editor/explorer already handle files) |

## Architecture

Three sandboxed layers, per the repo model. Pure logic in `src/shared/`, thin impure wiring in the
renderer, privileged work in main behind the IPC contract.

### 1. Detection & classification — `src/shared/terminal-links.ts` (pure, unit-tested)

- `IMAGE_EXTS: readonly string[]` and `imageExt(s: string): string | null` — the matched lower-cased
  extension or null.
- `isImageUrl(uri: string): boolean` — http(s) URL whose path ends in an image extension (ignoring
  query/fragment).
- `findImagePaths(line: string): { start: number; end: number; text: string }[]` — local
  image-file-path ranges in one logical line. Matches:
  - Windows: `C:\…\name.png`, also `\\server\share\x.png` (UNC)
  - POSIX absolute: `/abs/path/x.png`
  - relative: `./x.png`, `../x.png`, `x/y.png`
  - home: `~/x.png`
  - Trailing punctuation (`) ] . , ; :`) and surrounding quotes are trimmed from the match.
  - No-space paths only (v1). Quoted paths `"…"`/`'…'` are accepted and unquoted.
- `resolveImageSrc(text: string, cwd: string, home: string): string` — returns an absolute path:
  `text` unchanged if already absolute; `~`/`~/…` expanded against `home`; otherwise joined against
  `cwd`. Pure (home/cwd injected), so main always receives a fully-resolved absolute path to read.

Classification of a URL match (image vs not) is done with `isImageUrl`. URL *finding* is delegated
to the web-links addon (see below), so this module only needs URL **classification**, not URL
parsing.

### 2. xterm wiring — `src/renderer/terminal/links.ts` (thin, impure)

`registerTerminalLinks(term, { paneId, isSsh, openExternal, openImage, getCwd, getHome })`:

- **URLs:** load `@xterm/addon-web-links` with a custom handler `(event, uri) => { if
  !(event.ctrlKey||event.metaKey) return; isImageUrl(uri) ? openImage({kind:'url', src:uri}) :
  openExternal(uri) }`. The addon handles wrapped lines, hover underline, and the link regions.
- **Local image paths:** a custom `ILinkProvider` using `findImagePaths` over the (unwrapped)
  logical buffer line, producing links whose `activate(event, text)` checks the modifier and calls
  `openImage({kind:'file', src: resolveImageSrc(text, getCwd(), getHome())})`. **Registered only when
  `!isSsh`.**

Returns a disposer; `TerminalPane` calls it after `term.open(...)` and disposes on unmount.
`openExternal`/`openImage`/`getCwd` are injected (thin store/api closures) so the wiring stays
declarative and the logic stays in the pure module.

### 3. IPC contract additions — `src/shared/ipc-contract.ts`

```
shell:openExternal   (renderer→main, fire-and-forget)   shellOpenExternal(url: string): void
preview:loadImage    (renderer→main, invoke)            previewLoadImage(req): Promise<ImageResult>
```

```ts
type ImageSource = { kind: 'file'; src: string } | { kind: 'url'; src: string }
type ImageResult = { ok: true; dataUrl: string; mime: string } | { ok: false; error: string }
```

### 4. Main registrars

- `src/main/ipc/register-shell.ts` — `shell:openExternal`: validate `new URL(url).protocol` is
  `http:`/`https:`, else ignore; then `shell.openExternal(url)`.
- `src/main/ipc/register-preview.ts` — `preview:loadImage`:
  - `kind:'url'`: only http(s); `fetch` with a hard size cap (~25 MB) and a content-type check;
    return base64 data URL.
  - `kind:'file'`: resolve `~`/relative is already done renderer-side; `stat` (must exist, be a
    file, under cap), read bytes, infer mime from extension, return data URL.
  - On any failure return `{ ok:false, error }` with a short human message. Errors never throw
    across IPC.
  - Pure helpers extracted for unit tests: `mimeForExt(ext)`, `toDataUrl(buf, mime)`,
    `validateImageRequest(req)`.
- Wire both into the root `register.ts`.

Both registrars take their deps (the `shell` object, a `fetch`, fs, size cap) by injection where it
helps testing, mirroring existing registrars.

### 5. Preview store slice + lightbox

- `src/renderer/store/preview-slice.ts`: state `preview: { open: boolean; source?: ImageSource;
  status: 'loading'|'ready'|'error'; dataUrl?: string; error?: string }`.
  - `openImagePreview(source)` → set `{open:true, status:'loading', source}`, call
    `api.previewLoadImage(source)`, then set ready/error. Guard against a stale response (a newer
    open supersedes — compare against the current `source`).
  - `closeImagePreview()` → `{open:false}` (clear dataUrl to release memory).
- `src/renderer/components/ImageLightbox.tsx`: rendered once at app root. `createPortal` to `<body>`
  (escapes mosaic tiles, like `Modal`). Dimmed backdrop; backdrop-click and **Esc** close; the
  `<img>` is fit-to-window by default, click toggles 100%↔fit. Loading spinner; error text.
  `data-testid="image-lightbox"` / `image-lightbox-img` / `image-lightbox-close`.

## Data flow (image click)

```
Ctrl+click image link
  → links.ts handler builds ImageSource (url, or file resolved vs pane cwd/home)
  → store.openImagePreview(source)  [status: loading, lightbox visible]
  → api.previewLoadImage(source) → main reads/fetches → { ok, dataUrl|error }
  → store sets ready(dataUrl) | error(msg)
  → ImageLightbox renders the image (or the error)
```

## Security

- Browser open: http/https only, validated in main (no `file:`/`javascript:`/etc.).
- Image fetch: http/https only, size-capped, content-type sanity-checked.
- File read: user-initiated; read the resolved path directly, size-capped, file-type by extension.
  No conversation/content logging. Data URLs are held only while the lightbox is open.
- CSP unchanged: `img-src 'self' data:` already permits the returned data URLs; remote images are
  *never* loaded directly by the renderer (so no CSP loosening, no CORS).

## Testing

- **Unit (vitest):** `terminal-links.ts` — URL vs image-URL classification; Windows/UNC/POSIX/
  relative/`~` image paths; trailing-punctuation + quote trimming; non-image paths ignored;
  `resolveImageSrc` absolute passthrough + relative/home join.
- **Unit:** main preview helpers — `validateImageRequest` (scheme/size/kind), `mimeForExt`,
  `toDataUrl`; `register-shell` scheme gate (inject a fake `shell`).
- **e2e (Playwright):** write a real temp PNG; `echo` its absolute path in a fresh terminal;
  Ctrl+click the underlined path → assert `image-lightbox-img` appears; press Esc → it closes.
  (Real browser launch from `shell:openExternal` is not asserted in e2e — covered by the routing
  unit test + an underline smoke check.)

## Files

| New | Purpose |
|---|---|
| `src/shared/terminal-links.ts` | pure detection/classification/resolution |
| `src/renderer/terminal/links.ts` | xterm addon + provider wiring |
| `src/main/ipc/register-shell.ts` | `shell:openExternal` |
| `src/main/ipc/register-preview.ts` | `preview:loadImage` |
| `src/renderer/store/preview-slice.ts` | lightbox state + actions |
| `src/renderer/components/ImageLightbox.tsx` | overlay UI |
| `tests/shared/terminal-links.test.ts` | unit |
| `tests/main/preview.test.ts` | unit |
| `tests/e2e/terminal-links.spec.ts` | e2e |

| Modified | Change |
|---|---|
| `src/shared/ipc-contract.ts` | channels + `TermhallaApi` methods + types |
| `src/preload/index.ts` | expose the two methods |
| `src/renderer/api.ts` | consume the two methods |
| `src/main/ipc/register.ts` | wire the two registrars |
| `src/renderer/components/TerminalPane.tsx` | call `registerTerminalLinks` (+ dispose) |
| `src/renderer/App.tsx` (root) | mount `<ImageLightbox/>` |
| `src/renderer/store.ts` | compose preview slice |
| `package.json` | add `@xterm/addon-web-links` |
| docs: `docs/features/` (new `terminal-links.md`) + CHANGELOG | feature doc + entry |

## Non-goals (v1)

SCP-from-remote image fetch; auto-follow/auto-show; inline terminal thumbnails; zoom/pan beyond
fit↔100%; linkifying non-image local files; paths containing spaces (unless quoted).
