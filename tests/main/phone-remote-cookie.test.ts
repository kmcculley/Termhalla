// FROZEN test suite — feature 0026-phone-web-remote (phase 4, v2 loopback — ESC-001 / FINDING-025).
// REQ-028 (HttpOnly session cookie: pairing survives every token-less entry path), plus the
// cookie halves of REQ-005 (cookie is a first-class credential, constant-time), REQ-006
// (regenerate revokes every outstanding cookie), REQ-022 (the start_url relaunch vector), and
// REQ-024 (the cookie is the durable credential across restarts).
//
// Contract set here for the implementer — src/main/phone-remote/cookie.ts exports:
//   issueSetCookie(token: string): string
//     // the full Set-Cookie header value: `${PHONE_COOKIE_NAME}=<value>` plus the attributes
//     // HttpOnly; SameSite=Lax; Path=/; Max-Age=PHONE_COOKIE_MAX_AGE_S. The <value>'s validity
//     // is a PURE function of (<value>, persisted tokenHash) — no server-side cookie registry,
//     // no new persisted secret (REQ-028/REQ-004).
//   cookieValueFromHeader(cookieHeader: string | undefined): string | undefined
//     // extracts the PHONE_COOKIE_NAME cookie's value from a Cookie request header (which may
//     // carry other cookies); total over garbage.
//   verifyCookieValue(value: string | undefined, tokenHash: string | undefined): boolean
//     // constant-time (timingSafeEqual over equal-length digests), total, false when either
//     // side is absent.
// And src/main/phone-remote/constants.ts exports:
//   PHONE_COOKIE_NAME = 'termhalla-phone', PHONE_COOKIE_MAX_AGE_S = 34_560_000 (400 days).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import WebSocket from 'ws'
import { createPhoneRemoteService } from '../../src/main/phone-remote/service'
import { generateToken, hashToken } from '../../src/main/phone-remote/token'
import { issueSetCookie, cookieValueFromHeader, verifyCookieValue } from '../../src/main/phone-remote/cookie'
import { PHONE_COOKIE_NAME, PHONE_COOKIE_MAX_AGE_S } from '../../src/main/phone-remote/constants'
import type { PhoneRemoteSettings } from '../../src/shared/phone-remote/settings'

type Msg = Record<string, unknown> & { type: string }

const until = async (pred: () => boolean, ms = 8000): Promise<void> => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanups.length > 0) { try { await cleanups.pop()!() } catch { /* teardown */ } }
})

interface Ctx {
  svc: ReturnType<typeof createPhoneRemoteService>
  persisted: () => PhoneRemoteSettings | undefined
}

const mkService = async (initial: PhoneRemoteSettings | undefined): Promise<Ctx> => {
  let stored = initial
  const staticDir = mkdtempSync(join(tmpdir(), 'termh-phone-cookie-'))
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Termhalla Phone</title>')
  writeFileSync(join(staticDir, 'manifest.webmanifest'), JSON.stringify({ name: 'Termhalla', display: 'standalone', start_url: '/' }))
  mkdirSync(join(staticDir, 'icons'), { recursive: true })
  const svc = createPhoneRemoteService({
    loadSettings: async () => stored,
    saveSettings: async (s) => { stored = s },
    panes: {
      list: () => [{ paneId: 'A', workspaceId: 'ws1', workspaceName: 'W', title: 'term A', kind: 'terminal', cols: 80, rows: 24, status: 'idle' }] as never,
      onData: () => () => {},
      onExit: () => () => {},
      onGrid: () => () => {},
      onStatus: () => () => {},
      write: () => {}
    },
    staticRoot: staticDir,
    notifyError: () => {}
  })
  await svc.init()
  cleanups.push(async () => { await svc.stop(); rmSync(staticDir, { recursive: true, force: true }) })
  return { svc, persisted: () => stored }
}

const baseOf = (ctx: Ctx): string => ctx.svc.status().urls[0].replace(/\/$/, '')

const ENABLED: PhoneRemoteSettings = { enabled: true, bind: 'localhost', port: 0 }

/** `pair` = "name=value" for a Cookie request header (attributes stripped). */
const pairOf = (setCookie: string): string => setCookie.split(';')[0].trim()

const wsOpenWithCookie = (url: string, cookiePair: string): Promise<{ ws: WebSocket; msgs: Msg[]; closed: () => boolean }> =>
  new Promise((res, rej) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookiePair } })
    const msgs: Msg[] = []
    let isClosed = false
    ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))) } catch { /* non-JSON */ } })
    ws.on('close', () => { isClosed = true })
    ws.on('open', () => res({ ws, msgs, closed: () => isClosed }))
    ws.on('error', rej)
  })

const wsRejectsWithCookie = (url: string, cookiePair?: string): Promise<boolean> =>
  new Promise((res) => {
    const ws = new WebSocket(url, cookiePair ? { headers: { Cookie: cookiePair } } : undefined)
    ws.on('open', () => { ws.close(); res(false) })
    ws.on('error', () => res(true))
    ws.on('unexpected-response', () => res(true))
  })

describe('TEST-2690 REQ-028 cookie module: pure issuance/verification bound to the token generation', () => {
  it('pins the exported cookie constants (CONV-003)', () => {
    expect(PHONE_COOKIE_NAME).toBe('termhalla-phone')
    expect(PHONE_COOKIE_MAX_AGE_S).toBe(34_560_000)
  })

  it('issueSetCookie carries name, HttpOnly, SameSite=Lax, Path=/ and the constant Max-Age', () => {
    const setCookie = issueSetCookie(generateToken())
    expect(setCookie.startsWith(`${PHONE_COOKIE_NAME}=`)).toBe(true)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\//i)
    expect(setCookie).toContain(`Max-Age=${PHONE_COOKIE_MAX_AGE_S}`)
  })

  it('the issued value verifies against the CURRENT tokenHash and against nothing else (pure function of both)', () => {
    const token = generateToken()
    const hash = hashToken(token)
    const value = cookieValueFromHeader(pairOf(issueSetCookie(token)))
    expect(value).toBeTruthy()
    expect(verifyCookieValue(value, hash)).toBe(true)
    expect(verifyCookieValue(value, hashToken(generateToken())), 'a different token generation must reject the cookie').toBe(false)
    expect(verifyCookieValue(value, undefined), 'absent tokenHash (never paired) rejects every cookie').toBe(false)
    expect(verifyCookieValue(undefined, hash)).toBe(false)
  })

  it('cookieValueFromHeader is total over garbage and multi-cookie headers', () => {
    const token = generateToken()
    const pair = pairOf(issueSetCookie(token))
    expect(cookieValueFromHeader(`other=1; ${pair}; another=x`)).toBe(cookieValueFromHeader(pair))
    expect(cookieValueFromHeader(undefined)).toBeUndefined()
    expect(() => cookieValueFromHeader(';;;=;; %%%')).not.toThrow()
    expect(() => verifyCookieValue('%%%not-base64%%%', hashToken(token))).not.toThrow()
    expect(verifyCookieValue('%%%not-base64%%%', hashToken(token))).toBe(false)
  })

  it('the cookie verification site uses timingSafeEqual, never a naive comparison (structural, REQ-005)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/main/phone-remote/cookie.ts'), 'utf8')
    expect(src).toMatch(/timingSafeEqual|verifyToken/)
  })
})

describe('TEST-2691 REQ-028/REQ-005/REQ-022 wire: the first token-authenticated response sets the cookie; the cookie alone passes', () => {
  it('GET /?token=<valid> responds Set-Cookie; a token-less GET / and WS upgrade with only that cookie succeed', async () => {
    const ctx = await mkService({ ...ENABLED })
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const token = String(new URL(pairingUrl).searchParams.get('token'))
    const base = baseOf(ctx)

    const first = await fetch(`${base}/?token=${encodeURIComponent(token)}`)
    expect(first.status).toBe(200)
    const setCookie = first.headers.get('set-cookie')
    expect(setCookie, 'the first token-authenticated response must set the session cookie').toBeTruthy()
    expect(String(setCookie)).toContain(`${PHONE_COOKIE_NAME}=`)
    expect(String(setCookie)).toMatch(/HttpOnly/i)
    expect(String(setCookie)).toMatch(/SameSite=Lax/i)
    expect(String(setCookie)).toContain(`Max-Age=${PHONE_COOKIE_MAX_AGE_S}`)
    const pair = pairOf(String(setCookie))

    // the FINDING-025 relaunch vector: start_url carries no token — the cookie is the credential
    const relaunch = await fetch(`${base}/`, { headers: { Cookie: pair } })
    expect(relaunch.status).toBe(200)

    const wsBase = base.replace('http', 'ws')
    const client = await wsOpenWithCookie(`${wsBase}/ws`, pair)
    await until(() => client.msgs.some((m) => m.type === 'hello'))
    client.ws.close()

    // a wrong cookie is rejected on both surfaces
    const wrong = `${PHONE_COOKIE_NAME}=WRONGVALUE`
    expect((await fetch(`${base}/`, { headers: { Cookie: wrong } })).status).toBe(401)
    expect(await wsRejectsWithCookie(`${wsBase}/ws`, wrong)).toBe(true)
  })
})

describe('TEST-2692 REQ-028/REQ-006/REQ-024 the cookie survives a restart; regenerate revokes it', () => {
  it('a fresh service instance loading only persisted state accepts the cookie; regenerate rejects it and closes cookie-authed clients', async () => {
    const first = await mkService({ ...ENABLED })
    const { pairingUrl } = await first.svc.regenerateToken()
    const token = String(new URL(pairingUrl).searchParams.get('token'))
    const res = await fetch(`${baseOf(first)}/?token=${encodeURIComponent(token)}`)
    const pair = pairOf(String(res.headers.get('set-cookie')))
    const persisted = first.persisted()
    await first.svc.stop()

    // "restart": only persisted state (tokenHash) — the cookie must keep working (CONV-065)
    const second = await mkService(persisted && { ...persisted, enabled: true, port: 0 })
    const base2 = baseOf(second)
    expect((await fetch(`${base2}/`, { headers: { Cookie: pair } })).status).toBe(200)

    // a cookie-authenticated live client is closed by regenerate, and the cookie dies with token A
    const client = await wsOpenWithCookie(`${base2.replace('http', 'ws')}/ws`, pair)
    await until(() => client.msgs.some((m) => m.type === 'hello'))
    await second.svc.regenerateToken()
    await until(() => client.closed(), 5000)
    expect((await fetch(`${base2}/`, { headers: { Cookie: pair } })).status).toBe(401)
    expect(await wsRejectsWithCookie(`${base2.replace('http', 'ws')}/ws`, pair)).toBe(true)
  })
})

describe('TEST-2693 REQ-005/REQ-028 hygiene: actionable 401, no cookie secret in URLs or at rest', () => {
  it('the 401 body is actionable and secret-free; the authenticated response redirects nowhere', async () => {
    const ctx = await mkService({ ...ENABLED })
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const token = String(new URL(pairingUrl).searchParams.get('token'))
    const base = baseOf(ctx)

    const denied = await fetch(`${base}/`)
    expect(denied.status).toBe(401)
    const body = await denied.text()
    expect(body, 'the 401 must tell the user HOW to pair (CONV-001)').toMatch(/pair|token/i)
    expect(body).toMatch(/Termhalla|Settings|QR/i)
    expect(body).not.toContain(token)

    const ok = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
    expect(ok.headers.get('location'), 'the cookie value must never ride a Location/URL').toBeNull()
    const cookieValue = cookieValueFromHeader(pairOf(String(ok.headers.get('set-cookie'))))
    expect(cookieValue).toBeTruthy()

    // serialize-and-scan: the desktop persists NO cookie-related secret beyond tokenHash
    const flat = JSON.stringify(ctx.persisted())
    expect(flat).not.toContain(String(cookieValue))
    expect(flat).not.toContain(token)
    expect(Object.keys(ctx.persisted() ?? {}).filter((k) => /cookie/i.test(k))).toEqual([])
  })
})
