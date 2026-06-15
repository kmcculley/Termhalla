import type { EditorDraft } from './types'

/** Stable per-tab key: paneIds persist in the workspace layout, so this survives restart.
 *  Identical to the editor's existing fs-watch id scheme. */
export function draftKey(paneId: string, path: string): string {
  return `${paneId}::${path}`
}

/** Reserved sentinel "path" for a pane's untitled scratch buffer. The angle brackets are
 *  invalid in Windows paths, and the app only ever opens absolute paths, so this can never
 *  collide with a real file tab's key. */
export const UNTITLED = '<untitled>'

export function isUntitled(path: string): boolean {
  return path === UNTITLED
}

export interface DraftResolution {
  content: string          // what to load into the model
  dirty: boolean           // mark the tab dirty?
  externalChanged: boolean // show the "Changed on disk" reload bar?
}

/** Decide a tab's initial content when (re)opening a file, given the current disk content
 *  (null when the file is missing) and any persisted unsaved draft. */
export function resolveDraftOnOpen(diskContent: string | null, draft: EditorDraft | undefined): DraftResolution {
  if (!draft) return { content: diskContent ?? '', dirty: false, externalChanged: false }
  return {
    content: draft.content,
    dirty: draft.content !== diskContent,
    externalChanged: diskContent !== draft.baseline
  }
}
