// FROZEN unit suite — feature 0009-native-orky-pane (phase 4 / TASK-001, REQ-007 / REQ-013 / REQ-015).
// The ONE sanctioned shared refactor (spec FINDING-002): `openBlockingCount`'s inline per-entry
// predicate (orky-status.ts:134-143) is extracted VERBATIM as the exported `isBlockingFinding(f)`
// and `openBlockingCount` delegates to it — behavior-identical, proven by equivalence over a
// generated vector set AND over this repo's own real 0006 findings ledger.
//
// Runs RED today: `isBlockingFinding` is not exported by @shared/orky-status yet.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isBlockingFinding, openBlockingCount } from '@shared/orky-status'

describe('isBlockingFinding — the extracted blocking predicate (REQ-007)', () => {
  it('TEST-389 REQ-007 REQ-015 pinned vectors: open ∧ (CRITICAL/HIGH ∨ contract_violation === true), case-insensitive status/severity, total on junk', () => {
    expect(isBlockingFinding({ status: 'open', severity: 'HIGH' })).toBe(true)
    expect(isBlockingFinding({ status: 'open', severity: 'CRITICAL' })).toBe(true)
    expect(isBlockingFinding({ status: 'resolved', severity: 'HIGH' })).toBe(false)
    // the contract_violation OR-branch (FINDING-007): an open MEDIUM with the flag IS blocking…
    expect(isBlockingFinding({ status: 'open', severity: 'MEDIUM', contract_violation: true })).toBe(true)
    // …and a RESOLVED contract violation is NOT (status gates the OR-branch too)
    expect(isBlockingFinding({ status: 'resolved', severity: 'MEDIUM', contract_violation: true })).toBe(false)
    // strict `=== true`: a truthy string does not count
    expect(isBlockingFinding({ status: 'open', severity: 'MEDIUM', contract_violation: 'true' })).toBe(false)
    // case-insensitive status/severity (the producer's own normalization contract)
    expect(isBlockingFinding({ status: 'Open', severity: 'high' })).toBe(true)
    expect(isBlockingFinding({ status: 'OPEN', severity: 'Critical' })).toBe(true)
    // non-blocking severities without the flag
    expect(isBlockingFinding({ status: 'open', severity: 'MEDIUM' })).toBe(false)
    expect(isBlockingFinding({ status: 'open', severity: 'LOW' })).toBe(false)
    // total on junk: non-objects and missing fields are false, never a throw
    expect(isBlockingFinding(null)).toBe(false)
    expect(isBlockingFinding(undefined)).toBe(false)
    expect(isBlockingFinding('finding')).toBe(false)
    expect(isBlockingFinding(7)).toBe(false)
    expect(isBlockingFinding({})).toBe(false)
    expect(isBlockingFinding({ severity: 'HIGH' })).toBe(false)
    expect(isBlockingFinding({ status: 'open' })).toBe(false)
  })

  it('TEST-390 REQ-015 equivalence: openBlockingCount(v) === v.filter(isBlockingFinding).length over a generated vector set AND the real 0006 ledger', () => {
    const statuses = ['open', 'Open', 'OPEN', 'resolved', 'Resolved', undefined, 42, null]
    const severities = ['HIGH', 'high', 'CRITICAL', 'Critical', 'MEDIUM', 'LOW', undefined, {}, 3]
    const cvs = [true, false, undefined, 'true', 1]
    const generated: unknown[] = [null, undefined, 'x', 12, [], {}]
    for (const status of statuses) for (const severity of severities) for (const contract_violation of cvs) {
      generated.push({ status, severity, contract_violation, id: 'F', claim: 'c' })
    }
    expect(openBlockingCount(generated as never)).toBe(generated.filter(isBlockingFinding).length)
    // and over this repo's own shipped findings ledger (real producer bytes)
    const real = JSON.parse(readFileSync(resolve(process.cwd(), '.orky/features/0006-decision-queue-panel/findings.json'), 'utf8')) as unknown[]
    expect(real.length).toBeGreaterThan(0)
    expect(openBlockingCount(real as never)).toBe(real.filter(isBlockingFinding).length)
  })

  it('TEST-391 REQ-013 REQ-015 openBlockingCount DELEGATES to the export (source assertion) — one predicate definition, no drift possible', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/shared/orky-status.ts'), 'utf8')
    expect(src).toMatch(/export function isBlockingFinding/)
    // slice the openBlockingCount function body (up to the next export) and pin the delegation:
    const start = src.indexOf('export function openBlockingCount')
    expect(start).toBeGreaterThanOrEqual(0)
    const rest = src.slice(start + 1)
    const body = rest.slice(0, rest.indexOf('export function') >= 0 ? rest.indexOf('export function') : rest.length)
    expect(body).toContain('isBlockingFinding(')
    // the inline predicate is GONE from the counting loop (it lives only in the export)
    expect(body).not.toContain('BLOCKING_SEVERITY')
    expect(body).not.toContain('contract_violation')
  })
})
