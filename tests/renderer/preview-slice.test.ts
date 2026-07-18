// 2026-07-17 whole-project quality audit, Finding 24a: openImagePreview had no rejection path —
// `void api.previewLoadImage(source).then(...)` with no .catch, so a rejected invoke (handler
// throw, window teardown) left the lightbox stuck on status:'loading' forever plus an unhandled
// rejection. The fix applies the SAME source-guarded transition the .then uses (only if the
// preview is still open on the same source) to status:'error'.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../../src/renderer/api', () => ({ api: { previewLoadImage: vi.fn() } }))
import { createPreviewSlice } from '../../src/renderer/store/preview-slice'
import { api } from '../../src/renderer/api'
import type { ImageSource } from '@shared/ipc-contract'

const load = vi.mocked(api.previewLoadImage)
const tick = () => new Promise<void>(r => setTimeout(r))

const SRC: ImageSource = { kind: 'file', src: 'C:/pics/a.png' }
const OTHER: ImageSource = { kind: 'file', src: 'C:/pics/b.png' }

function harness() {
  let state: ReturnType<typeof createPreviewSlice>
  const set = (patch: unknown) => {
    state = { ...state, ...(typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch as object) }
  }
  const get = () => state
  state = createPreviewSlice({ set, get } as never)
  return { get }
}

beforeEach(() => { load.mockReset() })

describe('preview slice — openImagePreview', () => {
  it('shows the overlay immediately in a loading state, then fills in the data URL', async () => {
    load.mockResolvedValueOnce({ ok: true, dataUrl: 'data:image/png;base64,x' })
    const { get } = harness()
    get().openImagePreview(SRC)
    expect(get().preview).toMatchObject({ open: true, source: SRC, status: 'loading' })
    await tick()
    expect(get().preview).toMatchObject({ open: true, status: 'ready', dataUrl: 'data:image/png;base64,x' })
  })

  it('a main-reported failure transitions to the error state', async () => {
    load.mockResolvedValueOnce({ ok: false, error: 'not an image' })
    const { get } = harness()
    get().openImagePreview(SRC)
    await tick()
    expect(get().preview).toMatchObject({ open: true, status: 'error', error: 'not an image' })
  })

  it('a REJECTED invoke transitions to the error state instead of loading-forever (audit Finding 24a)', async () => {
    load.mockRejectedValueOnce(new Error('ipc torn down'))
    const { get } = harness()
    get().openImagePreview(SRC)
    await tick()
    expect(get().preview.status, 'a rejected invoke must not strand the lightbox on loading').toBe('error')
    expect(get().preview.error).toContain('ipc torn down')
    expect(get().preview.open).toBe(true)
  })

  it('a rejection landing AFTER close leaves the closed state untouched (the same source guard as the .then)', async () => {
    let reject!: (e: unknown) => void
    load.mockReturnValueOnce(new Promise((_res, rej) => { reject = rej }) as never)
    const { get } = harness()
    get().openImagePreview(SRC)
    get().closeImagePreview()
    reject(new Error('late'))
    await tick()
    expect(get().preview.open).toBe(false)
    expect(get().preview.status).toBe('loading') // the CLOSED sentinel, not a stray error
  })

  it('a rejection of a SUPERSEDED load cannot clobber the newer open (source-guarded)', async () => {
    let reject!: (e: unknown) => void
    load.mockReturnValueOnce(new Promise((_res, rej) => { reject = rej }) as never)
    load.mockReturnValueOnce(new Promise(() => {}) as never) // the newer load stays in flight
    const { get } = harness()
    get().openImagePreview(SRC)
    get().openImagePreview(OTHER)
    reject(new Error('old one died'))
    await tick()
    expect(get().preview).toMatchObject({ open: true, source: OTHER, status: 'loading' })
  })
})
