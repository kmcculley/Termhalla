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
