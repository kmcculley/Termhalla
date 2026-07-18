/** The one shared array-rejecting plain-object guard: a non-null `typeof 'object'` value that is
 *  not an array. Replaces the several subtly-divergent local guards (`isRecord`/`isObject`/
 *  `isPlainObject`) the shared modules used to carry — the `paths.ts` basename precedent.
 *  Deliberately NOT used by `src/shared/remote/messages.ts`, whose prototype-checking variant has
 *  genuinely different semantics and whose tree stays self-contained (TEST-746). Pure — no DOM,
 *  no Electron, no node builtins. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
