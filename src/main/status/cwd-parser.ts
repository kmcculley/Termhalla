import { scanOsc } from './osc-scanner'

const OSC = '\x1b]'

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
    return cwd
  }
}
