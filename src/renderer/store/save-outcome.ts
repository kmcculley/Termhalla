/**
 * Per-writer failure-streak toast gate for the debounced persistence writers (2026-07-17 quality
 * audit, Finding 6). Each debounced writer (workspace autosave / quick-save / notes-save) used to
 * `void` its IPC write, silently dropping failures. Routing every settle through one of these
 * notifiers surfaces exactly ONE error toast per failure STREAK — a persistently failing disk
 * must not raise a toast per keystroke — and a success re-arms the gate so a NEW streak toasts
 * again. Errors always render (the toasts-slice policy), so the signal can't be suppressed.
 *
 * Api-free (pushToast is injected — the op.ts pattern) so it stays unit-testable.
 */
export interface SaveOutcome {
  /** Report a failed write. Toasts on the first failure of a streak, then stays silent. */
  failed(err: unknown): void
  /** Report a successful write; re-arms the gate for the next failure streak. */
  succeeded(): void
}

export function makeSaveOutcome(
  toastText: (detail: string) => string,
  pushError: (text: string) => void
): SaveOutcome {
  let toastedThisStreak = false
  return {
    failed(err) {
      if (toastedThisStreak) return
      toastedThisStreak = true
      pushError(toastText(err instanceof Error ? err.message : String(err)))
    },
    succeeded() { toastedThisStreak = false }
  }
}
