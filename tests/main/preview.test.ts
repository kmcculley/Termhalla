import { describe, it, expect, vi } from 'vitest'
import { mimeForExt, toDataUrl, loadImage, fetchImageBytes, type LoadDeps } from '../../src/main/ipc/register-preview'

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

  // 2026-07-06 quality-audit Group B #6: the cap must reach the transfer, not just post-buffer.
  it('passes the cap through to fetchUrl', async () => {
    const fetchUrl = vi.fn(async () => ({ ok: true, contentType: 'image/png', bytes: Buffer.from('PNGDATA') }))
    await loadImage({ kind: 'url', src: 'https://x.io/a.png' }, deps({ fetchUrl }))
    expect(fetchUrl).toHaveBeenCalledWith('https://x.io/a.png', CAP)
  })
  it('maps a tooLarge fetch result to "Image too large"', async () => {
    const r = await loadImage({ kind: 'url', src: 'https://x.io/big.png' },
      deps({ fetchUrl: async () => ({ ok: true, contentType: 'image/png', bytes: null, tooLarge: true }) }))
    expect(r).toEqual({ ok: false, error: 'Image too large' })
  })
  it('treats a null-bytes result without tooLarge as a fetch failure', async () => {
    const r = await loadImage({ kind: 'url', src: 'https://x.io/a.png' },
      deps({ fetchUrl: async () => ({ ok: true, contentType: 'image/png', bytes: null }) }))
    expect(r).toEqual({ ok: false, error: 'Could not fetch image' })
  })
})

// The streaming transfer itself (Group B #6): early Content-Length reject, mid-stream abort the
// moment the total crosses the cap (never buffering a multi-GB body), overall timeout wired to
// the fetch signal so a stalling server can't leave the invoke pending forever.
describe('fetchImageBytes (streaming cap + timeout)', () => {
  const mkResponse = (
    chunks: Uint8Array[], headers: Record<string, string>, onCancel?: () => void, status = 200
  ): Response => {
    let i = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++])
        else controller.close()
      },
      cancel() { onCancel?.() }
    })
    return new Response(stream, { status, headers })
  }
  const asFetch = (r: Response): typeof fetch => (async () => r) as typeof fetch

  it('accumulates a body under the cap', async () => {
    const res = await fetchImageBytes('https://x.io/a.png', 100,
      asFetch(mkResponse([Buffer.from('PNG'), Buffer.from('DATA')], { 'content-type': 'image/png' })))
    expect(res).toEqual({ ok: true, contentType: 'image/png', bytes: Buffer.from('PNGDATA') })
  })

  it('early-rejects on a Content-Length above the cap without reading the body', async () => {
    let cancelled = false
    const res = await fetchImageBytes('https://x.io/big.png', 100,
      asFetch(mkResponse([Buffer.alloc(64)], { 'content-type': 'image/png', 'content-length': '101' }, () => { cancelled = true })))
    expect(res).toEqual({ ok: true, contentType: 'image/png', bytes: null, tooLarge: true })
    expect(cancelled).toBe(true)
  })

  it('aborts mid-stream once the total crosses the cap (no Content-Length declared)', async () => {
    let cancelled = false
    const chunks = Array.from({ length: 10 }, () => new Uint8Array(40))
    const res = await fetchImageBytes('https://x.io/big.png', 100,
      asFetch(mkResponse(chunks, { 'content-type': 'image/png' }, () => { cancelled = true })))
    expect(res).toEqual({ ok: true, contentType: 'image/png', bytes: null, tooLarge: true })
    expect(cancelled).toBe(true)
  })

  it('a non-ok status is a fetch failure', async () => {
    const res = await fetchImageBytes('https://x.io/a.png', 100,
      asFetch(mkResponse([Buffer.from('nope')], { 'content-type': 'text/plain' }, undefined, 500)))
    expect(res.ok).toBe(false)
    expect(res.bytes).toBeNull()
  })

  it('wires the timeout into the fetch signal so a stalling server rejects', async () => {
    const never: typeof fetch = ((_u: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('stall-aborted')))
      })) as typeof fetch
    await expect(fetchImageBytes('https://x.io/a.png', 100, never, 20)).rejects.toThrow('stall-aborted')
  })
})
