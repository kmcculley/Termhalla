import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { OrkyPaneStatus, OrkyFeatureStatus } from '@shared/types'
import { Z, SURFACE } from './Modal'

const EST_W = 320
const EST_H = 240

/** The Orky detail popover: lists every non-Idle feature in the roll-up (already ranked by the
 *  REQ-007 selector order), each with its phase, gate N/M, open-blocking count, and needs-you reason.
 *
 *  Portalled to <body> (like SplitMenu / PaneContextMenu): a position-ed child of a react-mosaic tile
 *  is clipped/mis-stacked by the tile's transform, so a richer popover MUST escape the tile. Anchored
 *  under the source pane's Orky chip. Paint-only chrome; its `orky-menu` testid is in the index.css
 *  focus-visible/hover allow-lists (CONV-007). */
export function OrkyPopover(
  { paneId, status, onClose }: { paneId: string; status: OrkyPaneStatus; onClose: () => void }
) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    // Escape the pane id (REQ-026 / FINDING-SEC-005): a CSS-reserved char (`"`, `]`, `\`, …) in the id
    // would throw a DOMException out of this effect and blank the popover. No reliance on the UUID invariant.
    const btn = document.querySelector(`[data-testid="orky-chip-${CSS.escape(paneId)}"]`) as HTMLElement | null
    const r = btn?.getBoundingClientRect()
    if (!r) { setPos({ left: 8, top: 40 }); return }
    const left = Math.max(4, Math.min(r.left, window.innerWidth - EST_W - 4))
    let top = r.bottom + 4
    if (top + EST_H > window.innerHeight) top = Math.max(4, r.top - EST_H - 4)
    setPos({ left, top })
  }, [paneId])

  if (!pos) return null
  return createPortal(
    <>
      <div onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }}
        style={{ position: 'fixed', inset: 0, zIndex: Z.popover }} />
      <div data-testid="orky-menu" onClick={e => e.stopPropagation()}
        style={{ ...SURFACE, position: 'fixed', left: pos.left, top: pos.top, zIndex: Z.popover + 1,
          padding: 8, maxWidth: EST_W, minWidth: 220, fontSize: 12, fontFamily: 'var(--mono)',
          display: 'flex', flexDirection: 'column', gap: 6 }}>
        {status.features.length === 0
          ? <div style={{ color: 'var(--fg-dim, #aaa)' }}>No active Orky features</div>
          : status.features.map(f => <OrkyFeatureRow key={f.feature} f={f} />)}
      </div>
    </>,
    document.body
  )
}

function OrkyFeatureRow({ f }: { f: OrkyFeatureStatus }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{f.feature}</strong>
        <span style={{ color: 'var(--fg-dim, #aaa)' }}>{f.phase ?? 'done'} · {f.gateN}/{f.gateM}</span>
      </div>
      <div style={{ color: 'var(--fg-dim, #aaa)' }}>
        {f.openBlocking > 0 ? `●${f.openBlocking} open · ` : ''}{f.detail}
      </div>
    </div>
  )
}
