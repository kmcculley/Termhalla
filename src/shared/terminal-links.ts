/** Pure detection/classification for clickable terminal links. No node:* imports — this module is
 *  bundled into the renderer too. URL *finding* is delegated to @xterm/addon-web-links; this module
 *  only classifies URLs (image vs not) and finds local image-file paths. */

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'] as const
const EXT_SET = new Set<string>(IMAGE_EXTS)

/** Lower-cased extension (no dot) if `s` ends in a known image extension, else null. */
export function imageExt(s: string): string | null {
  const dot = s.lastIndexOf('.')
  if (dot < 0 || dot === s.length - 1) return null
  const ext = s.slice(dot + 1).toLowerCase()
  return EXT_SET.has(ext) ? ext : null
}

/** True if the URL's path (query/hash stripped) ends in an image extension. */
export function isImageUrl(uri: string): boolean {
  const path = uri.split('#')[0].split('?')[0]
  return imageExt(path) !== null
}

export interface LinkMatch { start: number; end: number; text: string }

const LEAD = new Set(['(', '[', '<', '{'])
const TRAIL = new Set([')', ']', '>', '}', '.', ',', ';', ':', '!', '?'])

/** Local image-file path ranges in one line. Quoted spans (`"…"` / `'…'`) are taken verbatim so
 *  paths with spaces survive; bare tokens are split on whitespace, with wrapping brackets and
 *  trailing punctuation trimmed. Keeps spans that end in an image extension and are not URLs. */
export function findImagePaths(line: string): LinkMatch[] {
  const out: LinkMatch[] = []
  // Quoted-double | quoted-single | bare run of non-whitespace.
  const re = /"([^"]*)"|'([^']*)'|\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    let start: number
    let end: number
    if (m[1] !== undefined) { start = m.index + 1; end = start + m[1].length }       // "…"
    else if (m[2] !== undefined) { start = m.index + 1; end = start + m[2].length }   // '…'
    else {                                                                            // bare token
      start = m.index; end = m.index + m[0].length
      while (start < end && LEAD.has(line[start])) start++
      while (end > start && TRAIL.has(line[end - 1])) end--
    }
    const text = line.slice(start, end)
    if (!text || text.includes('://')) continue
    if (imageExt(text) === null) continue
    out.push({ start, end, text })
  }
  return out
}

/** A source-location reference in one line of output (QoL batch 2026-07-17). */
export interface FileLineMatch { start: number; end: number; path: string; line: number; col?: number }

// path:LINE[:COL] — the path needs a dot-extension so bare `foo:12` stays inert; an optional
// leading drive letter keeps the Windows drive colon out of the line-number split.
const COLON_REF = /^((?:[A-Za-z]:)?[^:()]*\.\w+):(\d+)(?::(\d+))?$/
// MSBuild/csc form: path(LINE[,COL])
const PAREN_REF = /^((?:[A-Za-z]:)?[^:()]*\.\w+)\((\d+)(?:,(\d+))?\)$/

/** Source-location refs (`src/foo.ts:42:8`, `C:\a\b.cs(10,5)`) in one line, with the span of the
 *  whole reference so the full `path:line:col` renders as one link. Token discipline mirrors
 *  findImagePaths (bracket/punctuation trimming); URLs never match (the `://` colon breaks the
 *  extension capture, and the scheme token carries no dot-extension before a `:digit` tail). */
export function findFileLineRefs(lineText: string): FileLineMatch[] {
  const out: FileLineMatch[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lineText)) !== null) {
    let start = m.index
    let end = m.index + m[0].length
    while (start < end && LEAD.has(lineText[start])) start++
    while (end > start && TRAIL.has(lineText[end - 1])) {
      // Keep a ')' that closes a paren opened INSIDE the token — `a.cs(10,5):` must trim the
      // colon but stop at the balanced paren, or the MSBuild form can never match.
      if (lineText[end - 1] === ')') {
        const slice = lineText.slice(start, end)
        const opens = (slice.match(/\(/g) ?? []).length
        const closes = (slice.match(/\)/g) ?? []).length
        if (closes <= opens) break
      }
      end--
    }
    const token = lineText.slice(start, end)
    if (!token || token.includes('://')) continue
    const hit = COLON_REF.exec(token) ?? PAREN_REF.exec(token)
    if (!hit) continue
    out.push({
      start, end,
      path: hit[1],
      line: Number(hit[2]),
      col: hit[3] !== undefined ? Number(hit[3]) : undefined
    })
  }
  return out
}

const ABSOLUTE = /^([A-Za-z]:[\\/]|\\\\|\/)/

/** Absolute path for an image reference: absolute passthrough; `~`/`~/…` → home; else join cwd. */
export function resolveImageSrc(text: string, cwd: string, home: string): string {
  if (text === '~') return home
  if (text.startsWith('~/') || text.startsWith('~\\')) return joinPath(home, text.slice(2))
  if (ABSOLUTE.test(text)) return text
  return joinPath(cwd, text)
}

function joinPath(base: string, rel: string): string {
  const r = rel.replace(/^\.[\\/]/, '')
  const sep = base.includes('\\') ? '\\' : '/'
  return base.replace(/[\\/]+$/, '') + sep + r
}
