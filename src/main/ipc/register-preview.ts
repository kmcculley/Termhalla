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

/** request/response handler; remove it on dispose. */
export function registerPreview(): Disposer {
  ipcMain.handle(CH.previewLoadImage, (_e, src: ImageSource) => loadImage(src, realDeps))
  return () => ipcMain.removeHandler(CH.previewLoadImage)
}
