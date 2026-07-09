import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore, paneCwd } from '../store'
import { domainAllowed, domainDisabledReason } from '../store/remote-gates'
import { MenuSurface } from './MenuSurface'
import { Z } from './Modal'
import type { SplitDir4 } from '@shared/types'

type Kind = 'terminal' | 'editor' | 'explorer' | 'orky'

const DIR_LABEL: Record<SplitDir4, string> = {
  up: 'Split up', down: 'Split down', left: 'Split left', right: 'Split right'
}
const DIR_GLYPH: Record<SplitDir4, string> = { up: '▲', down: '▼', left: '◀', right: '▶' }
const KIND_LABEL: Record<Kind, string> = { terminal: 'Terminal', editor: 'Editor', explorer: 'Explorer', orky: 'Orky' }

// Estimated popover box (compass grid + 4 kind buttons + padding/gaps). Used only to clamp/flip the
// anchor into the viewport; a few px of drift here just shifts the popover, never clips it.
const EST_W = 168
const EST_H = 228

/** Combined split popover: a four-direction compass (up/left/right/down) plus a Terminal/Editor/
 *  Explorer kind selector. Opening commits nothing; picking a kind sets the selection; activating a
 *  direction (click or keyboard) commits a split of that kind in that direction, then closes.
 *
 *  Portalled to <body> (like PaneContextMenu/Modal): a position-ed child of a react-mosaic tile is
 *  clipped/mis-stacked by the tile's transform. The compass is fully keyboard-operable via a roving
 *  tabindex — focus opens on the right ▶ target (the visibly highlighted default); arrow keys move
 *  it; Enter/Space (native button activation) commits the focused direction; Esc dismisses without
 *  splitting. Tab is trapped within the popover and on close focus returns to the split trigger. */
export function SplitMenu(
  { wsId, paneId, onClose }: { wsId: string; paneId: string; onClose: () => void }
) {
  const addTerminal = useStore(s => s.addTerminal)
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)
  const addOrky = useStore(s => s.addOrky)
  const pickOrkyRoot = useStore(s => s.pickOrkyRoot)
  // The orky kind is only offerable when the held registry snapshot has a member (the explorer/cwd
  // disabled precedent — feature 0009, REQ-004c); a null (not-yet-settled) snapshot disables too.
  const hasOrkyMember = useStore(s => (s.registrySnapshot?.length ?? 0) > 0)
  // The disabled button's accessible name MUST distinguish its two causes (FINDING-027, amended
  // decision #4c): while the snapshot has NOT settled (the slice's derived-loading rule —
  // registrySnapshot === null with no held error) the name is the LOADING wording, mirroring the
  // picker's own loading state; ONLY a genuinely-held [] snapshot gets the genuinely-empty wording
  // — a user WITH tracked projects is never told none exist during the startup window. A held
  // registry error (no snapshot) names that third state rather than mis-describing either.
  const registryLoading = useStore(s => s.registrySnapshot === null && s.registryError === null)
  const registryFailed = useStore(s => s.registrySnapshot === null && s.registryError !== null)
  const orkyReason = registryLoading
    ? 'waiting: tracked Orky projects are still loading…'
    : registryFailed
      ? 'disabled: the tracked Orky projects could not be read'
      : 'disabled: no tracked Orky project yet — open a terminal in a project containing .orky/ to track one'
  const orkyDisabledName = `Orky (${orkyReason})`
  const cwd = useStore(s => paneCwd(s, paneId))
  // Remote capability gates (feature 0022, REQ-017): editor/explorer ride the fs domain, the orky
  // kind rides the orky domain — in a remote-home workspace they are DISABLED (not hidden) with an
  // actionable reason until the agent advertises the domain (v1 advertises pty+status only).
  const fsAllowed = useStore(s => domainAllowed(s, wsId, 'fs'))
  const orkyDomainAllowed = useStore(s => domainAllowed(s, wsId, 'orky'))
  const fsReason = useStore(s => fsAllowed ? '' : domainDisabledReason(s, wsId, 'fs'))
  const orkyDomainReason = useStore(s => orkyDomainAllowed ? '' : domainDisabledReason(s, wsId, 'orky'))
  const [kind, setKind] = useState<Kind>('terminal')
  // The visibly highlighted / roving-tabindex direction. Defaults to right (today's primary). Tracked
  // in state so the highlight is painted regardless of pointer-vs-keyboard (programmatic .focus() does
  // not match :focus-visible on a mouse-opened popover).
  const [active, setActive] = useState<SplitDir4>('right')
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const dirRefs = useRef<Partial<Record<SplitDir4, HTMLButtonElement | null>>>({})
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // Anchor the portalled popover under the source pane's split button (which lives inside the tile),
  // clamping/flipping BOTH axes so the whole popover stays on-screen even for a bottom-row pane.
  useLayoutEffect(() => {
    // Escape the pane id (the OrkyPopover FINDING-SEC-005 posture, applied here per 0002
    // FINDING-SEC-001): a CSS-reserved char in the id would throw a DOMException out of this
    // effect and blank the popover. No reliance on the UUID invariant.
    const btn = document.querySelector(`[data-testid="split-${CSS.escape(paneId)}"]`) as HTMLElement | null
    triggerRef.current = btn
    const r = btn?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(4, Math.min(r.right - EST_W, window.innerWidth - EST_W - 4))
    let top = r.bottom + 4
    if (top + EST_H > window.innerHeight) {
      const above = r.top - EST_H - 4
      top = above >= 4 ? above : Math.max(4, window.innerHeight - EST_H - 4)
    }
    setPos({ left, top })
  }, [paneId])

  // Default focus / highlight = the active (right) target, via roving tabindex.
  useEffect(() => { dirRefs.current[active]?.focus() }, [pos]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close: restore focus to the split trigger that opened the popover, then drop the menu (cancel,
  // Esc, click-away, and commit all route through here so the keyboard user is never stranded).
  const close = () => { triggerRef.current?.focus(); onClose() }

  const commit = (dir: SplitDir4) => {
    if (kind === 'terminal') addTerminal(wsId, paneId, 'row', dir)
    else if (kind === 'editor') addEditor(wsId, paneId, 'row', dir)
    else if (kind === 'orky') {
      // Feature 0009 (REQ-004c): a direction activation closes the compass and opens the SAME
      // root picker as every other creation affordance; selecting a root commits the directional
      // split with that root VERBATIM, cancel commits nothing.
      close()
      void pickOrkyRoot().then(root => { if (root) addOrky(wsId, paneId, 'row', root, dir) })
      return
    }
    else if (cwd) addExplorer(wsId, paneId, 'row', cwd, dir)
    close()
  }

  // Container-level keys: Tab is trapped so focus cannot escape behind the click-away overlay.
  // (Escape lives on the shared MenuSurface, routed to `close` so focus still returns to the trigger.)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const root = popoverRef.current
    if (!root) return
    const focusables = Array.from(root.querySelectorAll<HTMLElement>('button'))
      .filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1)
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const act = document.activeElement
    if (e.shiftKey && act === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus() }
  }

  // Arrow handling is scoped to the compass group so the kind toggle-buttons keep native keyboard
  // behavior (Tab/Space) — the container no longer hijacks every arrow key.
  const onCompassKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, SplitDir4> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'
    }
    const d = map[e.key]
    if (d) { e.preventDefault(); setActive(d); dirRefs.current[d]?.focus() }
  }

  const dirButton = (d: SplitDir4, gridArea: string) => (
    <button key={d} ref={el => { dirRefs.current[d] = el }} type="button"
      data-testid={`split-dir-${d}-${paneId}`} aria-label={DIR_LABEL[d]}
      data-active={d === active ? '' : undefined}
      tabIndex={d === active ? 0 : -1}
      onClick={() => commit(d)}
      style={{
        gridArea, width: 28, height: 28, ...PAINT,
        ...(d === active
          ? { background: 'rgba(30, 136, 229, 0.35)', borderColor: 'var(--accent, #1e88e5)' }
          : null)
      }}>{DIR_GLYPH[d]}</button>
  )

  const remoteGated = (k: Kind): boolean =>
    ((k === 'editor' || k === 'explorer') && !fsAllowed) || (k === 'orky' && !orkyDomainAllowed)
  const remoteReason = (k: Kind): string => (k === 'orky' ? orkyDomainReason : fsReason)
  // EVERY disabled cause carries a reason, in both the accessible name and the hover title —
  // the explorer's no-cwd disable used to be a bare greyed button (FINDING-UX-005): nothing told
  // the user it just needs a pane with a known working directory.
  const explorerNoCwdReason = 'needs a folder — this pane has no known working directory yet'
  const localReason = (k: Kind): string =>
    k === 'explorer' && !cwd ? explorerNoCwdReason
      : k === 'orky' && !hasOrkyMember ? orkyReason
        : ''
  const kindButton = (k: Kind) => (
    <button key={k} type="button" data-testid={`split-kind-${k}-${paneId}`}
      aria-pressed={kind === k}
      aria-label={remoteGated(k) ? `${KIND_LABEL[k]} (disabled: ${remoteReason(k)})`
        : k === 'orky' && !hasOrkyMember ? orkyDisabledName
          : k === 'explorer' && !cwd ? `Explorer (disabled: ${explorerNoCwdReason})`
            : KIND_LABEL[k]}
      title={remoteGated(k) ? remoteReason(k) : (localReason(k) || undefined)}
      disabled={remoteGated(k) || (k === 'explorer' && !cwd) || (k === 'orky' && !hasOrkyMember)}
      onClick={() => setKind(k)}
      style={{
        ...PAINT, fontWeight: kind === k ? 700 : 400, opacity: kind === k ? 1 : 0.7,
        ...(kind === k ? { background: 'rgba(30, 136, 229, 0.25)', borderColor: 'var(--accent, #1e88e5)' } : null)
      }}>
      {KIND_LABEL[k]}</button>
  )

  if (!pos) return null
  // portal: the popover opens from a pane toolbar inside a react-mosaic tile (the MenuSurface
  // containing-block gotcha). Escape/click-away both route through `close` (focus restore).
  return (
    <MenuSurface testid="split-menu" onClose={close} portal zIndex={Z.popover}
      surfaceRef={popoverRef} onKeyDown={onKeyDown}
      style={{ left: pos.left, top: pos.top, padding: 6, gap: 6, minWidth: 156 }}>
      <div role="group" aria-label="Split direction" onKeyDown={onCompassKeyDown}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 28px)', gridTemplateRows: 'repeat(3, 28px)',
          gap: 2, justifyContent: 'center' }}>
        {dirButton('up', '1 / 2 / 2 / 3')}
        {dirButton('left', '2 / 1 / 3 / 2')}
        {dirButton('right', '2 / 3 / 3 / 4')}
        {dirButton('down', '3 / 2 / 4 / 3')}
      </div>
      <div role="group" aria-label="Split kind"
        style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {kindButton('terminal')}
        {kindButton('editor')}
        {kindButton('explorer')}
        {kindButton('orky')}
      </div>
    </MenuSurface>
  )
}

// Paint-only chrome (background/color/border-radius) — scoped to this popover's own elements, never
// reaching editor-tabs children or Monaco/xterm hosts (the sibling-box gotcha).
const PAINT: React.CSSProperties = {
  background: 'transparent', color: 'inherit', borderRadius: 4,
  border: '1px solid var(--border, #3a3a3a)', cursor: 'pointer'
}
