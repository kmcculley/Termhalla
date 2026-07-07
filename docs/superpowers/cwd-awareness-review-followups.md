# CWD Awareness — Review Follow-ups (deferred)

Final review (2026-06-14) returned **READY WITH MINOR FOLLOW-UPS**. The one
**Critical** (unguarded `decodeURIComponent` crashing on a literal `%` in a bash
cwd) was **fixed** in commit `53f8b7b` (try/catch fallback + a regression test).
The minor items below were deferred.

## Minor follow-ups

- **OSC 7 path containing a literal `;` mis-parses** (`cwd-parser.ts`). The parser
  splits the OSC body on the first `;` to read the OSC number, so a bash cwd like
  `c/de;v` would be silently dropped. OSC 9;9 (PowerShell, the primary path) is
  immune (it slices after the `9;` prefix). Bash-only and rare on Windows; defer.
- ~~**`cwds` / `statuses` runtime maps are not cleaned up on `closePane`** (`store.ts`).~~
  **RESOLVED since** (verified 2026-07-07): `closePane` routes every per-pane runtime map
  (statuses/cwds/procs/usage/…) through the shared `clearPaneRuntime` (the 2026-06-16 store
  refactor, sub-project C's cleanup-parity fix).

## Spec/impl note

The spec (§3) says the bash OSC 7 path is "URL-encoded", but the injected
`termhalla.sh` emits the raw `$PWD`. The parser's guarded `decodeURIComponent`
handles both (decodes valid escapes, falls back to raw otherwise), so behavior is
correct; if strict encoding is ever wanted, encode in the script and the parser
will decode it. bash live-cwd has unit coverage but no live e2e (the e2e covers
PowerShell, per spec §7).
