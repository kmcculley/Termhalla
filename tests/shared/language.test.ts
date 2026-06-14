import { describe, it, expect } from 'vitest'
import { languageForPath } from '@shared/language'

describe('languageForPath', () => {
  it('maps common extensions to Monaco language ids', () => {
    expect(languageForPath('C:\\x\\main.ts')).toBe('typescript')
    expect(languageForPath('a.tsx')).toBe('typescript')
    expect(languageForPath('a.js')).toBe('javascript')
    expect(languageForPath('a.py')).toBe('python')
    expect(languageForPath('a.json')).toBe('json')
    expect(languageForPath('a.md')).toBe('markdown')
    expect(languageForPath('a.css')).toBe('css')
    expect(languageForPath('a.ps1')).toBe('powershell')
  })
  it('is case-insensitive', () => {
    expect(languageForPath('README.MD')).toBe('markdown')
  })
  it('falls back to plaintext for unknown or missing extensions', () => {
    expect(languageForPath('a.unknownext')).toBe('plaintext')
    expect(languageForPath('Makefile')).toBe('plaintext')
    expect(languageForPath('/path/to/noext')).toBe('plaintext')
  })
})
