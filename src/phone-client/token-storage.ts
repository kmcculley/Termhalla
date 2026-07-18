/**
 * Pairing-token URL extraction + client-side persistence (feature 0026, REQ-023/REQ-024). Pure
 * and DOM-free: `main.ts` supplies the real `window.location.href` / `localStorage` at the call
 * site so this module stays import-safe (and unit-testable) under node.
 */

export interface ExtractedToken {
  token?: string
  cleanedHref: string
}

/** Pulls `?token=` off a URL and returns the cleaned href (every OTHER query param survives) so
 *  the caller can `history.replaceState` it — the token must not linger in browser history. */
export function extractTokenFromUrl(href: string): ExtractedToken {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { cleanedHref: href }
  }
  const token = url.searchParams.get('token')
  if (token === null) return { cleanedHref: href }
  url.searchParams.delete('token')
  const search = url.searchParams.toString()
  url.search = search
  return { token, cleanedHref: url.toString() }
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface TokenStorage {
  save(token: string): void
  load(): string | undefined
}

const STORAGE_KEY = 'termhalla-phone-token'

export function createTokenStorage(storage: StorageLike): TokenStorage {
  return {
    save(token) {
      storage.setItem(STORAGE_KEY, token)
    },
    load() {
      return storage.getItem(STORAGE_KEY) ?? undefined
    }
  }
}
