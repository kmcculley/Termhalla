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
