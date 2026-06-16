import { monaco } from './monaco-setup'
export { basename as base } from '@shared/paths'

/** One open file (or the untitled scratch buffer) backing a tab in an EditorPane. */
export interface Tab {
  path: string
  model: monaco.editor.ITextModel
  saved: string                 // last on-disk (or last-saved) text; '' for the untitled buffer
  disp: monaco.IDisposable      // onDidChangeContent subscription, disposed with the tab
  tooLarge: boolean
  missing: boolean
  externalChanged?: boolean     // disk changed under unsaved edits — show the reload bar
}

/** Replace a model's entire contents as a single undoable edit. */
export function applyContent(model: monaco.editor.ITextModel, content: string): void {
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null)
}

/** Is the tab dirty (editable, present, and diverged from its saved text)? */
export function isDirty(t: Tab | undefined): boolean {
  return !!t && !t.tooLarge && !t.missing && t.model.getValue() !== t.saved
}
