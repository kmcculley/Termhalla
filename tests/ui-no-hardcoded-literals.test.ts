import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, '../src/renderer/components')
const BANNED = ['#094771', '#5a4a00', '#bbb', "'Consolas, monospace'", '"Consolas, monospace"']

describe('no hardcoded design literals in renderer components', () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.tsx'))
  for (const f of files) {
    it(`${f} uses tokens, not banned literals`, () => {
      const src = readFileSync(join(DIR, f), 'utf8')
      for (const lit of BANNED) expect(src, `${f} contains ${lit}`).not.toContain(lit)
    })
  }
})
