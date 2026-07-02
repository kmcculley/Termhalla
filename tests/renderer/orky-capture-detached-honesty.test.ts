// FROZEN structural pin — feature 0012-quick-capture-inbox, REVISION 2 review re-verification
// (FINDING-024, coordinator loopback). The rev-1 detached-toast fix (FINDING-013) routed EVERY
// close-while-in-flight failure through one uniform DEFINITE-wording toast — but REQ-009's
// close-while-in-flight MUST requires the toast to carry the kind's own honesty class: an
// indeterminate outcome (cli-timeout / ipc-failure — the write may still land) must NOT read as a
// definite non-capture, or the user retries and duplicates (CONV-015). The in-modal failure region
// already branches this correctly; this pins that the DETACHED toast path branches too.
//
// node-env, no jsdom — pinned over literal greppable source text, like the rev-2 sibling suite.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const modal = (): string => readFileSync(resolve(process.cwd(), 'src/renderer/components/OrkyCaptureModal.tsx'), 'utf8')

/** The body of the `if (!stillMounted) { … }` detached-outcome block. */
function detachedBlock(src: string): string {
  const at = src.indexOf('!stillMounted')
  if (at < 0) return ''
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return src.slice(open)
}

describe('detached close-in-flight toast carries the kind honesty class (REQ-009, CONV-015, FINDING-024)', () => {
  it('TEST-529 REQ-009 the detached-outcome toast branches on the failure kind — cli-timeout / ipc-failure get indeterminate wording, not the uniform definite copy', () => {
    const block = detachedBlock(modal())
    expect(block, 'the !stillMounted detached-outcome block must exist').not.toBe('')
    // It must discriminate the indeterminate kinds rather than emit one definite message for all.
    expect(block, 'the detached toast must branch on cli-timeout / ipc-failure (the indeterminate kinds)')
      .toMatch(/cli-timeout|ipc-failure/)
    // The indeterminate branch must warn about a possible duplicate (CONV-015), matching the in-modal copy.
    expect(block, 'the indeterminate detached toast must warn a retry may duplicate')
      .toMatch(/duplicate|uncertain|may (still )?have been captured/i)
    // Both paths still route through the never-suppressed error-kind toast (FINDING-013 preserved).
    expect(block).toMatch(/pushToast\([^)]*,\s*['"]error['"]/)
  })
})
