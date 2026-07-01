// FROZEN unit suite — feature 0007-orky-action-dispatch (phase 4 / TASK-009, REQ-001/REQ-018).
// Asserts the NEW `orkyAction:*` domain on `src/shared/ipc-contract.ts` structurally (exact channel name
// strings + the four `TermhallaApi` method names appear in source) — CONV-012 FORBIDS a content-hash/
// whole-file freeze on this file (F6/F9/F13 also touch it), so this suite greps for THIS feature's own
// additions only, never the whole file's shape.
//
// Mirrors tests/shared/orky-ipc-contract.test.ts (0004) and tests/shared/registry-ipc-contract.test.ts
// (0005)'s style: read `CH` for the channel values (a real runtime import — safe, additive), and
// source-grep `ipc-contract.ts`'s text for the `TermhallaApi` method signatures (interface members are
// erased at runtime, so they cannot be asserted via a value import).
//
// Runs RED today: `CH.orkyActionResolveEscalation` etc. are `undefined` (TASK-009 not done); the
// `TermhallaApi` method greps fail to match (the methods don't exist in source yet).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CH } from '@shared/ipc-contract'

const contractSrc = (): string => readFileSync(resolve(process.cwd(), 'src', 'shared', 'ipc-contract.ts'), 'utf8')

describe('orkyAction:* channel names (REQ-001/REQ-018)', () => {
  it('TEST-196 REQ-018 declares the exact four orkyAction:* channel name strings', () => {
    const ch = CH as Record<string, string>
    expect(ch.orkyActionResolveEscalation).toBe('orkyAction:resolveEscalation')
    expect(ch.orkyActionSubmitWork).toBe('orkyAction:submitWork')
    expect(ch.orkyActionRecordHumanGate).toBe('orkyAction:recordHumanGate')
    expect(ch.orkyActionDriveStatus).toBe('orkyAction:driveStatus')
  })

  it('TEST-197 REQ-001/REQ-018 all four values are unique and collide with no OTHER existing CH value (distinct from the read-only orky:* domain)', () => {
    const ch = CH as Record<string, string>
    const four = [ch.orkyActionResolveEscalation, ch.orkyActionSubmitWork, ch.orkyActionRecordHumanGate, ch.orkyActionDriveStatus]
    expect(new Set(four).size).toBe(4)
    const everyOtherValue = Object.entries(ch).filter(([k]) => !k.startsWith('orkyAction')).map(([, v]) => v)
    for (const v of four) expect(everyOtherValue).not.toContain(v)
    // grep-visibly a DISTINCT domain from the existing read-only orky:* channels (spec's resolved
    // open-question #1 rationale) — none of the four start with the bare 'orky:' read prefix.
    for (const v of four) expect(v.startsWith('orky:')).toBe(false)
  })

  it('TEST-198 REQ-001 introduces NO main->renderer push channel: no CH value under the orkyAction domain carries a "-> renderer" push comment, and no onOrkyAction* push subscriber exists on TermhallaApi', () => {
    const src = contractSrc()
    // every orkyAction:* line in the CH object must be commented as renderer -> main (or uncommented,
    // never annotated "main -> renderer" the way every other push channel in this file is).
    const chBlockMatch = src.match(/export const CH = \{[\s\S]*?\n\} as const/)
    expect(chBlockMatch, 'CH object block not found').toBeTruthy()
    const chBlock = chBlockMatch![0]
    const orkyActionLines = chBlock.split('\n').filter(l => l.includes('orkyAction'))
    expect(orkyActionLines.length).toBeGreaterThanOrEqual(4)
    for (const line of orkyActionLines) expect(line).not.toMatch(/main -> renderer/)
    expect(src).not.toMatch(/onOrkyAction/)
  })
})

describe('TermhallaApi orkyAction:* method bindings (REQ-018) — structural, not a content-hash freeze (CONV-012)', () => {
  it('TEST-199 REQ-018 the interface declares orkyResolveEscalation(req): Promise<OrkyActionResult>', () => {
    expect(contractSrc()).toMatch(/orkyResolveEscalation\s*\(\s*req\s*:\s*ResolveEscalationRequest\s*\)\s*:\s*Promise<OrkyActionResult>/)
  })

  it('TEST-200 REQ-018 the interface declares orkySubmitWork(req): Promise<OrkyActionResult>', () => {
    expect(contractSrc()).toMatch(/orkySubmitWork\s*\(\s*req\s*:\s*SubmitWorkRequest\s*\)\s*:\s*Promise<OrkyActionResult>/)
  })

  it('TEST-201 REQ-018 the interface declares orkyRecordHumanGate(req): Promise<OrkyActionResult>', () => {
    expect(contractSrc()).toMatch(/orkyRecordHumanGate\s*\(\s*req\s*:\s*RecordHumanGateRequest\s*\)\s*:\s*Promise<OrkyActionResult>/)
  })

  it('TEST-202 REQ-018 the interface declares orkyDriveStatus(req): Promise<OrkyActionResult>', () => {
    expect(contractSrc()).toMatch(/orkyDriveStatus\s*\(\s*req\s*:\s*DriveStatusRequest\s*\)\s*:\s*Promise<OrkyActionResult>/)
  })

  it('TEST-203 REQ-018 the four request types + OrkyActionResult are imported from @shared/types (not redeclared locally)', () => {
    const src = contractSrc()
    const importLine = src.split('\n').find(l => l.startsWith("import type") && l.includes('./types'))
    expect(importLine, 'type-import line from ./types not found').toBeTruthy()
    for (const name of ['OrkyActionResult', 'ResolveEscalationRequest', 'SubmitWorkRequest', 'RecordHumanGateRequest', 'DriveStatusRequest']) {
      expect(importLine).toContain(name)
    }
  })
})
