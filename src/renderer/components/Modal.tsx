import { createPortal } from 'react-dom'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

/** Single source of truth for overlay stacking. Higher = closer to the user.
 *  Centralizes what used to be ad-hoc magic z-index literals scattered across dialogs. */
export const Z = {
  popover: 10,      // in-tile popovers (proc / cwd menus) rendered inside a mosaic tile
  menu: 40,         // dropdown menus and their click-catcher backdrops
  dialog: 60,       // centered modal dialogs (broadcast, schedule, env, theme)
  palette: 1000,    // command palette
  paletteForm: 1100 // forms opened from the palette (ssh connection)
} as const

/** Shared scrim color for every modal backdrop. */
const BACKDROP = '#0008'

/** Base look of a modal card; per-dialog tweaks (width, padding, maxHeight) come via `card`. */
const CARD_BASE: CSSProperties = {
  background: 'var(--elevated, #252526)', color: 'var(--fg, #eee)',
  border: '1px solid var(--border, #444)', borderRadius: 6,
  display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--font-size, 13px)'
}

interface ModalProps {
  onClose: () => void
  /** Centered (dialogs) or pinned near the top (palette-style). */
  align?: 'center' | 'top'
  z?: number
  backdropTestId?: string
  cardTestId?: string
  /** Style overrides merged over CARD_BASE (e.g. `{ width: 480, padding: 14 }`). */
  card?: CSSProperties
  /** Extra props for the card element (role/aria/onKeyDown). data-testid is stripped via cardTestId. */
  cardProps?: HTMLAttributes<HTMLDivElement>
  children: ReactNode
}

/** Portal-to-<body> modal: a full-viewport backdrop that closes on outside click, wrapping a
 *  card that stops propagation. Portalling escapes the mosaic tiles' transform containing block,
 *  which would otherwise confine a `position: fixed` overlay to one tile. */
export function Modal({ onClose, align = 'center', z = Z.dialog, backdropTestId, cardTestId, card, cardProps, children }: ModalProps) {
  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, background: BACKDROP, zIndex: z,
    ...(align === 'center'
      ? { display: 'grid', placeItems: 'center' }
      : { display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' })
  }
  return createPortal(
    <div data-testid={backdropTestId} onClick={onClose} style={overlay}>
      <div data-testid={cardTestId} onClick={e => e.stopPropagation()} {...cardProps} style={{ ...CARD_BASE, ...card }}>
        {children}
      </div>
    </div>,
    document.body
  )
}
