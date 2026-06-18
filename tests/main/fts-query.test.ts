import { describe, it, expect } from 'vitest'
import { toMatchExpr } from '../../src/main/search/fts-query'

describe('toMatchExpr', () => {
  it('quotes each token and ANDs them (implicit)', () => {
    expect(toMatchExpr('npm test')).toBe('"npm" "test"')
  })
  it('strips embedded double-quotes so the MATCH never has a syntax error', () => {
    expect(toMatchExpr('say "hi"')).toBe('"say" "hi"')
  })
  it('neutralizes FTS5 special chars by quoting', () => {
    // ( ) * : ^ - become literal inside double quotes
    expect(toMatchExpr('foo(bar)*')).toBe('"foo(bar)*"')
  })
  it('returns empty string for blank/whitespace input', () => {
    expect(toMatchExpr('   ')).toBe('')
    expect(toMatchExpr('')).toBe('')
  })
})
