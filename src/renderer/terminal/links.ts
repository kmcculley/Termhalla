import type { Terminal, ILink, ILinkProvider, IDisposable } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ImageSource } from '@shared/ipc-contract'
import { findImagePaths, findFileLineRefs, isImageUrl, resolveImageSrc } from '@shared/terminal-links'

export interface TerminalLinksOpts {
  isSsh: boolean
  getCwd: () => string
  getHome: () => string
  openExternal: (url: string) => void
  openImage: (src: ImageSource) => void
  /** Open a source location (compiler error / stack frame) in the editor pane (QoL 2026-07-17). */
  openFileAt?: (path: string, line: number, col?: number) => void
}

const hasMod = (e: MouseEvent) => e.ctrlKey || e.metaKey

/** Wire clickable links into an xterm instance:
 *  - http(s) URLs via @xterm/addon-web-links (handles wrapping + hover underline); on Ctrl/Cmd+click
 *    an image URL opens the lightbox, any other URL opens the browser.
 *  - local image-file paths via a custom link provider (Ctrl/Cmd+click → lightbox). Disabled in SSH
 *    panes, where local-looking paths live on the remote and can't be read locally.
 *  Returns a disposer that tears down both. */
export function registerTerminalLinks(term: Terminal, opts: TerminalLinksOpts): IDisposable {
  const disposables: IDisposable[] = []

  const webLinks = new WebLinksAddon((event, uri) => {
    if (!hasMod(event)) return
    if (isImageUrl(uri)) opts.openImage({ kind: 'url', src: uri })
    else opts.openExternal(uri)
  })
  term.loadAddon(webLinks)
  disposables.push(webLinks)

  if (!opts.isSsh) {
    const provider: ILinkProvider = {
      provideLinks(bufferLineNumber, callback) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString(true)
        const links: ILink[] = findImagePaths(text).map(m => ({
          // xterm ranges are 1-based and inclusive of the end cell.
          range: { start: { x: m.start + 1, y: bufferLineNumber }, end: { x: m.end, y: bufferLineNumber } },
          text: m.text,
          activate: (event: MouseEvent, t: string) => {
            if (!hasMod(event)) return
            opts.openImage({ kind: 'file', src: resolveImageSrc(t, opts.getCwd(), opts.getHome()) })
          }
        }))
        // Source locations (`src/foo.ts:42:8`, `a.cs(10,5)`) open in the editor pane at that
        // position (QoL 2026-07-17). Same Ctrl/Cmd+click gesture as every other terminal link.
        if (opts.openFileAt) {
          for (const m of findFileLineRefs(text)) {
            links.push({
              range: { start: { x: m.start + 1, y: bufferLineNumber }, end: { x: m.end, y: bufferLineNumber } },
              text: text.slice(m.start, m.end),
              activate: (event: MouseEvent) => {
                if (!hasMod(event)) return
                opts.openFileAt!(resolveImageSrc(m.path, opts.getCwd(), opts.getHome()), m.line, m.col)
              }
            })
          }
        }
        callback(links.length ? links : undefined)
      }
    }
    disposables.push(term.registerLinkProvider(provider))
  }

  return { dispose: () => { for (const d of disposables) d.dispose() } }
}
