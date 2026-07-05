import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceDocStore } from '../../src/main/persistence/workspace-doc-store'

function freshDir(): string { return mkdtempSync(join(tmpdir(), 'termh-wsdoc-')) }
const docsFile = (dir: string) => join(dir, 'workspace-docs.json')

describe('WorkspaceDocStore', () => {
  let dir: string
  beforeEach(() => { dir = freshDir() })

  it('starts empty when no file exists', async () => {
    const store = new WorkspaceDocStore(dir)
    expect(await store.load()).toEqual({})
    expect(store.all()).toEqual({})
  })

  it('set persists a workspace→path binding and load reads it back', async () => {
    const a = new WorkspaceDocStore(dir)
    await a.load()
    a.set('ws1', 'C:/docs/a.thws')
    // A fresh instance reads the persisted map.
    const b = new WorkspaceDocStore(dir)
    expect(await b.load()).toEqual({ ws1: 'C:/docs/a.thws' })
  })

  it('clear removes a binding', async () => {
    const store = new WorkspaceDocStore(dir)
    await store.load()
    store.set('ws1', 'C:/docs/a.thws')
    store.clear('ws1')
    expect(store.all()).toEqual({})
    const reloaded = new WorkspaceDocStore(dir)
    expect(await reloaded.load()).toEqual({})
  })

  it('ignores empty ids/paths and is a no-op when unchanged', async () => {
    const store = new WorkspaceDocStore(dir)
    await store.load()
    store.set('', 'C:/x.thws')
    store.set('ws1', '')
    expect(store.all()).toEqual({})
    store.set('ws1', 'C:/x.thws')
    expect(store.all()).toEqual({ ws1: 'C:/x.thws' })
  })

  it('sanitizes a corrupt/hostile file to string→string entries only', async () => {
    writeFileSync(docsFile(dir), JSON.stringify({ ws1: 'C:/ok.thws', ws2: 42, ws3: null, ws4: '' }))
    const store = new WorkspaceDocStore(dir)
    expect(await store.load()).toEqual({ ws1: 'C:/ok.thws' })
  })

  it('degrades a non-JSON file to empty rather than throwing', async () => {
    writeFileSync(docsFile(dir), 'not json{')
    const store = new WorkspaceDocStore(dir)
    expect(await store.load()).toEqual({})
  })

  it('flush writes the current map to disk', async () => {
    const store = new WorkspaceDocStore(dir)
    await store.load()
    store.set('ws1', 'C:/a.thws')
    store.flush()
    expect(JSON.parse(readFileSync(docsFile(dir), 'utf8'))).toEqual({ ws1: 'C:/a.thws' })
  })
})
