/** Last path segment, handling both separators and ignoring trailing slashes.
 *  `C:\a\b` → `b`, `C:\a\b\` → `b`, `b` → `b`, `` → ``. Replaces the several
 *  subtly-divergent local basename helpers the renderer used to carry. */
export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : p
}

/** Path of `p` relative to `root`, with either separator and an optional trailing
 *  separator on `root`. Exact match → ''. Not under root → `p` unchanged. */
export function relativeTo(root: string, p: string): string {
  const r = root.replace(/[\\/]+$/, '')
  if (p === r) return ''
  if (p.startsWith(r + '\\') || p.startsWith(r + '/')) return p.slice(r.length + 1)
  return p
}
