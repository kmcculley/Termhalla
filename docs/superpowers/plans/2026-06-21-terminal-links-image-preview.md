# Clickable Terminal Links + Image Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ctrl/Cmd+click http(s) URLs in any terminal to open them in the browser, and Ctrl/Cmd+click referenced images (local paths or image URLs) to preview them in a lightbox overlay.

**Architecture:** Detection runs on the rendered xterm buffer (shell/tmux-agnostic). URLs use the official `@xterm/addon-web-links` with a custom handler; local image paths use a small custom xterm link provider driven by a pure matcher in `src/shared/terminal-links.ts`. Two new main IPC channels: `shell:openExternal` (open URL) and `preview:loadImage` (main reads a file or fetches a URL and returns a base64 data URL — required because the renderer CSP is `img-src 'self' data:`). A renderer `preview` store slice drives an `ImageLightbox` overlay portaled to `<body>`.

**Tech Stack:** Electron, TypeScript, React, zustand, xterm.js (`@xterm/xterm` 5.5), `@xterm/addon-web-links` (new), vitest, Playwright-for-Electron.

## Global Constraints

- **TDD:** failing test first; pure logic → vitest in `tests/`, UI/IPC → Playwright e2e. Match the nearest existing test's style.
- **Layering:** renderer never touches Node; all privilege in `src/main`; the only bridge is the typed `window.api` via the `src/shared/ipc-contract.ts` contract. `contextIsolation: true`, `nodeIntegration: false`.
- **Pure logic** lives in `src/shared/` (no `node:*` imports there — shared is bundled into the renderer too) or small pure modules; the impure shell stays thin.
- **Path alias:** import shared code as `@shared/...`.
- **IPC naming:** `domain:verb`. Main→renderer pushes are commented as such in the contract.
- **No secrets persisted; never log conversation/terminal content.** Image data URLs are held only while the lightbox is open.
- **Image extensions (v1):** `png jpg jpeg gif webp svg bmp avif ico` (case-insensitive).
- **Image size cap:** 25 MiB (`25 * 1024 * 1024`).
- **e2e runs against `out/`** — `npm run build` before `npm run e2e`. e2e stays `workers: 1`.
- **Commands:** `npm test -- <file> --run` (unit), `npm run typecheck`, `npm run build`, `npm run e2e`.

---

### Task 1: Pure detection/classification module

**Files:**
- Create: `src/shared/terminal-links.ts`
- Test: `tests/shared/terminal-links.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `IMAGE_EXTS: readonly string[]`
  - `imageExt(s: string): string | null` — lower-cased extension (no dot) if `s` ends in an image extension, else null.
  - `isImageUrl(uri: string): boolean` — true if the URL's path (query/hash stripped) ends in an image extension.
  - `interface LinkMatch { start: number; end: number; text: string }` — half-open `[start, end)` indices into the line; `text` is the trimmed path.
  - `findImagePaths(line: string): LinkMatch[]` — whitespace-delimited tokens, surrounding quotes/brackets and trailing punctuation trimmed, that end in an image extension and are not URLs (`://`).
  - `resolveImageSrc(text: string, cwd: string, home: string): string` — absolute path (absolute passthrough; `~` → home; else join against cwd).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { imageExt, isImageUrl, findImagePaths, resolveImageSrc } from '@shared/terminal-links'

describe('imageExt', () => {
  it('returns the lowercased extension for image files', () => {
    expect(imageExt('a.PNG')).toBe('png')
    expect(imageExt('shot.jpeg')).toBe('jpeg')
  })
  it('returns null for non-images and bare names', () => {
    expect(imageExt('notes.txt')).toBeNull()
    expect(imageExt('README')).toBeNull()
  })
})

describe('isImageUrl', () => {
  it('detects image URLs ignoring query/hash', () => {
    expect(isImageUrl('https://x.io/a.png')).toBe(true)
    expect(isImageUrl('https://x.io/p/a.jpg?v=2#frag')).toBe(true)
  })
  it('is false for non-image URLs', () => {
    expect(isImageUrl('https://x.io/page')).toBe(false)
    expect(isImageUrl('https://x.io/a.html')).toBe(false)
  })
})

describe('findImagePaths', () => {
  it('finds an absolute POSIX image path with correct indices', () => {
    const line = 'saved to /home/u/out.png done'
    const m = findImagePaths(line)
    expect(m).toEqual([{ start: 9, end: 23, text: '/home/u/out.png' }])
    expect(line.slice(m[0].start, m[0].end)).toBe('/home/u/out.png')
  })
  it('finds windows, UNC, relative, dot-relative and home paths', () => {
    expect(findImagePaths('C:\\tmp\\a.png').map(m => m.text)).toEqual(['C:\\tmp\\a.png'])
    expect(findImagePaths('\\\\srv\\share\\b.jpg').map(m => m.text)).toEqual(['\\\\srv\\share\\b.jpg'])
    expect(findImagePaths('see ./out/c.gif now').map(m => m.text)).toEqual(['./out/c.gif'])
    expect(findImagePaths('img dir/d.webp').map(m => m.text)).toEqual(['dir/d.webp'])
    expect(findImagePaths('at ~/pics/e.svg').map(m => m.text)).toEqual(['~/pics/e.svg'])
  })
  it('trims surrounding quotes/parens and trailing punctuation', () => {
    expect(findImagePaths('"C:\\a b\\x.png"').map(m => m.text)).toEqual(['C:\\a b\\x.png'])
    expect(findImagePaths('(see ./a.png).').map(m => m.text)).toEqual(['./a.png'])
    expect(findImagePaths('path: /tmp/a.png, ok').map(m => m.text)).toEqual(['/tmp/a.png'])
  })
  it('ignores URLs (handled by the web-links addon) and non-images', () => {
    expect(findImagePaths('https://x.io/a.png')).toEqual([])
    expect(findImagePaths('notes.txt and a.tar.gz')).toEqual([])
  })
})

describe('resolveImageSrc', () => {
  const home = '/home/u'
  it('passes absolute paths through', () => {
    expect(resolveImageSrc('/a/b.png', '/cwd', home)).toBe('/a/b.png')
    expect(resolveImageSrc('C:\\a\\b.png', 'C:\\cwd', home)).toBe('C:\\a\\b.png')
  })
  it('expands ~ against home', () => {
    expect(resolveImageSrc('~/pics/e.svg', '/cwd', home)).toBe('/home/u/pics/e.svg')
  })
  it('joins relative paths against cwd, stripping a leading ./', () => {
    expect(resolveImageSrc('./out/c.gif', '/cwd', home)).toBe('/cwd/out/c.gif')
    expect(resolveImageSrc('dir/d.webp', 'C:\\cwd', home)).toBe('C:\\cwd\\dir/d.webp')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- terminal-links.test.ts --run`
Expected: FAIL — `Failed to resolve import "@shared/terminal-links"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/terminal-links.ts
/** Pure detection/classification for clickable terminal links. No node:* imports — this module is
 *  bundled into the renderer too. URL *finding* is delegated to @xterm/addon-web-links; this module
 *  only classifies URLs (image vs not) and finds local image-file paths. */

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'] as const
const EXT_SET = new Set<string>(IMAGE_EXTS)

/** Lower-cased extension (no dot) if `s` ends in a known image extension, else null. */
export function imageExt(s: string): string | null {
  const dot = s.lastIndexOf('.')
  if (dot < 0 || dot === s.length - 1) return null
  const ext = s.slice(dot + 1).toLowerCase()
  return EXT_SET.has(ext) ? ext : null
}

/** True if the URL's path (query/hash stripped) ends in an image extension. */
export function isImageUrl(uri: string): boolean {
  const path = uri.split('#')[0].split('?')[0]
  return imageExt(path) !== null
}

export interface LinkMatch { start: number; end: number; text: string }

const LEAD = new Set(['"', "'", '`', '(', '[', '<', '{'])
const TRAIL = new Set(['"', "'", '`', ')', ']', '>', '}', '.', ',', ';', ':', '!', '?'])

/** Local image-file path ranges in one line. Tokenizes on whitespace, trims wrapping quotes/brackets
 *  and trailing punctuation, and keeps tokens that end in an image extension and are not URLs. */
export function findImagePaths(line: string): LinkMatch[] {
  const out: LinkMatch[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    let start = m.index
    let end = m.index + m[0].length
    while (start < end && LEAD.has(line[start])) start++
    while (end > start && TRAIL.has(line[end - 1])) end--
    const text = line.slice(start, end)
    if (!text || text.includes('://')) continue
    if (imageExt(text) === null) continue
    out.push({ start, end, text })
  }
  return out
}

const ABSOLUTE = /^([A-Za-z]:[\\/]|\\\\|\/)/

/** Absolute path for an image reference: absolute passthrough; `~`/`~/…` → home; else join cwd. */
export function resolveImageSrc(text: string, cwd: string, home: string): string {
  if (text === '~') return home
  if (text.startsWith('~/') || text.startsWith('~\\')) return joinPath(home, text.slice(2))
  if (ABSOLUTE.test(text)) return text
  return joinPath(cwd, text)
}

function joinPath(base: string, rel: string): string {
  const r = rel.replace(/^\.[\\/]/, '')
  const sep = base.includes('\\') ? '\\' : '/'
  return base.replace(/[\\/]+$/, '') + sep + r
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- terminal-links.test.ts --run`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/shared/terminal-links.ts tests/shared/terminal-links.test.ts
git commit -m "feat(links): pure terminal-link detection (urls + image paths)"
```

---

### Task 2: IPC contract + preload wiring

**Files:**
- Modify: `src/shared/ipc-contract.ts` (CH map, types, `TermhallaApi`)
- Modify: `src/preload/index.ts` (expose the two methods)

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3–7):
  - `CH.shellOpenExternal = 'shell:openExternal'`, `CH.previewLoadImage = 'preview:loadImage'`
  - `type ImageSource = { kind: 'file'; src: string } | { kind: 'url'; src: string }`
  - `type ImageResult = { ok: true; dataUrl: string; mime: string } | { ok: false; error: string }`
  - `TermhallaApi.openExternal(url: string): void`
  - `TermhallaApi.previewLoadImage(src: ImageSource): Promise<ImageResult>`
  - Renderer consumes both via the existing `api` object (`src/renderer/api.ts` is just `window.termhalla`, so no change there).

- [ ] **Step 1: Add channels to the `CH` map**

In `src/shared/ipc-contract.ts`, inside the `CH = { … } as const` object (e.g. right after the `searchSetMuted` line), add:

```ts
  shellOpenExternal: 'shell:openExternal',  // renderer -> main (open a URL in the default browser)
  previewLoadImage: 'preview:loadImage',    // renderer -> main (read file / fetch url -> data URL)
```

- [ ] **Step 2: Add the shared types**

In `src/shared/ipc-contract.ts`, after the existing `export interface TermSnapshotArgs …` line, add:

```ts
export type ImageSource = { kind: 'file'; src: string } | { kind: 'url'; src: string }
export type ImageResult = { ok: true; dataUrl: string; mime: string } | { ok: false; error: string }
```

- [ ] **Step 3: Add the two methods to `TermhallaApi`**

In the `TermhallaApi` interface (e.g. after `searchSetMuted(...)`), add:

```ts
  openExternal(url: string): void
  previewLoadImage(src: ImageSource): Promise<ImageResult>
```

- [ ] **Step 4: Expose them in preload**

In `src/preload/index.ts`, inside the `const api: TermhallaApi = { … }` object (e.g. after `searchSetMuted`), add:

```ts
  openExternal: (url) => ipcRenderer.send(CH.shellOpenExternal, url),
  previewLoadImage: (src) => ipcRenderer.invoke(CH.previewLoadImage, src),
```

- [ ] **Step 5: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (no errors). The new contract members are satisfied by preload; main/renderer wire-up follows in later tasks.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts
git commit -m "feat(ipc): add shell:openExternal + preview:loadImage contract"
```

---

### Task 3: Main — open external URL (`register-shell`)

**Files:**
- Create: `src/main/ipc/register-shell.ts`
- Modify: `src/main/ipc/register.ts` (wire it in)
- Test: `tests/main/register-shell.test.ts`

**Interfaces:**
- Consumes: `CH.shellOpenExternal` (Task 2).
- Produces:
  - `safeOpenExternal(url: string, open: (u: string) => void): void` — opens only `http:`/`https:` URLs.
  - `registerShell(deps?: { openExternal?: (u: string) => void }): void` — registers the `ipcMain.on` handler.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/register-shell.test.ts
import { describe, it, expect, vi } from 'vitest'
import { safeOpenExternal } from '../../src/main/ipc/register-shell'

describe('safeOpenExternal', () => {
  it('opens http and https URLs', () => {
    const open = vi.fn()
    safeOpenExternal('http://example.com', open)
    safeOpenExternal('https://example.com/a?b=1', open)
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('ignores non-http(s) schemes and garbage', () => {
    const open = vi.fn()
    safeOpenExternal('file:///etc/passwd', open)
    safeOpenExternal('javascript:alert(1)', open)
    safeOpenExternal('not a url', open)
    expect(open).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- register-shell.test.ts --run`
Expected: FAIL — cannot resolve `../../src/main/ipc/register-shell`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/ipc/register-shell.ts
import { ipcMain, shell } from 'electron'
import { CH } from '@shared/ipc-contract'

/** Open `url` in the default browser, but only for http(s) — never file:/javascript:/etc. Pure of
 *  Electron (open is injected) so it can be unit-tested. */
export function safeOpenExternal(url: string, open: (u: string) => void): void {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') open(url)
  } catch { /* not a URL: ignore */ }
}

/** Register the open-external handler. Fire-and-forget; no long-lived resources, so no disposer. */
export function registerShell(deps: { openExternal?: (u: string) => void } = {}): void {
  const open = deps.openExternal ?? ((u: string) => { void shell.openExternal(u) })
  ipcMain.on(CH.shellOpenExternal, (_e, url: string) => safeOpenExternal(url, open))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- register-shell.test.ts --run`
Expected: PASS.

- [ ] **Step 5: Wire into the composition root**

In `src/main/ipc/register.ts`:
- add the import near the other registrar imports: `import { registerShell } from './register-shell'`
- call it next to the other no-disposer registrars (e.g. right after `registerClipboard()`): `registerShell()`

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/register-shell.ts src/main/ipc/register.ts tests/main/register-shell.test.ts
git commit -m "feat(links): main handler to open http(s) URLs in the browser"
```

---

### Task 4: Main — load image (`register-preview`)

**Files:**
- Create: `src/main/ipc/register-preview.ts`
- Modify: `src/main/ipc/register.ts` (wire it in)
- Test: `tests/main/preview.test.ts`

**Interfaces:**
- Consumes: `CH.previewLoadImage`, `ImageSource`, `ImageResult` (Task 2); `imageExt` (Task 1).
- Produces:
  - `mimeForExt(ext: string): string`
  - `toDataUrl(buf: Buffer, mime: string): string`
  - `interface LoadDeps { readFile(p: string): Promise<Buffer>; stat(p: string): Promise<{ size: number; isFile(): boolean }>; fetchUrl(u: string): Promise<{ ok: boolean; contentType: string | null; bytes: Buffer }>; cap: number }`
  - `loadImage(req: ImageSource, deps: LoadDeps): Promise<ImageResult>`
  - `registerPreview(): Disposer` — registers `ipcMain.handle`; returns a disposer that removes it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/preview.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mimeForExt, toDataUrl, loadImage, type LoadDeps } from '../../src/main/ipc/register-preview'

const CAP = 25 * 1024 * 1024
function deps(over: Partial<LoadDeps> = {}): LoadDeps {
  return {
    readFile: vi.fn(async () => Buffer.from('PNGDATA')),
    stat: vi.fn(async () => ({ size: 7, isFile: () => true })),
    fetchUrl: vi.fn(async () => ({ ok: true, contentType: 'image/png', bytes: Buffer.from('PNGDATA') })),
    cap: CAP,
    ...over
  }
}

describe('mimeForExt / toDataUrl', () => {
  it('maps extensions to mime types', () => {
    expect(mimeForExt('png')).toBe('image/png')
    expect(mimeForExt('jpg')).toBe('image/jpeg')
    expect(mimeForExt('svg')).toBe('image/svg+xml')
  })
  it('builds a base64 data URL', () => {
    expect(toDataUrl(Buffer.from('hi'), 'image/png')).toBe('data:image/png;base64,aGk=')
  })
})

describe('loadImage (file)', () => {
  it('reads a local image and returns a data URL', async () => {
    const r = await loadImage({ kind: 'file', src: '/tmp/a.png' }, deps())
    expect(r).toEqual({ ok: true, dataUrl: 'data:image/png;base64,UE5HREFUQQ==', mime: 'image/png' })
  })
  it('rejects non-image files', async () => {
    const r = await loadImage({ kind: 'file', src: '/tmp/a.txt' }, deps())
    expect(r.ok).toBe(false)
  })
  it('rejects missing / non-file paths', async () => {
    const r = await loadImage({ kind: 'file', src: '/tmp/a.png' },
      deps({ stat: async () => ({ size: 1, isFile: () => false }) }))
    expect(r.ok).toBe(false)
  })
  it('rejects files over the size cap', async () => {
    const r = await loadImage({ kind: 'file', src: '/tmp/a.png' },
      deps({ stat: async () => ({ size: CAP + 1, isFile: () => true }) }))
    expect(r.ok).toBe(false)
  })
})

describe('loadImage (url)', () => {
  it('fetches an http(s) image and returns a data URL', async () => {
    const r = await loadImage({ kind: 'url', src: 'https://x.io/a.png' }, deps())
    expect(r).toEqual({ ok: true, dataUrl: 'data:image/png;base64,UE5HREFUQQ==', mime: 'image/png' })
  })
  it('rejects non-http(s) url schemes without fetching', async () => {
    const fetchUrl = vi.fn()
    const r = await loadImage({ kind: 'url', src: 'file:///etc/passwd' }, deps({ fetchUrl }))
    expect(r.ok).toBe(false)
    expect(fetchUrl).not.toHaveBeenCalled()
  })
  it('rejects non-image content types', async () => {
    const r = await loadImage({ kind: 'url', src: 'https://x.io/page' },
      deps({ fetchUrl: async () => ({ ok: true, contentType: 'text/html', bytes: Buffer.from('<html>') }) }))
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- preview.test.ts --run`
Expected: FAIL — cannot resolve `../../src/main/ipc/register-preview`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/ipc/register-preview.ts
import { ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { CH, type ImageSource, type ImageResult } from '@shared/ipc-contract'
import { imageExt } from '@shared/terminal-links'
import type { Disposer } from './types'

const CAP = 25 * 1024 * 1024

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon'
}

export function mimeForExt(ext: string): string { return MIME[ext.toLowerCase()] ?? 'application/octet-stream' }
export function toDataUrl(buf: Buffer, mime: string): string { return `data:${mime};base64,${buf.toString('base64')}` }

export interface LoadDeps {
  readFile(p: string): Promise<Buffer>
  stat(p: string): Promise<{ size: number; isFile(): boolean }>
  fetchUrl(u: string): Promise<{ ok: boolean; contentType: string | null; bytes: Buffer }>
  cap: number
}

/** Load an image from a local path or an http(s) URL, returning a base64 data URL (the renderer CSP
 *  is `img-src 'self' data:`, so remote images are never loaded directly by the renderer). All
 *  failures resolve to `{ ok:false, error }` — never throw across IPC. Side effects injected. */
export async function loadImage(req: ImageSource, deps: LoadDeps): Promise<ImageResult> {
  try {
    if (req.kind === 'url') {
      let proto = ''
      try { proto = new URL(req.src).protocol } catch { return { ok: false, error: 'Invalid URL' } }
      if (proto !== 'http:' && proto !== 'https:') return { ok: false, error: 'Only http(s) images can be loaded' }
      const res = await deps.fetchUrl(req.src)
      if (!res.ok) return { ok: false, error: 'Could not fetch image' }
      if (res.bytes.length > deps.cap) return { ok: false, error: 'Image too large' }
      const ct = (res.contentType ?? '').split(';')[0].trim().toLowerCase()
      const mime = ct.startsWith('image/') ? ct : (imageExt(req.src.split('?')[0]) ? mimeForExt(imageExt(req.src.split('?')[0])!) : '')
      if (!mime) return { ok: false, error: 'Not an image' }
      return { ok: true, dataUrl: toDataUrl(res.bytes, mime), mime }
    }
    const ext = imageExt(req.src)
    if (!ext) return { ok: false, error: 'Not an image file' }
    const st = await deps.stat(req.src)
    if (!st.isFile()) return { ok: false, error: 'File not found' }
    if (st.size > deps.cap) return { ok: false, error: 'Image too large' }
    const buf = await deps.readFile(req.src)
    const mime = mimeForExt(ext)
    return { ok: true, dataUrl: toDataUrl(buf, mime), mime }
  } catch {
    return { ok: false, error: 'Could not load image' }
  }
}

/** Default deps: real fs + global fetch. */
const realDeps: LoadDeps = {
  readFile: (p) => readFile(p),
  stat: async (p) => { const s = await stat(p); return { size: s.size, isFile: () => s.isFile() } },
  fetchUrl: async (u) => {
    const r = await fetch(u)
    const bytes = Buffer.from(await r.arrayBuffer())
    return { ok: r.ok, contentType: r.headers.get('content-type'), bytes }
  },
  cap: CAP
}

export function registerPreview(): Disposer {
  ipcMain.handle(CH.previewLoadImage, (_e, src: ImageSource) => loadImage(src, realDeps))
  return () => ipcMain.removeHandler(CH.previewLoadImage)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- preview.test.ts --run`
Expected: PASS (all cases).

- [ ] **Step 5: Wire into the composition root**

In `src/main/ipc/register.ts`:
- import: `import { registerPreview } from './register-preview'`
- add `registerPreview()` to the `disposers` array (alongside `registerFs(win, send)` etc.).

- [ ] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/register-preview.ts src/main/ipc/register.ts tests/main/preview.test.ts
git commit -m "feat(links): main handler to load images (file/url) as data URLs"
```

---

### Task 5: Renderer — preview store slice

**Files:**
- Create: `src/renderer/store/preview-slice.ts`
- Modify: `src/renderer/store/types.ts` (extend `State`)
- Modify: `src/renderer/store.ts` (compose the slice)

**Interfaces:**
- Consumes: `ImageSource`, `ImageResult` (Task 2); `api.previewLoadImage` (Task 2); `SliceDeps`, `State` (existing).
- Produces on `State`:
  - `preview: PreviewState` where `interface PreviewState { open: boolean; source?: ImageSource; status: 'loading' | 'ready' | 'error'; dataUrl?: string; error?: string }`
  - `openImagePreview(source: ImageSource): void`
  - `closeImagePreview(): void`

- [ ] **Step 1: Add types to `State`**

In `src/renderer/store/types.ts`:
- add the import (extend the existing `@shared/...` type imports): `import type { ImageSource } from '@shared/ipc-contract'`
- add this interface near the other small state interfaces (e.g. by `SettingsTarget`):

```ts
export interface PreviewState {
  open: boolean
  source?: ImageSource
  status: 'loading' | 'ready' | 'error'
  dataUrl?: string
  error?: string
}
```

- in `interface State { … }`, add:

```ts
  preview: PreviewState
  openImagePreview: (source: ImageSource) => void
  closeImagePreview: () => void
```

- [ ] **Step 2: Write the slice**

```ts
// src/renderer/store/preview-slice.ts
import type { State, SliceDeps, PreviewState } from './types'
import type { ImageSource } from '@shared/ipc-contract'
import { api } from '../api'

type PreviewSlice = Pick<State, 'preview' | 'openImagePreview' | 'closeImagePreview'>

const CLOSED: PreviewState = { open: false, status: 'loading' }

/** Lightbox state for clicked image links. `openImagePreview` shows the overlay immediately in a
 *  loading state, then fills in the data URL (or error) from main. A newer open supersedes an older
 *  in-flight load (we compare the resolved source) so a fast double-click can't render the wrong
 *  image. */
export function createPreviewSlice({ set, get }: SliceDeps): PreviewSlice {
  const sameSource = (a: ImageSource | undefined, b: ImageSource) => a?.kind === b.kind && a?.src === b.src
  return {
    preview: CLOSED,
    openImagePreview: (source) => {
      set({ preview: { open: true, source, status: 'loading', dataUrl: undefined, error: undefined } })
      void api.previewLoadImage(source).then(res => {
        if (!sameSource(get().preview.source, source) || !get().preview.open) return
        set(s => ({ preview: res.ok
          ? { ...s.preview, status: 'ready', dataUrl: res.dataUrl }
          : { ...s.preview, status: 'error', error: res.error } }))
      })
    },
    closeImagePreview: () => set({ preview: CLOSED })
  }
}
```

- [ ] **Step 3: Compose the slice in the store**

In `src/renderer/store.ts`:
- import: `import { createPreviewSlice } from './store/preview-slice'`
- in the returned object's `// ---- domain slices ----` block, add: `...createPreviewSlice(deps),`

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS — `State` is fully satisfied by the composed slices.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store/preview-slice.ts src/renderer/store/types.ts src/renderer/store.ts
git commit -m "feat(links): preview store slice for the image lightbox"
```

---

### Task 6: Renderer — ImageLightbox overlay

**Files:**
- Create: `src/renderer/components/ImageLightbox.tsx`
- Modify: `src/renderer/App.tsx` (mount it at root)

**Interfaces:**
- Consumes: `useStore` `preview` state + `closeImagePreview` (Task 5).
- Produces: `<ImageLightbox/>` (default-free named export). Test IDs: `image-lightbox`, `image-lightbox-img`, `image-lightbox-close`, `image-lightbox-error`.

- [ ] **Step 1: Write the component**

```tsx
// src/renderer/components/ImageLightbox.tsx
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'

/** Full-window image preview, portaled to <body> (so it escapes mosaic tiles, like Modal). Backdrop
 *  click and Esc close it; clicking the image toggles fit-to-window vs 100%. Driven by the `preview`
 *  store slice. Rendered once at the app root. */
export function ImageLightbox() {
  const preview = useStore(s => s.preview)
  const close = useStore(s => s.closeImagePreview)
  const [actualSize, setActualSize] = useState(false)

  useEffect(() => { if (!preview.open) setActualSize(false) }, [preview.open])
  useEffect(() => {
    if (!preview.open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview.open, close])

  if (!preview.open) return null

  const name = preview.source?.src ?? ''
  return createPortal(
    <div data-testid="image-lightbox" onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: '90vw', color: '#ddd', fontSize: 12 }}>
        <span title={name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <button data-testid="image-lightbox-close" onClick={e => { e.stopPropagation(); close() }}>Close</button>
      </div>
      {preview.status === 'loading' && <div style={{ color: '#ddd' }}>Loading…</div>}
      {preview.status === 'error' && (
        <div data-testid="image-lightbox-error" style={{ color: '#ff8888' }}>{preview.error ?? 'Could not load image'}</div>
      )}
      {preview.status === 'ready' && preview.dataUrl && (
        <img data-testid="image-lightbox-img" src={preview.dataUrl} alt={name}
          onClick={e => { e.stopPropagation(); setActualSize(v => !v) }}
          style={actualSize
            ? { maxWidth: 'none', maxHeight: 'none', cursor: 'zoom-out' }
            : { maxWidth: '90vw', maxHeight: '82vh', objectFit: 'contain', cursor: 'zoom-in' }} />
      )}
    </div>,
    document.body
  )
}
```

- [ ] **Step 2: Mount it at the app root**

In `src/renderer/App.tsx`:
- import: `import { ImageLightbox } from './components/ImageLightbox'`
- add `<ImageLightbox />` next to the other root overlays (e.g. right after `<Toasts />`).

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ImageLightbox.tsx src/renderer/App.tsx
git commit -m "feat(links): image lightbox overlay"
```

---

### Task 7: Renderer — xterm link wiring + TerminalPane integration

**Files:**
- Modify: `package.json` (add `@xterm/addon-web-links`)
- Create: `src/renderer/terminal/links.ts`
- Modify: `src/renderer/components/TerminalPane.tsx` (register + dispose)

**Interfaces:**
- Consumes: `Terminal`, `ILink`, `ILinkProvider`, `IDisposable` from `@xterm/xterm`; `WebLinksAddon` from `@xterm/addon-web-links`; `findImagePaths`, `isImageUrl`, `resolveImageSrc` (Task 1); `ImageSource` (Task 2).
- Produces:
  - `interface TerminalLinksOpts { isSsh: boolean; getCwd: () => string; getHome: () => string; openExternal: (url: string) => void; openImage: (src: ImageSource) => void }`
  - `registerTerminalLinks(term: Terminal, opts: TerminalLinksOpts): IDisposable`

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-exact @xterm/addon-web-links@0.11.0`
Expected: it's added to `package.json` dependencies. (Pure-JS addon — no `electron-rebuild` needed.)

- [ ] **Step 2: Write the wiring module**

```ts
// src/renderer/terminal/links.ts
import type { Terminal, ILink, ILinkProvider, IDisposable } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ImageSource } from '@shared/ipc-contract'
import { findImagePaths, isImageUrl, resolveImageSrc } from '@shared/terminal-links'

export interface TerminalLinksOpts {
  isSsh: boolean
  getCwd: () => string
  getHome: () => string
  openExternal: (url: string) => void
  openImage: (src: ImageSource) => void
}

const hasMod = (e: MouseEvent) => e.ctrlKey || e.metaKey

/** Wire clickable links into an xterm instance:
 *  - http(s) URLs via @xterm/addon-web-links (handles wrapping + hover underline); on Ctrl/Cmd+click
 *    an image URL opens the lightbox, any other URL opens the browser.
 *  - local image-file paths via a custom link provider (Ctrl/Cmd+click → lightbox). Disabled in SSH
 *    panes, where local-looking paths live on the remote and can't be read locally.
 *  Returns a disposer that tears down both. */
export function registerTerminalLinks(term: Terminal, opts: TerminalLinksOpts): IDisposable {
  const disposables: IDisposable[] = []

  const webLinks = new WebLinksAddon((event, uri) => {
    if (!hasMod(event)) return
    if (isImageUrl(uri)) opts.openImage({ kind: 'url', src: uri })
    else opts.openExternal(uri)
  })
  term.loadAddon(webLinks)
  disposables.push(webLinks)

  if (!opts.isSsh) {
    const provider: ILinkProvider = {
      provideLinks(bufferLineNumber, callback) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString(true)
        const links: ILink[] = findImagePaths(text).map(m => ({
          // xterm ranges are 1-based and inclusive of the end cell.
          range: { start: { x: m.start + 1, y: bufferLineNumber }, end: { x: m.end, y: bufferLineNumber } },
          text: m.text,
          activate: (event: MouseEvent, t: string) => {
            if (!hasMod(event)) return
            opts.openImage({ kind: 'file', src: resolveImageSrc(t, opts.getCwd(), opts.getHome()) })
          }
        }))
        callback(links.length ? links : undefined)
      }
    }
    disposables.push(term.registerLinkProvider(provider))
  }

  return { dispose: () => { for (const d of disposables) d.dispose() } }
}
```

- [ ] **Step 3: Integrate into TerminalPane**

In `src/renderer/components/TerminalPane.tsx`:

Add imports near the top (with the other local imports):
```ts
import { registerTerminalLinks } from '../terminal/links'
import { paneCwd } from '../store'
```

Right after the `registerRedrawer(paneId, redrawAction)` line (~line 133), add:
```ts
    // Clickable links: Ctrl/Cmd+click a URL to open it, or an image (path/url) to preview it.
    // Local-path detection is off for SSH panes (the file lives on the remote).
    const linksDisposer = registerTerminalLinks(term, {
      isSsh: config.launch?.command === 'ssh',
      getCwd: () => paneCwd(useStore.getState(), paneId) || config.cwd,
      getHome: () => useStore.getState().home,
      openExternal: (url) => api.openExternal(url),
      openImage: (src) => useStore.getState().openImagePreview(src)
    })
```

In the cleanup function (the `return () => { … }` block, ~line 172), add this line right before `term.dispose()`:
```ts
      linksDisposer.dispose()
```

> Note: `home` is the renderer store's cached home directory (`State.home`, set on `init` from `api.homeDir()`; `''` until then). It's used only for `~` expansion in `resolveImageSrc`.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (`State.home` exists; `paneCwd` is exported from `../store`).

- [ ] **Step 5: Build + sanity run**

Run: `npm run build`
Expected: build succeeds (the new addon resolves).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/renderer/terminal/links.ts src/renderer/components/TerminalPane.tsx
git commit -m "feat(links): wire clickable urls + image paths into the terminal"
```

---

### Task 8: e2e — click a local image path opens the lightbox

**Files:**
- Create: `tests/e2e/terminal-links.spec.ts`

**Interfaces:**
- Consumes: the running app (`out/`), the `image-lightbox*` test IDs (Task 6).

- [ ] **Step 1: Ensure a current build**

Run: `npm run build`
Expected: success (e2e runs against `out/`).

- [ ] **Step 2: Write the e2e test**

```ts
// tests/e2e/terminal-links.spec.ts
import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A 1x1 transparent PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

test('Ctrl+click a local image path opens the lightbox; Esc closes it', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-links-'))
  const imgPath = join(userData, 'pic.png')
  writeFileSync(imgPath, Buffer.from(PNG_B64, 'base64'))

  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Echo the absolute image path so it renders in the buffer, then click it with Ctrl held.
  await win.keyboard.type(`echo ${imgPath}`)
  await win.keyboard.press('Enter')
  const link = win.locator('.xterm-rows', { hasText: 'pic.png' })
  await expect(link).toBeVisible({ timeout: 15_000 })

  // The path text is its own link range; Ctrl+click on the rendered path location.
  await win.keyboard.down('Control')
  await win.getByText(imgPath, { exact: false }).last().click()
  await win.keyboard.up('Control')

  await expect(win.getByTestId('image-lightbox-img')).toBeVisible({ timeout: 15_000 })
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('image-lightbox')).toHaveCount(0)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 3: Run the e2e test**

Run: `npm run e2e -- terminal-links.spec.ts`
Expected: PASS. If the Ctrl+click target is flaky (xterm splits the path across spans), adjust the click to target the `.xterm-rows` text node containing the path; keep `Control` held across the click.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/terminal-links.spec.ts
git commit -m "test(links): e2e — local image path click opens the lightbox"
```

---

### Task 9: Docs + final verification

**Files:**
- Create: `docs/features/terminal-links.md`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md` ("Where things live" table — add a row)

- [ ] **Step 1: Write the feature doc**

Create `docs/features/terminal-links.md`:

```markdown
# Clickable terminal links + image preview

Ctrl/Cmd+click in any terminal (cmd, PowerShell, tmux, ssh, …) to:

- **Open a URL** — http(s) URLs open in the default browser (`shell:openExternal`, http(s) only).
- **Preview an image** — a referenced image opens in a lightbox overlay:
  - local file paths (resolved against the pane's tracked cwd; `~` against home), and
  - http(s) image URLs.

Detection runs on the rendered xterm buffer, so it is shell- and tmux-agnostic. Hovering a
link underlines it; only Ctrl/Cmd+click activates (plain click stays free for cursor positioning).

## How it works

- **URLs:** `@xterm/addon-web-links` finds http(s) URLs (handles wrapped lines). A custom handler
  routes image URLs to the lightbox and everything else to `shell:openExternal`.
- **Local image paths:** a custom xterm link provider over `findImagePaths` (`src/shared/terminal-links.ts`).
  Disabled in SSH panes — a local-looking path there lives on the remote and can't be read locally;
  image URLs still work.
- **Loading:** the renderer CSP is `img-src 'self' data:`, so main loads the bytes (file read or
  fetch) and returns a base64 data URL (`preview:loadImage`); the renderer never loads remote
  images directly (no CORS, no CSP loosening). 25 MiB cap.
- **Lightbox:** `ImageLightbox` portals to `<body>`; backdrop/Esc close; click toggles fit↔100%.

## Where things live

| Piece | Path |
|---|---|
| Detection/classification (pure) | `src/shared/terminal-links.ts` |
| xterm wiring | `src/renderer/terminal/links.ts` |
| Open URL (main) | `src/main/ipc/register-shell.ts` |
| Load image (main) | `src/main/ipc/register-preview.ts` |
| Lightbox state | `src/renderer/store/preview-slice.ts` |
| Lightbox UI | `src/renderer/components/ImageLightbox.tsx` |

## Non-goals (v1)

SCP-from-remote previews, auto-follow/auto-show, inline terminal thumbnails, zoom/pan beyond
fit↔100%, linkifying non-image local files, and paths containing spaces (unless quoted).
```

- [ ] **Step 2: Add a CHANGELOG entry**

In `CHANGELOG.md`, under the `## [Unreleased]` section, add to (or create) an `### Added` block:

```markdown
- **Clickable terminal links + image preview.** Ctrl/Cmd+click a URL in any terminal to open it in
  the browser, or a referenced image (local path or http(s) image URL) to preview it in a lightbox.
  Detection runs on the rendered buffer, so it works under cmd/PowerShell/tmux/ssh. Local-path
  previews are disabled in SSH panes (the file is on the remote); image URLs still work there.
```

- [ ] **Step 3: Add a row to CLAUDE.md "Where things live"**

In `CLAUDE.md`, in the "Where things live" table, add:

```markdown
| Terminal links / image preview | `src/shared/terminal-links.ts`, `src/renderer/terminal/links.ts`, `src/main/ipc/register-preview.ts` | [terminal-links](docs/features/terminal-links.md) |
```

- [ ] **Step 4: Full verification**

Run each and confirm:
- `npm run typecheck` → PASS
- `npm test -- --run` → all unit tests PASS (incl. `terminal-links`, `register-shell`, `preview`)
- `npm run build` → success
- `npm run e2e -- terminal-links.spec.ts redraw.spec.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add docs/features/terminal-links.md CHANGELOG.md CLAUDE.md
git commit -m "docs(links): feature doc + changelog for terminal links/image preview"
```

---

## Self-Review notes (author)

- **Spec coverage:** URLs→browser (Tasks 2,3,7); image URLs→lightbox (Tasks 2,4,7); local image paths→lightbox (Tasks 1,4,5,6,7); SSH gating (Task 7 `isSsh`); Ctrl/Cmd gating + hover underline (Task 7); lightbox overlay fit↔100%/Esc/backdrop (Task 6); main-loads-data-URL for CSP (Task 4); pure detection (Task 1); tests unit+e2e (Tasks 1,3,4,8); docs (Task 9). All covered.
- **Verified against codebase:** store exposes `State.home` (store.ts:113, types.ts:96) and re-exports `paneCwd` from `../store`; `register.ts` uses a `disposers` array + no-disposer registrars (both wiring styles used); `src/renderer/api.ts` is just `window.termhalla` (no per-method change needed). `@xterm/xterm` is 5.5 → `@xterm/addon-web-links` 0.11.
- **Type consistency:** `ImageSource`/`ImageResult` defined in Task 2 are used verbatim in Tasks 4,5,7; `loadImage`/`LoadDeps` in Task 4; `findImagePaths`/`resolveImageSrc`/`isImageUrl` signatures match Task 1 usage in Task 7.
```
