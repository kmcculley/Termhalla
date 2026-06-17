/** Shared debounce for persisting edits. The workspace autosave, the quick.json save, and the
 *  editor hot-exit draft snapshot all use the same cadence, so a draft and the workspace save it
 *  belongs to land together rather than drifting apart. */
export const AUTOSAVE_DEBOUNCE_MS = 500
