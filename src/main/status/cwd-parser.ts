import { scanOsc } from './osc-scanner'

const OSC = '\x1b]'

/** Maximum retained no-terminator carry-over, in UTF-8 bytes (the OrkyOscParser
 *  MAX_PENDING_BYTES precedent). This parser's prefix is the bare `\x1b]` — EVERY OSC sequence
 *  (window titles, hyperlinks, clipboard writes) funnels through its carry-over, so an
 *  unterminated third-party OSC is routine hostile input that previously grew the buffer forever
 *  and rescanned it per chunk (O(n²)) on the StatusEngine hot path. The longest legal body this
 *  parser extracts is a cwd report; 8192 comfortably exceeds PATH_MAX-class (4096-byte) file-URL
 *  bodies, so no real cwd report is ever clipped. Pinned by tests/main/osc-pending-bound.test.ts. */
export const MAX_PENDING_BYTES = 8192

/** Convert an OSC 7 file URL body (file://host/<path>) to a Windows path, best-effort. */
function fileUrlToWindows(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data)
  if (!m) return null
  let p: string
  try { p = decodeURIComponent(m[1]) } catch { p = m[1] }
  const dos = /^\/([a-zA-Z]):(.*)$/.exec(p)        // /C:/dev
  if (dos) return `${dos[1].toUpperCase()}:${dos[2]}`.replace(/\//g, '\\')
  const wsl = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p)  // /mnt/c/work
  if (wsl) return `${wsl[1].toUpperCase()}:${wsl[2] ?? ''}`.replace(/\//g, '\\')
  const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(p)      // /c/dev
  if (msys) return `${msys[1].toUpperCase()}:${msys[2] ?? ''}`.replace(/\//g, '\\')
  return p                                            // leave non-Windows paths as-is
}

function parseOsc(body: string): string | null {
  const sep = body.indexOf(';')
  if (sep === -1) return null
  const num = body.slice(0, sep)
  const data = body.slice(sep + 1)
  if (num === '9' && data.startsWith('9;')) return data.slice(2)   // OSC 9;9;<windows path>
  if (num === '7') return fileUrlToWindows(data)                   // OSC 7;file://...
  return null
}

/** Stateful scanner: feed PTY output chunks, get the latest reported cwd (or null). */
export class CwdParser {
  private buf = ''

  push(chunk: string): string | null {
    this.buf += chunk
    let cwd: string | null = null
    this.buf = scanOsc(this.buf, OSC, body => { const c = parseOsc(body); if (c !== null && c !== '') cwd = c })
    // Explicit bounded ceiling on the no-terminator carry-over path, layered on top of scanOsc
    // (which stays shared and untouched — the OrkyOscParser pattern). Never clips a legal report.
    if (Buffer.byteLength(this.buf, 'utf8') > MAX_PENDING_BYTES) this.buf = ''
    return cwd
  }
}
