import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { useStore } from '../store'

/** How many Modal instances are currently mounted. Used so closing one dialog to open another
 *  (a modal→modal handoff) doesn't bounce focus to the terminal between them. */
let openModals = 0

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

/** Elevated-surface chrome shared by every floating surface that isn't a full Modal card:
 *  the in-tile proc/cwd popovers, the cloud-status popover, and dropdown menus. Spread it and
 *  add positioning/padding. Single source so the surface look changes in exactly one place. */
export const SURFACE: CSSProperties = {
  background: 'var(--elevated, #252526)', color: 'var(--fg-on-elevated, var(--fg, #eee))',
  border: '1px solid var(--border, #444)', borderRadius: 4,
  boxShadow: 'var(--shadow-pop)'
}

/** Base look of a modal card; per-dialog tweaks (width, padding, maxHeight) come via `card`. */
const CARD_BASE: CSSProperties = {
  ...SURFACE, borderRadius: 6, boxShadow: 'var(--shadow-modal)',
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
  // When the LAST dialog closes, put keyboard focus back on the active pane (so typing isn't
  // swallowed by a now-dead overlay — the "can't type while a toast is up" bug). Crucially, when one
  // dialog closes to open another (e.g. command palette → SSH form), both unmount/mount in the same
  // commit; refocusing the terminal here would steal focus from the new dialog's autoFocus and leave
  // the user unable to type into it. So count open modals and defer the refocus to a microtask,
  // firing only if no overlay remains by then.
  useEffect(() => {
    openModals++
    return () => {
      openModals--
      void Promise.resolve().then(() => { if (openModals === 0) useStore.getState().refocusActivePane() })
    }
  }, [])
  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, background: BACKDROP, zIndex: z,
    ...(align === 'center'
      ? { display: 'grid', placeItems: 'center' }
      : { display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' })
  }
  return createPortal(
    <div data-testid={backdropTestId} onClick={onClose} style={overlay}>
      <div data-testid={cardTestId} className="ui-pop-in" onClick={e => e.stopPropagation()} {...cardProps} style={{ ...CARD_BASE, ...card }}>
        {children}
      </div>
    </div>,
    document.body
  )
}
