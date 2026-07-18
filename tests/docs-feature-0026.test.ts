// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// REQ-027: the documentation ships WITH the feature (string-presence doc-drift guards, the
// docs-feature-0022/0024/0025 precedent — RED until the docs task lands).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8')

describe('TEST-2680 REQ-027 docs/features/phone-web-remote.md covers every listed topic', () => {
  it('documents the security posture', () => {
    const doc = read('docs/features/phone-web-remote.md')
    expect(doc).toMatch(/off by default/i)
    expect(doc).toMatch(/localhost|127\.0\.0\.1/)
    expect(doc).toMatch(/LAN/)
    expect(doc).toMatch(/plaintext|unencrypted/i)
    expect(doc).toMatch(/hash/i)                       // single hashed token, never plaintext at rest
    expect(doc).toMatch(/regenerate/i)                 // regenerate revokes all
  })

  it('documents the anywhere-access story and the no-cloud-relay stance', () => {
    const doc = read('docs/features/phone-web-remote.md')
    expect(doc).toMatch(/tailscale serve/i)
    expect(doc).toMatch(/cloud relay/i)
  })

  it('states the history limits: begins at enable, restarts on app restart (REQ-008/REQ-024)', () => {
    const doc = read('docs/features/phone-web-remote.md')
    expect(doc).toMatch(/history/i)
    expect(doc).toMatch(/enable/i)
    expect(doc).toMatch(/restart/i)
  })

  it('records the deferred follow-ons', () => {
    const doc = read('docs/features/phone-web-remote.md')
    expect(doc).toMatch(/Web Push/i)
    expect(doc).toMatch(/native iOS/i)
    expect(doc).toMatch(/per-device/i)
    expect(doc).toMatch(/read-only/i)
    expect(doc).toMatch(/TLS/i)
  })
})

describe('TEST-2681 REQ-027 living-doc entries', () => {
  it('CLAUDE.md gains the "Where things live" row', () => {
    expect(read('CLAUDE.md')).toMatch(/phone-web-remote\.md/)
  })

  it('CHANGELOG [Unreleased] mentions the phone remote (detail stays under [Unreleased])', () => {
    const changelog = read('CHANGELOG.md')
    const start = changelog.indexOf('## [Unreleased]')
    expect(start).toBeGreaterThanOrEqual(0)
    const nextHeading = changelog.indexOf('\n## [', start + 1)
    const unreleased = changelog.slice(start, nextHeading === -1 ? undefined : nextHeading)
    expect(unreleased).toMatch(/phone[- ](web[- ])?remote/i)
  })
})
