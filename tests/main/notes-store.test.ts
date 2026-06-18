import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesStore } from '../../src/main/persistence/notes-store'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'notes-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('NotesStore', () => {
  it('round-trips a note through set + reload', async () => {
    const a = new NotesStore(dir)
    await a.load()
    a.set('/proj', 'hello notes')
    const b = new NotesStore(dir)
    expect(await b.load()).toEqual({ '/proj': 'hello notes' })
  })

  it('prunes a key when the text is empty/whitespace', async () => {
    const a = new NotesStore(dir)
    await a.load()
    a.set('/proj', 'x')
    a.set('/proj', '   ')
    const b = new NotesStore(dir)
    expect(await b.load()).toEqual({})
  })

  it('returns {} for a corrupt file', async () => {
    writeFileSync(join(dir, 'notes.json'), 'not json', 'utf8')
    expect(await new NotesStore(dir).load()).toEqual({})
  })
})
