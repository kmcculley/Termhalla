import { ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { CH, type ImageSource, type ImageResult } from '@shared/ipc-contract'
import { imageExt } from '@shared/terminal-links'
import type { Disposer } from './types'

const CAP = 25 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon'
}

export function mimeForExt(ext: string): string { return MIME[ext.toLowerCase()] ?? 'application/octet-stream' }
export function toDataUrl(buf: Buffer, mime: string): string { return `data:${mime};base64,${buf.toString('base64')}` }

export interface FetchedImage {
  ok: boolean
  contentType: string | null
  /** null when nothing usable was transferred (failure, or the cap tripped). */
  bytes: Buffer | null
  /** true when Content-Length or the streamed total exceeded the cap (transfer aborted). */
  tooLarge?: boolean
}

export interface LoadDeps {
  readFile(p: string): Promise<Buffer>
  stat(p: string): Promise<{ size: number; isFile(): boolean }>
  /** Must transfer at most ~`cap` bytes: abort (never buffer) past the cap. */
  fetchUrl(u: string, cap: number): Promise<FetchedImage>
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
      const res = await deps.fetchUrl(req.src, deps.cap)
      if (!res.ok) return { ok: false, error: 'Could not fetch image' }
      if (res.tooLarge === true || (res.bytes !== null && res.bytes.length > deps.cap)) {
        return { ok: false, error: 'Image too large' }
      }
      if (res.bytes === null) return { ok: false, error: 'Could not fetch image' }
      const ct = (res.contentType ?? '').split(';')[0].trim().toLowerCase()
      const urlExt = imageExt(req.src.split('#')[0].split('?')[0])
      const mime = ct.startsWith('image/') ? ct : (urlExt ? mimeForExt(urlExt) : '')
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

/** Stream a remote image with a hard byte cap and an overall timeout (2026-07-06 quality-audit
 *  Group B #6). The previous implementation buffered the ENTIRE body before checking the cap —
 *  a multi-GB "image" URL was fully downloaded into main-process memory — and had no timeout, so
 *  a stalling server left the renderer's invoke pending forever. Now: early-reject on a declared
 *  Content-Length above the cap, otherwise stream and abort the transfer the moment the running
 *  total crosses it. The timeout signal covers the whole transfer (headers AND body); its
 *  rejection surfaces through `loadImage`'s catch as the generic load failure. */
export async function fetchImageBytes(
  u: string, cap: number, fetchImpl: typeof fetch = fetch, timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<FetchedImage> {
  const r = await fetchImpl(u, { signal: AbortSignal.timeout(timeoutMs) })
  const contentType = r.headers.get('content-type')
  const cancelBody = async (): Promise<void> => {
    try { await r.body?.cancel() } catch { /* already closed/aborted */ }
  }
  if (!r.ok || r.body === null) {
    await cancelBody()
    return { ok: false, contentType, bytes: null }
  }
  const lenHeader = r.headers.get('content-length')
  const declared = lenHeader === null ? NaN : Number(lenHeader)
  if (Number.isFinite(declared) && declared > cap) {
    await cancelBody()
    return { ok: true, contentType, bytes: null, tooLarge: true }
  }
  const reader = r.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done || value === undefined) break
    total += value.byteLength
    if (total > cap) {
      try { await reader.cancel() } catch { /* aborted mid-transfer */ }
      return { ok: true, contentType, bytes: null, tooLarge: true }
    }
    chunks.push(Buffer.from(value))
  }
  return { ok: true, contentType, bytes: Buffer.concat(chunks) }
}

/** Default deps: real fs + the streaming capped fetch. */
const realDeps: LoadDeps = {
  readFile: (p) => readFile(p),
  stat: async (p) => { const s = await stat(p); return { size: s.size, isFile: () => s.isFile() } },
  fetchUrl: (u, cap) => fetchImageBytes(u, cap),
  cap: CAP
}

/** request/response handler; remove it on dispose. */
export function registerPreview(): Disposer {
  ipcMain.handle(CH.previewLoadImage, (_e, src: ImageSource) => loadImage(src, realDeps))
  return () => ipcMain.removeHandler(CH.previewLoadImage)
}
