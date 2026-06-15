import type { Workspace } from './types'

/** Build the byte string to write to a PTY for a broadcast send.
 *  Newlines normalize to CR; paste mode wraps in bracketed-paste markers; a trailing
 *  Enter (CR) is appended outside the wrapper. */
export function encodeBroadcast(text: string, mode: 'paste' | 'keys', enter: boolean): string {
  const body = text.replace(/\r\n|\n/g, '\r')
  const wrapped = mode === 'paste' ? `\x1b[200~${body}\x1b[201~` : body
  return enter ? `${wrapped}\r` : wrapped
}

/** Ids of the terminal panes in a workspace (stable order). */
export function terminalPaneIds(ws: Workspace): string[] {
  return Object.keys(ws.panes).filter(id => ws.panes[id].config.kind === 'terminal')
}
