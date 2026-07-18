/**
 * Serves the built web-client bundle, plus the REQ-005/REQ-022 unauthenticated install allowlist
 * (the PWA manifest + icons — secret-free, state-independent, byte-identical regardless of app
 * state). Every other path stays behind the auth gate in `service.ts`.
 */
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

/** Fixed, secret-free install assets (REQ-005's unauthenticated allowlist): the manifest and any
 *  icon under `/icons/`. Every other route needs a valid pairing token. */
export function isAllowlisted(pathname: string): boolean {
  return pathname === '/manifest.webmanifest' || pathname.startsWith('/icons/')
}

/** Serves one file from `staticRoot`, mapping `/` to `index.html`. 404s on any path that would
 *  traverse outside `staticRoot` or that doesn't exist. */
export async function serveStaticFile(staticRoot: string, pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const root = resolve(staticRoot)
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(404); res.end(); return
  }
  try {
    const data = await readFile(target)
    const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'content-length': String(data.length) })
    res.end(data)
  } catch {
    res.writeHead(404); res.end()
  }
}

/** Convenience for tests/diagnostics: the absolute path `serveStaticFile` would read for a route. */
export function staticFilePath(staticRoot: string, pathname: string): string {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  return join(resolve(staticRoot), relative)
}
