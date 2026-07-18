/**
 * The phone web client build (feature 0026, REQ-021) — a third vite build target (sibling of
 * `vite.agent.config.ts`): entry `src/phone-client/index.html` -> `out/phone-client/`.
 *
 * The client MUST be self-contained (REQ-021: no CDN, no runtime downloads) AND `GET /` is an
 * AUTHENTICATED route (REQ-005) — a normal multi-file vite build would emit `<script src>`/
 * `<link href>` references the browser fetches as separate, token-less requests that the auth
 * gate would 401. `inlineBuildOutputs` below folds the emitted JS/CSS directly into `index.html`
 * at build time (closeBundle) so the served shell is ONE authenticated document with everything
 * already inside it; the REQ-022 install allowlist (manifest + icons) is copied verbatim
 * alongside it, since `static-assets.ts` serves those two paths unauthenticated.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const ROOT = resolve('src/phone-client')
const OUT_DIR = resolve('out/phone-client')

function inlineBuildOutputs(): Plugin {
  return {
    name: 'phone-client-inline-and-copy-install-assets',
    apply: 'build',
    closeBundle() {
      const htmlPath = join(OUT_DIR, 'index.html')
      if (!existsSync(htmlPath)) return
      let html = readFileSync(htmlPath, 'utf8')
      const toDelete: string[] = []

      const resolveOutPath = (ref: string): string => join(OUT_DIR, ref.replace(/^\.?\//, ''))

      html = html.replace(/<script\b[^>]*><\/script>/g, (tag) => {
        const srcMatch = /\bsrc="([^"]+)"/.exec(tag)
        if (!tag.includes('type="module"') || !srcMatch) return tag
        const filePath = resolveOutPath(srcMatch[1])
        if (!existsSync(filePath)) return tag
        const code = readFileSync(filePath, 'utf8')
        toDelete.push(filePath)
        return `<script type="module">\n${code}\n</script>`
      })

      html = html.replace(/<link\b[^>]*>/g, (tag) => {
        const hrefMatch = /\bhref="([^"]+)"/.exec(tag)
        if (!tag.includes('rel="stylesheet"') || !hrefMatch) return tag
        const filePath = resolveOutPath(hrefMatch[1])
        if (!existsSync(filePath)) return tag
        const css = readFileSync(filePath, 'utf8')
        toDelete.push(filePath)
        return `<style>\n${css}\n</style>`
      })

      // Vite's HTML asset pipeline fingerprints <link rel="manifest"/"apple-touch-icon"/"icon">
      // hrefs into hashed files under assets/ (since publicDir is disabled — this build copies the
      // REQ-022 install allowlist itself, below, byte-identical to source). Point those two link
      // kinds back at the plain, un-hashed paths static-assets.ts's allowlist actually serves.
      html = html.replace(/(<link\b[^>]*\brel="manifest"[^>]*\bhref=")[^"]+(")/, '$1./manifest.webmanifest$2')
      html = html.replace(/(<link\b[^>]*\brel="(?:apple-touch-icon|icon)"[^>]*\bhref=")[^"]+(")/g, '$1./icons/icon-192.png$2')

      writeFileSync(htmlPath, html)
      for (const f of toDelete) { try { unlinkSync(f) } catch { /* already gone */ } }
      // Everything under assets/ at this point is either already-inlined (deleted above) or a
      // vite-fingerprinted duplicate of the manifest/icons this build copies verbatim next — drop
      // the whole directory so no orphaned, unreachable file lingers in the packaged artifact.
      const assetsDir = join(OUT_DIR, 'assets')
      if (existsSync(assetsDir)) rmSync(assetsDir, { recursive: true, force: true })

      // REQ-022's fixed unauthenticated install allowlist — copied verbatim (byte-identical to
      // the source; static-assets.ts serves these two paths regardless of app state).
      copyFileSync(join(ROOT, 'manifest.webmanifest'), join(OUT_DIR, 'manifest.webmanifest'))
      const iconsSrc = join(ROOT, 'icons')
      const iconsOut = join(OUT_DIR, 'icons')
      mkdirSync(iconsOut, { recursive: true })
      for (const name of readdirSync(iconsSrc)) copyFileSync(join(iconsSrc, name), join(iconsOut, name))
    }
  }
}

export default defineConfig({
  root: ROOT,
  base: './',
  publicDir: false,
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    // The self-contained-shell requirement (above) needs exactly one JS chunk to inline; there is
    // no code-splitting to preserve (the client is small and single-page).
    cssCodeSplit: true,
    rollupOptions: { output: { manualChunks: undefined } }
  },
  // xterm.js's own source carries an attribution comment naming the upstream projects it credits
  // (github.com/chjj/term.js, bellard.org/jslinux) — real URLs, but inert prose, never fetched.
  // The REQ-021 foreign-origin scan is a blunt string scan with no comment awareness, so this
  // build strips comments entirely (esbuild's default keeps `/*!`-style "legal comments"); the
  // upstream license text itself lives in this repo's own THIRD-PARTY notices, not the served
  // bundle.
  esbuild: { legalComments: 'none' },
  plugins: [inlineBuildOutputs()]
})
