import { useEffect, useRef } from 'react'
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
  // firing only if no overlay remains by then — and ONLY if focus actually COLLAPSED out of the
  // removed overlay (activeElement fell to body/null). An overlay that deliberately restored focus
  // on close (the OrkyRootPicker's CONV-020 restore to its opener, the split compass's trigger
  // refocus) must never have it yanked into a terminal a microtask later (feature 0009,
  // FINDING-026) — the same collapsed-focus rule the restoring surfaces themselves use.
  useEffect(() => {
    openModals++
    return () => {
      openModals--
      void Promise.resolve().then(() => {
        if (openModals !== 0) return
        const el = document.activeElement
        if (el === null || el === document.body) useStore.getState().refocusActivePane()
      })
    }
  }, [])
  // On open, pull keyboard focus INTO the dialog — a modal opened over a focused terminal (e.g.
  // Settings via Ctrl+,) otherwise leaves focus in the xterm textarea, so typing keeps going to the
  // shell behind the scrim. Guarded: if a child already took focus (autoFocus inputs — the palette,
  // broadcast, env passphrase, SSH form — commit before this effect runs), never yank it.
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const card = cardRef.current
    if (card && !card.contains(document.activeElement)) card.focus()
  }, [])
  // Central keyboard contract every dialog inherits (QoL batch 2026-07-17 — 7 of ~11 modals had
  // no Escape path, and none trapped Tab, so focus could walk out of the card into the terminal
  // behind the scrim):
  //  - Escape closes, with keyboard parity to the backdrop click. A dialog that handles Escape
  //    itself (palette, capture modal) preventDefault()s first, so its semantics win — no
  //    double-close of a modal→modal handoff.
  //  - Tab wraps within the card (a minimal focus trap; Shift+Tab from the card itself or its
  //    first control wraps to the last).
  // Composed AFTER cardProps' own onKeyDown so per-dialog handlers run first.
  const onCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    cardProps?.onKeyDown?.(e)
    if (e.key === 'Escape') {
      if (!e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose() }
      return
    }
    if (e.key !== 'Tab' || e.defaultPrevented) return
    const el = cardRef.current
    if (!el) return
    const focusables = Array.from(el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ))
    if (focusables.length === 0) { e.preventDefault(); return }
    const first = focusables[0], last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }
  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, background: BACKDROP, zIndex: z,
    ...(align === 'center'
      ? { display: 'grid', placeItems: 'center' }
      : { display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' })
  }
  return createPortal(
    <div data-testid={backdropTestId} onClick={onClose} style={overlay}>
      <div data-testid={cardTestId} className="ui-pop-in" ref={cardRef} tabIndex={-1}
        onClick={e => e.stopPropagation()} {...cardProps} onKeyDown={onCardKeyDown}
        style={{ ...CARD_BASE, ...card, outline: 'none' }}>
        {children}
      </div>
    </div>,
    document.body
  )
}
