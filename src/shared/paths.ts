/** Last path segment, handling both separators and ignoring trailing slashes.
 *  `C:\a\b` → `b`, `C:\a\b\` → `b`, `b` → `b`, `` → ``. Replaces the several
 *  subtly-divergent local basename helpers the renderer used to carry. */
export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : p
}
