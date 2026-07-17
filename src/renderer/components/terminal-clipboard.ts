export type ClipboardAction = 'copy' | 'paste' | null

/** Options for {@link normalizeCopiedText}. Both heuristics default on. */
export interface CleanCopyOptions {
  /** Rejoin rows a TUI soft-wrapped at the pane width back into one logical line. Default true. */
  reflow?: boolean
  /** Collapse blank-line runs to a single blank and trim leading/trailing blanks. Default true. */
  blankLines?: boolean
}

/** A row `cur` that STARTS with any of these is an intentional new line, never a wrap continuation:
 *  leading whitespace (indented code / nesting), a bullet (`-`/`*`/`+`), a numbered-list marker
 *  (`1.`/`2)`), a heading (`#`), a blockquote (`>`), a table row (`|`), or a code fence (```). */
const STRUCTURED = /^(\s|[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||`{3})/

/** Reflow only engages once the content is at least this wide. Narrow, uniform rows (file lists,
 *  columns, `ls` output) are far likelier intentional rows than wrapped prose — leave them alone. */
const MIN_WRAP_WIDTH = 36
/** A wrapped row is (nearly) full; a paragraph's final row is short. Only rows at least this
 *  fraction of the content width are eligible to be treated as a soft-wrap continuation. */
const FILL_RATIO = 0.7

function firstWordLen(s: string): number {
  const m = /^\S+/.exec(s)
  return m ? m[0].length : 0
}

/** Clean up text pulled from a terminal selection for pasting elsewhere (editor, chat, Claude).
 *
 *  xterm's own `getSelection()` already trims trailing whitespace per row and rejoins lines that
 *  wrapped at the *terminal edge* (`isWrapped`). The artifacts this fixes come from TUIs (e.g.
 *  Claude Code) that paint their OWN grid — measuring the pane width and inserting real newlines to
 *  wrap paragraphs — so those breaks look like hard newlines to the terminal and survive copy.
 *
 *  Two heuristic passes, both opt-outable:
 *   - `reflow`: a physical row is treated as a soft-wrap continuation of the previous row when the
 *     previous row is near-full AND the next word would not have fit on it (the actual word-wrap
 *     condition) — but never across a blank line or into a structured row (list/quote/code/indent).
 *     Multi-row paragraphs collapse to one line; a short paragraph-final row ends the run.
 *   - `blankLines`: collapse runs of blank lines to one and trim leading/trailing blanks.
 *
 *  Heuristic by nature — it can occasionally merge two lines you wanted apart — so it's gated behind
 *  the `cleanCopy` setting at the call sites. Pure/DOM-free for unit testing. */
export function normalizeCopiedText(text: string, opts: CleanCopyOptions = {}): string {
  const reflow = opts.reflow ?? true
  const blankLines = opts.blankLines ?? true
  // Right-trim every row (xterm already does this, but keep the function self-contained) and work
  // in `\n` — the result pastes cleanly everywhere regardless of the source's line endings.
  let lines = text.split(/\r?\n/).map(l => l.replace(/\s+$/, ''))

  if (reflow) {
    const contentWidth = lines.reduce((m, l) => Math.max(m, l.length), 0)
    if (contentWidth >= MIN_WRAP_WIDTH) {
      const out: string[] = []
      for (let i = 0; i < lines.length; i++) {
        const cur = lines[i]
        // Decide from the ORIGINAL previous physical row (not the merged accumulator): was that row
        // a soft-wrap that continues into `cur`? Using the accumulator would run past a short
        // paragraph-final row and wrongly swallow the next paragraph.
        const prev = i > 0 ? lines[i - 1] : ''
        const wrapped =
          out.length > 0 && prev !== '' && cur !== '' &&
          !STRUCTURED.test(cur) &&
          prev.length >= contentWidth * FILL_RATIO &&
          prev.length + 1 + firstWordLen(cur) > contentWidth
        if (wrapped) out[out.length - 1] += ' ' + cur
        else out.push(cur)
      }
      lines = out
    }
  }

  if (blankLines) {
    const out: string[] = []
    for (const l of lines) {
      if (l === '' && (out.length === 0 || out[out.length - 1] === '')) continue
      out.push(l)
    }
    while (out.length && out[out.length - 1] === '') out.pop()
    lines = out
  }

  return lines.join('\n')
}

/** Minimal shape of the key event we inspect — a real DOM `KeyboardEvent` satisfies it
 *  structurally. Kept DOM-free so this stays pure/unit-testable. */
export interface ClipboardKeyEvent {
  type: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  key: string
}

/** Decide what a terminal key event means for the clipboard.
 *  - Ctrl/Cmd+C with a selection -> 'copy'; without -> null (let ^C through to the PTY).
 *  - Ctrl/Cmd+V -> 'paste'.
 *  - Ctrl/Cmd+Shift+C / +V (QoL 2026-07-17): the classic terminal-emulator convention — same
 *    actions, unambiguous alongside ^C-as-interrupt.
 *  - Anything else (non-keydown, Alt held, other keys) -> null. */
export function clipboardKeyAction(e: ClipboardKeyEvent, hasSelection: boolean): ClipboardAction {
  if (e.type !== 'keydown') return null
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'c') return hasSelection ? 'copy' : null
  if (key === 'v') return 'paste'
  return null
}

/** Handle a terminal keydown for clipboard copy/paste, for use as xterm's custom key handler.
 *  Returns `false` when the key is a clipboard action (so xterm ignores it) and `true` otherwise
 *  (xterm processes the key normally).
 *
 *  Crucially, for a copy/paste it calls `e.preventDefault()`. Returning `false` from xterm's
 *  `attachCustomKeyEventHandler` makes xterm skip the key WITHOUT preventing the browser default —
 *  so Ctrl+V would still fire a native `paste` DOM event, which xterm's own built-in paste listener
 *  then handles, pasting the clipboard a SECOND time. preventDefault stops that native event. (Copy
 *  has the mirror problem: a native `copy` event would run after we've cleared the selection.) */
export function handleClipboardKey(
  e: ClipboardKeyEvent & { preventDefault(): void },
  hasSelection: boolean,
  handlers: { copy(): void; paste(): void }
): boolean {
  const action = clipboardKeyAction(e, hasSelection)
  if (!action) return true
  e.preventDefault()
  if (action === 'copy') handlers.copy()
  else handlers.paste()
  return false
}
