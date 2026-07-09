import type { GitStatus } from '@shared/types'

/** Parse `git status --porcelain=v2 --branch` output. Pure: the caller attaches `root`.
 *  Porcelain v2 header lines start with `# branch.*`; entry lines start with `1`/`2`
 *  (changed/renamed, with a two-char XY index/worktree field), `u` (unmerged), `?` (untracked). */
export function parseStatus(stdout: string): Omit<GitStatus, 'root'> {
  let head = ''
  let oid = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let conflicted = 0
  let untracked = 0

  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length).trim()
    else if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length).trim()
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice('# branch.upstream '.length).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) { ahead = Number(m[1]); behind = Number(m[2]) }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.split(' ')[1] ?? '..'
      if (xy[0] !== '.') staged++
      if (xy[1] !== '.') unstaged++
    } else if (line.startsWith('u ')) {
      // Unmerged = its own category (baseline KNOWN BUG #3, fixed 2026-07-09): counting it as
      // `unstaged` surfaced no conflict signal and misread a mid-merge repo's real counts.
      conflicted++
    } else if (line.startsWith('? ')) {
      untracked++
    }
  }

  const detached = head === '(detached)'
  const branch = detached ? (oid ? oid.slice(0, 7) : '(detached)') : head
  const dirty = staged + unstaged + conflicted + untracked > 0
  return { branch, detached, upstream, ahead, behind, staged, unstaged, conflicted, untracked, dirty }
}
