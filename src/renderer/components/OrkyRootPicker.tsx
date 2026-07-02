import { useRef, useState } from 'react'
import { Modal, Z } from './Modal'
import { useRegistryLoadState } from './use-registry-load-state'
import { useOpenFocusRestore } from './use-open-focus-restore'

/**
 * Tracked-root picker chrome for the native OrkyPane (feature 0009, TASK-009 — REQ-004/REQ-011/
 * REQ-018). ONE component serves every flow: the three creation affordances (palette, add-pane
 * select, split compass — routed through the store's pickOrkyRoot request) AND the unbound state's
 * re-bind affordance — never a forked copy.
 *
 * It lists exactly the member roots of the renderer's HELD registry snapshot — the F5 read surface
 * App.tsx already subscribes app-level. No second snapshot subscription, no persisted-list pull,
 * no mutation call. FOUR mutually-distinct states (FINDING-009):
 *   loading — while `registrySnapshot === null && registryError === null` (the slice's DERIVED
 *             loading rule, registry-slice.ts) — never the empty copy;
 *   error   — a held `registryError` with no snapshot, surfaced VERBATIM (CONV-001);
 *   empty   — ONLY a genuinely-held `[]` snapshot, with actionable how-roots-become-tracked copy;
 *   list    — the member roots, arrow/Enter selectable.
 * Cancel (Escape / backdrop / the Cancel button) commits nothing in every state.
 *
 * CONV-020 focus contract: the picker takes focus on open; on close it restores focus to the
 * opener ONLY when focus actually collapsed out of the removed picker — never yanking it from a
 * surface the user intentionally focused meanwhile. CONV-007: as body-portalled chrome it carries
 * its own :focus-visible styling (index.css orky allow-list).
 */
export function OrkyRootPicker(
  { onSelect, onCancel }: { onSelect: (root: string) => void; onCancel: () => void }
) {
  // The shared load-state derivation + CONV-020 focus contract (FINDING-019 — one implementation,
  // shared with DecisionQueuePanel, never a hand-maintained copy).
  const { registrySnapshot, registryError, loading, failed } = useRegistryLoadState()
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useOpenFocusRestore(listRef)

  const memberRoots = (registrySnapshot ?? [])
    .map(e => (e && typeof e.root === 'string' ? e.root : ''))
    .filter(r => r.length > 0)
  const empty = registrySnapshot !== null && memberRoots.length === 0

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }
    // Target guard (REQ-004/REQ-018, FINDING-023): the selection keys act ONLY while the listbox
    // container itself holds focus. A Tab-focused nested control (the Cancel button, an option
    // button) keeps its NATIVE activation — Enter on Cancel cancels, Enter on an option commits
    // THAT option — never swallowed or redirected to the sel-highlighted default. Escape stays
    // dialog-wide above.
    if (e.target !== listRef.current) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, Math.max(memberRoots.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const root = memberRoots[Math.min(sel, Math.max(memberRoots.length - 1, 0))]
      if (root) onSelect(root)
    }
  }

  return (
    <Modal onClose={onCancel} z={Z.palette}
      backdropTestId="orky-root-picker-backdrop"
      card={{ width: 480, maxHeight: '60vh', padding: 10 }}>
      <div data-testid="orky-root-picker" role="dialog" aria-modal="true"
        aria-label="Bind Orky pane to a tracked project" onKeyDown={onKeyDown}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>Bind to a tracked Orky project</div>
      <div ref={listRef} tabIndex={0} role="listbox" aria-label="Tracked Orky projects"
        style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', minHeight: 0 }}>
        {loading && (
          <div data-testid="orky-root-picker-loading" style={{ padding: 10, fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>
            Waiting for the Orky registry snapshot — tracked projects have not loaded yet…
          </div>
        )}
        {failed && (
          <div data-testid="orky-root-picker-error" style={{ padding: 10, fontSize: 12, color: 'var(--fg, #eee)' }}>
            {registryError}
          </div>
        )}
        {empty && (
          <div data-testid="orky-root-picker-empty" style={{ padding: 10, fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>
            No Orky projects are tracked yet. Open a terminal inside a project containing a{' '}
            <code>.orky/</code> directory to track it, then reopen this picker.
          </div>
        )}
        {!loading && !failed && memberRoots.map((root, i) => (
          <button key={root} type="button" role="option" aria-selected={i === sel}
            data-testid="orky-root-picker-item" title={root}
            onMouseEnter={() => setSel(i)}
            onClick={() => onSelect(root)}
            style={{
              textAlign: 'left', padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
              border: '1px solid var(--border, #444)',
              background: i === sel ? 'var(--sel-bg, rgba(30, 136, 229, 0.25))' : 'var(--panel, #1e1e1e)',
              color: 'var(--fg, #eee)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
            {root}
          </button>
        ))}
      </div>
      <button type="button" data-testid="orky-root-picker-cancel" onClick={onCancel}
        style={{ alignSelf: 'flex-end' }}>
        Cancel
      </button>
      </div>
    </Modal>
  )
}
