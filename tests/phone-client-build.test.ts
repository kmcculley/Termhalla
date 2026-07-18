// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// REQ-021 (packaged, self-contained static client — third vite build target, no foreign
// origins) and REQ-022 (iOS home-screen PWA installability). Source-level scans always run;
// the emitted-bundle scan additionally runs when out/phone-client exists (the implement gate
// runs `npm run build` before `npm test`, so at the gate it ALWAYS runs).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()

const walk = (dir: string, exts: string[]): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, exts))
    else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

/** Foreign-origin references: any absolute http(s) URL that is not a spec/xml namespace. */
const foreignOrigins = (text: string): string[] =>
  (text.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [])
    .filter((u) => !/^https?:\/\/(www\.w3\.org|schemas\.|purl\.org)/.test(u))

describe('TEST-2675 REQ-021 third vite build target; the client is self-contained', () => {
  it('vite.phone-client.config.ts exists and targets out/phone-client', () => {
    const cfgPath = resolve(root, 'vite.phone-client.config.ts')
    expect(existsSync(cfgPath), 'the third vite build target must exist (sibling of vite.agent.config.ts)').toBe(true)
    const cfg = readFileSync(cfgPath, 'utf8')
    expect(cfg).toMatch(/out[/\\]phone-client/)
  })

  it('npm run build emits the phone client (the build script includes the config)', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(String(pkg.scripts.build)).toMatch(/vite\.phone-client\.config\.ts/)
  })

  it('no phone-client source references a foreign origin (no CDN, no runtime downloads)', () => {
    const dir = resolve(root, 'src/phone-client')
    expect(existsSync(dir)).toBe(true)
    const offenders: string[] = []
    for (const f of walk(dir, ['.ts', '.html', '.webmanifest', '.css', '.js'])) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const url of foreignOrigins(code)) offenders.push(`${f}: ${url}`)
    }
    expect(offenders).toEqual([])
  })

  it('the EMITTED bundle has no foreign-origin references (runs whenever out/phone-client exists)', () => {
    const outDir = resolve(root, 'out/phone-client')
    if (!existsSync(outDir)) return // pre-build run; the implement gate builds first (see header)
    const offenders: string[] = []
    for (const f of walk(outDir, ['.html', '.js', '.css', '.webmanifest'])) {
      for (const url of foreignOrigins(readFileSync(f, 'utf8'))) offenders.push(`${f}: ${url}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('TEST-2676 REQ-021 the packaged artifact includes the client bundle', () => {
  it('electron-builder.yml carries out/phone-client', () => {
    const yml = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/phone-client/)
  })
})

describe('TEST-2677 REQ-022 iOS home-screen PWA installability', () => {
  it('the served shell carries the manifest link and the iOS meta tags', () => {
    const html = readFileSync(resolve(root, 'src/phone-client/index.html'), 'utf8')
    expect(html).toMatch(/<link[^>]+rel=["']manifest["']/)
    expect(html).toMatch(/apple-mobile-web-app-capable/)
    expect(html).toMatch(/apple-touch-icon/)
    expect(html).toMatch(/viewport-fit=cover/)
  })

  it('the manifest parses with standalone display and a start URL, and the icons exist', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'src/phone-client/manifest.webmanifest'), 'utf8'))
    expect(['standalone', 'fullscreen']).toContain(manifest.display)
    expect(typeof manifest.start_url).toBe('string')
    expect(Array.isArray(manifest.icons)).toBe(true)
    expect(manifest.icons.length).toBeGreaterThan(0)
    const iconsDir = resolve(root, 'src/phone-client/icons')
    expect(existsSync(iconsDir)).toBe(true)
    expect(readdirSync(iconsDir).length).toBeGreaterThan(0)
  })
})
