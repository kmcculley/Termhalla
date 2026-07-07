import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Z, SURFACE } from './Modal'

/** The ONE popover/menu chrome (2026-07-06 quality audit, Group C #10). Owns the semantics every
 *  hand-rolled copy had drifted on:
 *   - a full-viewport click-catcher backdrop — left OR right click outside dismisses (right-click
 *    is prevented so the browser menu never opens over the backdrop);
 *   - Escape dismisses (the audit gap: only 2 of 6 menus had keyboard parity with the backdrop —
 *     without it the invisible click-catcher survives a keyboard dismiss and silently swallows
 *     the next click);
 *   - the shared SURFACE box, `position: fixed`, stacked one above its own backdrop;
 *   - `portal`: REQUIRED for any menu opened from inside a react-mosaic tile — a `position: fixed`
 *     child of a tile is positioned/clipped relative to the tile (its transform is a containing
 *     block) and stacks under the tile toolbar (the CLAUDE.md gotcha; see Modal.tsx). Chrome-level
 *     menus (tab strip) may render in place.
 *
 *  Clicks inside the surface never reach the backdrop (it is a sibling, not an ancestor), and
 *  their React-tree propagation is stopped so a menu click can't co-trigger whatever chrome the
 *  menu was opened from. Position the surface via `style` (left/top or anchor-computed); padding,
 *  gap, sizing and font also ride `style` so each menu keeps its exact existing look. */
export function MenuSurface(
  { testid, onClose, portal = false, zIndex = Z.menu, style, onKeyDown, surfaceRef, children }: {
    testid: string
    onClose: () => void
    portal?: boolean
    zIndex?: number
    style?: React.CSSProperties
    onKeyDown?: (e: React.KeyboardEvent) => void
    surfaceRef?: React.Ref<HTMLDivElement>
    children: React.ReactNode
  }
) {
  // Keyboard parity with the click-outside backdrop. Window-level: the menus are not focus-trapped
  // (except SplitMenu, which traps Tab itself), so focus may sit anywhere when Escape is pressed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const body = (
    <>
      <div onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }}
        style={{ position: 'fixed', inset: 0, zIndex }} />
      <div ref={surfaceRef} data-testid={testid} onKeyDown={onKeyDown} onClick={e => e.stopPropagation()}
        style={{ ...SURFACE, position: 'fixed', zIndex: zIndex + 1, display: 'flex', flexDirection: 'column', ...style }}>
        {children}
      </div>
    </>
  )
  return portal ? createPortal(body, document.body) : body
}
