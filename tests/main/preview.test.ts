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
