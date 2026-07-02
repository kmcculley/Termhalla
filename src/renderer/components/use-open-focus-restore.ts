// CONV-020's open/close focus contract as ONE shared implementation (feature 0009, FINDING-019):
// on open, capture the previously focused element and move keyboard focus INTO the surface (the
// open half — a keyboard open must not strand focus in an xterm pane that eats Tab); on close,
// restore focus ONLY when it actually collapsed out of the removed surface (activeElement fell to
// body/null) — never yanking it from somewhere the user (or a closing flow) intentionally focused
// meanwhile (the close half). Born from 0006's FINDING-010/FINDING-023; previously duplicated
// line-for-line in DecisionQueuePanel and OrkyRootPicker.
import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * @param focusTarget the element to focus on open (a close button, a listbox container).
 * @param fallbackSelector queried on close ONLY when the captured opener no longer exists in the
 *   document (e.g. the drawer's toggle button); omit to restore to the captured opener or nothing.
 */
export function useOpenFocusRestore(
  focusTarget: RefObject<HTMLElement | null>,
  fallbackSelector?: string
): void {
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    focusTarget.current?.focus()
    return () => {
      const collapsed = document.activeElement === null || document.activeElement === document.body
      if (!collapsed) return // focus is somewhere intentional — never yank it (CONV-020)
      const target = prev && document.contains(prev)
        ? prev
        : fallbackSelector ? document.querySelector<HTMLElement>(fallbackSelector) : null
      target?.focus()
    }
    // Wired once on mount, torn down on unmount — the open/close pair by definition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
