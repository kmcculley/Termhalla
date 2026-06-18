import { useEffect } from 'react'
import { useStore } from '../store'
import { resolveProjectKey } from '@shared/project-key'

/** Basename of a path key, for the header. */
function projName(key: string): string {
  const parts = key.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? key
}

/** Right-side notes drawer: shows the note for the focused pane's project (sticky to the last
 *  non-empty project). Plain auto-saved textarea. Only rendered when notesOpen. */
export function NotesPanel() {
  const focusedPaneId = useStore(s => s.focusedPaneId)
  const gitStatus = useStore(s => s.gitStatus)
  const cwds = useStore(s => s.cwds)
  const workspaces = useStore(s => s.workspaces)
  const notesProjectKey = useStore(s => s.notesProjectKey)
  const notes = useStore(s => s.notes)
  const setNote = useStore(s => s.setNote)
  const setNotesProject = useStore(s => s.setNotesProject)
  const setNotesOpen = useStore(s => s.setNotesOpen)

  // Track the focused pane's project; ignore empties so the panel keeps showing the last project.
  useEffect(() => {
    const key = resolveProjectKey({ gitStatus, cwds, workspaces }, focusedPaneId)
    if (key) setNotesProject(key)
  }, [focusedPaneId, gitStatus, cwds, workspaces, setNotesProject])

  const text = notesProjectKey ? (notes[notesProjectKey] ?? '') : ''

  return (
    <div data-testid="notes-panel"
      style={{ width: 320, flex: '0 0 320px', display: 'flex', flexDirection: 'column',
        background: 'var(--panel, #1e1e1e)', borderLeft: '1px solid var(--border, #333)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid var(--border, #333)' }}>
        <span data-testid="notes-project" style={{ flex: 1, fontSize: 12, color: 'var(--fg-dim, #aaa)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {notesProjectKey ? projName(notesProjectKey) : 'Notes'}
        </span>
        <button data-testid="notes-close" title="Close notes" onClick={() => setNotesOpen(false)}>✕</button>
      </div>
      {notesProjectKey ? (
        <textarea data-testid="notes-textarea" value={text}
          onChange={e => setNote(notesProjectKey, e.target.value)}
          placeholder="Notes for this project…"
          style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', padding: 8,
            background: 'transparent', color: 'var(--fg, #eee)', fontFamily: 'var(--mono)', fontSize: 13 }} />
      ) : (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>
          Focus a terminal in a project to take notes.
        </div>
      )}
    </div>
  )
}
