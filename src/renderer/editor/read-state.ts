import type { ReadResult } from '@shared/types'

/** The tab flags an fsRead result resolves to when opening a file. */
export interface TabReadState {
  saved: string
  tooLarge: boolean
  missing: boolean
  binary: boolean
  /** Read failed for an UNKNOWN reason (permissions, transient I/O, invoke rejection) —
   *  whether the file exists is unknown, so this must never render as "(deleted)". */
  readError?: string
}

/** Map a discriminated fsRead result to tab flags (finding 27, 2026-07 quality audit).
 *  `null` models the invoke itself rejecting (handler teardown mid-flight) — also an
 *  unknown failure, never `missing`. Pure (no ../api import) so it unit-tests under vitest. */
export function toTabReadState(r: ReadResult | null): TabReadState {
  if (r === null) return { saved: '', tooLarge: false, missing: false, binary: false, readError: 'read failed' }
  switch (r.kind) {
    case 'ok': return { saved: r.content, tooLarge: r.tooLarge, missing: false, binary: false, readError: undefined }
    case 'binary': return { saved: '', tooLarge: false, missing: false, binary: true, readError: undefined }
    case 'not-found': return { saved: '', tooLarge: false, missing: true, binary: false, readError: undefined }
    case 'error': return { saved: '', tooLarge: false, missing: false, binary: false, readError: r.message || 'read failed' }
  }
}
