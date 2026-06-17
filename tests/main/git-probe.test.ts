import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveGitRoot, runGitStatus } from '../../src/main/git/probe'
import { parseStatus } from '../../src/main/git/parse-status'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitprobe-'))
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 't@example.com'])
  git(['config', 'user.name', 'T'])
  writeFileSync(join(dir, 'a.txt'), 'hi')
  git(['add', '.'])
  git(['commit', '-m', 'init'])
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('git probe', () => {
  it('resolves the root and parses a clean repo', async () => {
    const root = await resolveGitRoot(dir)
    expect(root).toBeTruthy()
    const out = await runGitStatus(root!)
    expect(out).not.toBeNull()
    const st = parseStatus(out!)
    expect(st.branch).toBe('main')
    expect(st.dirty).toBe(false)
  })

  it('returns null for a non-repo directory', async () => {
    const non = mkdtempSync(join(tmpdir(), 'nonrepo-'))
    expect(await resolveGitRoot(non)).toBeNull()
    rmSync(non, { recursive: true, force: true })
  })

  it('detects a dirty working tree', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed')
    const root = await resolveGitRoot(dir)
    const st = parseStatus((await runGitStatus(root!))!)
    expect(st.dirty).toBe(true)
    expect(st.unstaged).toBe(1)
  })
})
