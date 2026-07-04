/**
 * Strict wire-param validation for the four pty methods (REQ-009). Version-locked peers
 * (locked decision 2) share one build, so a malformed param set is corruption or a foreign
 * writer — exactly F15's strictness stance: unknown keys rejected by name, every field type-
 * and range-checked, and every rejection names the offender, the offending value, and the
 * expectation (CONV-001/CONV-002). A rejection never partially executes (the session only
 * touches a backend AFTER validation passes — TEST-772).
 */
import type { PtySpawnArgs, PtyWriteArgs, PtyResizeArgs } from '@shared/ipc-contract'

export interface InvalidParams {
  ok: false
  code: 'bad-params'
  message: string
}

export type ValidSpawn = { ok: true; args: PtySpawnArgs } | InvalidParams
export type ValidWrite = { ok: true; args: PtyWriteArgs } | InvalidParams
export type ValidResize = { ok: true; args: PtyResizeArgs } | InvalidParams
export type ValidKill = { ok: true; id: string } | InvalidParams

const bad = (message: string): InvalidParams => ({ ok: false, code: 'bad-params', message })

const show = (v: unknown): string => {
  if (v === undefined) return 'undefined'
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

/** Discriminated wrapper — the inbound params object itself can never impersonate a result
 *  (it is wrapped, not returned), so a params value shaped like `{ ok: false }` stays data. */
type RecordResult = { ok: true; rec: Record<string, unknown> } | InvalidParams

const asRecord = (params: unknown, method: string): RecordResult => {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return bad(`${method} params must be a JSON object, got ${show(params)} - expected the shared args shape`)
  }
  return { ok: true, rec: params as Record<string, unknown> }
}

const unknownKeys = (m: Record<string, unknown>, allowed: readonly string[], method: string): InvalidParams | null => {
  for (const key of Object.keys(m)) {
    if (!allowed.includes(key)) {
      return bad(`${method} params carry the unknown key "${key}" - the v1 shape allows only ${allowed.join(', ')}`)
    }
  }
  return null
}

const nonEmptyString = (m: Record<string, unknown>, key: string, method: string): InvalidParams | null => {
  const v = m[key]
  if (typeof v !== 'string' || v.length === 0) {
    return bad(`${method} "${key}" must be a non-empty string, got ${show(v)}`)
  }
  return null
}

const positiveInt = (m: Record<string, unknown>, key: string, method: string): InvalidParams | null => {
  const v = m[key]
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    return bad(`${method} "${key}" must be a positive integer, got ${show(v)} - dimensions are validated, never clamped`)
  }
  return null
}

export const validateSpawnParams = (params: unknown): ValidSpawn => {
  const r = asRecord(params, 'pty:spawn')
  if (!r.ok) return r
  const m = r.rec
  // launch/envId are KNOWN local-contract keys, rejected by name as unsupported (REQ-009):
  // launch commands and env-vault ids are local features a v1 remote pane does not carry.
  for (const field of ['launch', 'envId']) {
    if (field in m) {
      return bad(`pty:spawn "${field}" is unsupported for remote panes in v1 - omit it (local-only feature)`)
    }
  }
  const extra = unknownKeys(m, ['id', 'shellId', 'cwd', 'cols', 'rows'], 'pty:spawn')
  if (extra) return extra
  const id = nonEmptyString(m, 'id', 'pty:spawn')
  if (id) return id
  if (typeof m.shellId !== 'string') {
    return bad(`pty:spawn "shellId" must be a string, got ${show(m.shellId)}`)
  }
  if (typeof m.cwd !== 'string') {
    return bad(`pty:spawn "cwd" must be a string (empty = the agent home dir), got ${show(m.cwd)}`)
  }
  const cols = positiveInt(m, 'cols', 'pty:spawn')
  if (cols) return cols
  const rows = positiveInt(m, 'rows', 'pty:spawn')
  if (rows) return rows
  return { ok: true, args: m as unknown as PtySpawnArgs }
}

export const validateWriteParams = (params: unknown): ValidWrite => {
  const r = asRecord(params, 'pty:write')
  if (!r.ok) return r
  const m = r.rec
  const extra = unknownKeys(m, ['id', 'data'], 'pty:write')
  if (extra) return extra
  const id = nonEmptyString(m, 'id', 'pty:write')
  if (id) return id
  if (typeof m.data !== 'string') {
    return bad(`pty:write "data" must be a string, got ${show(m.data)}`)
  }
  return { ok: true, args: m as unknown as PtyWriteArgs }
}

export const validateResizeParams = (params: unknown): ValidResize => {
  const r = asRecord(params, 'pty:resize')
  if (!r.ok) return r
  const m = r.rec
  const extra = unknownKeys(m, ['id', 'cols', 'rows'], 'pty:resize')
  if (extra) return extra
  const id = nonEmptyString(m, 'id', 'pty:resize')
  if (id) return id
  const cols = positiveInt(m, 'cols', 'pty:resize')
  if (cols) return cols
  const rows = positiveInt(m, 'rows', 'pty:resize')
  if (rows) return rows
  return { ok: true, args: m as unknown as PtyResizeArgs }
}

export const validateKillParams = (params: unknown): ValidKill => {
  if (typeof params !== 'string' || params.length === 0) {
    return bad(`pty:kill params must be the pane id as a non-empty string (mirroring TermhallaApi.ptyKill), got ${show(params)}`)
  }
  return { ok: true, id: params }
}
