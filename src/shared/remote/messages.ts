/**
 * The closed v1 wire-message vocabulary and its strict validator (REQ-007, REQ-013,
 * REQ-014).
 *
 * Validation is STRICT: client and agent are version-locked (the client provisions the
 * agent), so both ends share one build and one vocabulary — any unknown type, unknown
 * key, or out-of-range field is corruption or a foreign writer, and is rejected with an
 * actionable error naming the offender (REQ-015). `method`/`channel` strings are NOT
 * runtime-restricted to `CH` values — the agent's dispatcher (F16) owns which methods
 * exist per capability; this layer is the envelope.
 *
 * `ack`/`window` are RESERVED shapes: F15 validates and round-trips them; their
 * semantics land in F17 (REQ-013).
 *
 * Pure module: zero Node/Electron imports (REQ-001).
 */
import { isCapabilityId, type CapabilityId } from './capabilities'
import { protocolFailure, type ProtocolFailure } from './errors'

/** Connect handshake frame. `capabilities` is required for agents, forbidden for clients. */
export interface HelloFrame {
  type: 'hello'
  /** Positive integer; `=== WIRE_PROTO` is checked by the handshake, not the parser (REQ-007). */
  proto: number
  role: 'agent' | 'client'
  /** Opaque, non-empty; compared with exact string identity in the handshake (REQ-009). */
  version: string
  capabilities?: CapabilityId[]
}

/** Client → agent request. `params` is REQUIRED (null allowed). */
export interface ReqFrame {
  type: 'req'
  id: number
  method: string
  params: unknown
}

/** Agent → client response; exactly one of `result` / `error` per `ok` polarity. */
export type ResFrame =
  | { type: 'res'; id: number; ok: true; result: unknown }
  | { type: 'res'; id: number; ok: false; error: { message: string; code?: string } }

/** Agent → client push event, mirroring the main→renderer `send(channel, ...args)` shape. */
export interface EvtFrame {
  type: 'evt'
  channel: string
  args: unknown[]
}

/** RESERVED (F17): the client acknowledges `bytes` of pty output for pane `id`. */
export interface AckFrame {
  type: 'ack'
  id: string
  bytes: number
}

/** RESERVED (F17): the unacked-byte window; `id` absent = connection-wide default. */
export interface WindowFrame {
  type: 'window'
  size: number
  id?: string
}

export type WireFrame = HelloFrame | ReqFrame | ResFrame | EvtFrame | AckFrame | WindowFrame

export type ParseResult = { ok: true; frame: WireFrame } | { ok: false; error: ProtocolFailure }

const WIRE_TYPES = ['hello', 'req', 'res', 'evt', 'ack', 'window'] as const

const bad = (message: string, detail: Record<string, unknown> = {}): ParseResult => ({
  ok: false,
  error: protocolFailure('bad-message', message, detail)
})

const describeJsonType = (v: unknown): string => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

const isPositiveInteger = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

interface JsonRepresentabilityIssue {
  path: string
  jsType: string
  problem: 'cycle' | 'non-finite-number' | 'non-json-value' | 'non-plain-object' | 'array-expando' | 'trap-throw'
  /** Bounded constructor name; set for non-plain-object rejections only. */
  prototype?: string
  /** Bounded String(error); set for trap-throw rejections only. */
  cause?: string
}

type JsonStackItem =
  | { value: unknown; path: string; leaving?: false }
  | { value: object; path: string; leaving: true }

const isPlainJsonObject = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Bounded constructor-name description for non-plain rejections — never the value itself. */
const describePrototypeName = (obj: object): string => {
  const name = (obj as { constructor?: { name?: unknown } }).constructor?.name
  return typeof name === 'string' && name.length > 0 ? name.slice(0, 60) : 'null-prototype'
}

const jsonPathForKey = (base: string, key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`

const jsonIssueMessage = ({ path, jsType, problem, prototype, cause }: JsonRepresentabilityIssue): string => {
  if (problem === 'cycle') {
    return `${path} contains a reference cycle (got ${jsType}) - expected JSON-representable data without cycles`
  }
  if (problem === 'non-plain-object') {
    return `${path} must be JSON-representable, got a non-plain object (${prototype ?? 'unknown'}) - JSON.stringify would serialize its toJSON()/enumerable projection instead of the validated shape; convert it to plain JSON data first`
  }
  if (problem === 'non-finite-number') {
    return `${path} must be JSON-representable, got ${jsType} - expected a finite number, not NaN or Infinity`
  }
  if (problem === 'array-expando') {
    return `${path} is an own non-index array key - JSON.stringify silently DROPS expando keys when serializing arrays; move the value into an object or a canonical index`
  }
  if (problem === 'trap-throw') {
    return `${path} could not be inspected for JSON representability - a property accessor or proxy trap threw (${cause ?? 'unknown error'}); wire values must be inert JSON data`
  }
  return `${path} must be JSON-representable, got ${jsType} - expected null, boolean, string, finite number, array, or plain object`
}

const validateJsonRepresentable = (value: unknown, rootPath: string): ParseResult | null => {
  const stack: JsonStackItem[] = [{ value, path: rootPath }]
  const active = new WeakSet<object>()
  // Best-known path for trap-thrown failures (FINDING-010): property reads below can
  // invoke hostile getters/Proxy traps on LOCAL input; the catch converts the raw throw
  // into a structured rejection at the last visited path. Wire-decoded input never
  // throws here (JSON.parse output carries no accessors, proxies, or foreign prototypes).
  let cursor = rootPath

  try {
    while (stack.length > 0) {
      const item = stack.pop()!
      const v = item.value

      if (item.leaving) {
        active.delete(item.value)
        continue
      }
      cursor = item.path

      if (v === null) continue

      const t = typeof v
      if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
        const issue: JsonRepresentabilityIssue = { path: item.path, jsType: t, problem: 'non-json-value' }
        return bad(jsonIssueMessage(issue), { ...issue })
      }
      if (t === 'number') {
        if (!Number.isFinite(v)) {
          const issue: JsonRepresentabilityIssue = { path: item.path, jsType: t, problem: 'non-finite-number' }
          return bad(jsonIssueMessage(issue), { ...issue })
        }
        continue
      }
      if (t !== 'object') continue

      const obj = v as object
      if (active.has(obj)) {
        const issue: JsonRepresentabilityIssue = { path: item.path, jsType: describeJsonType(v), problem: 'cycle' }
        return bad(jsonIssueMessage(issue), { ...issue })
      }

      if (Array.isArray(v)) {
        // Mirror JSON.stringify's array semantics exactly: it looks up `toJSON` via
        // [[Get]] (own OR inherited — Object.setPrototypeOf([1], { toJSON }) serializes
        // toJSON()'s return, not the entries), then serializes indices 0..length-1 ONLY
        // (own non-index expando keys are silently dropped). Reject both divergences.
        if (typeof (v as { toJSON?: unknown }).toJSON === 'function') {
          const issue: JsonRepresentabilityIssue = { path: jsonPathForKey(item.path, 'toJSON'), jsType: 'function', problem: 'non-json-value' }
          return bad(jsonIssueMessage(issue), { ...issue })
        }
        for (const key of Object.keys(v)) {
          const idx = Number(key)
          if (!(String(idx) === key && Number.isInteger(idx) && idx >= 0 && idx < v.length)) {
            const issue: JsonRepresentabilityIssue = {
              path: jsonPathForKey(item.path, key),
              jsType: describeJsonType((v as unknown as Record<string, unknown>)[key]),
              problem: 'array-expando'
            }
            return bad(jsonIssueMessage(issue), { ...issue })
          }
        }
        active.add(obj)
        stack.push({ value: obj, path: item.path, leaving: true })
        for (let i = v.length - 1; i >= 0; i--) {
          stack.push({ value: v[i], path: `${item.path}[${i}]` })
        }
        continue
      }

      if (!isPlainJsonObject(obj)) {
        const issue: JsonRepresentabilityIssue = {
          path: item.path,
          jsType: describeJsonType(v),
          problem: 'non-plain-object',
          prototype: describePrototypeName(obj)
        }
        return bad(jsonIssueMessage(issue), { ...issue })
      }
      // Plain object (prototype locked to Object.prototype/null above): a callable
      // `toJSON` is necessarily an own property — or Object.prototype pollution — and
      // the [[Get]] check catches both, exactly as JSON.stringify will look it up.
      if (typeof (v as { toJSON?: unknown }).toJSON === 'function') {
        const issue: JsonRepresentabilityIssue = { path: jsonPathForKey(item.path, 'toJSON'), jsType: 'function', problem: 'non-json-value' }
        return bad(jsonIssueMessage(issue), { ...issue })
      }

      active.add(obj)
      stack.push({ value: obj, path: item.path, leaving: true })
      const keys = Object.keys(v as Record<string, unknown>)
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i]
        stack.push({ value: (v as Record<string, unknown>)[key], path: jsonPathForKey(item.path, key) })
      }
    }

    return null
  } catch (e) {
    const issue: JsonRepresentabilityIssue = {
      path: cursor,
      jsType: 'unknown',
      problem: 'trap-throw',
      cause: String(e).slice(0, 120)
    }
    return bad(jsonIssueMessage(issue), { ...issue })
  }
}
/** Reject any key outside the type's enumerated shape (strict — see module header). */
const unknownKey = (obj: Record<string, unknown>, allowed: readonly string[], where: string): ParseResult | null => {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      return bad(`unexpected key "${key}" on a ${where} — the v1 shape does not include it`, { key, where })
    }
  }
  return null
}

const parseHello = (m: Record<string, unknown>): ParseResult => {
  const extra = unknownKey(m, ['type', 'proto', 'role', 'version', 'capabilities'], 'hello frame')
  if (extra) return extra
  if (!isPositiveInteger(m.proto)) {
    return bad(`hello "proto" must be a positive integer, got ${JSON.stringify(m.proto)}`, { proto: m.proto })
  }
  if (m.role !== 'agent' && m.role !== 'client') {
    return bad(`hello "role" must be "agent" or "client", got ${JSON.stringify(m.role)}`, { role: m.role })
  }
  if (!isNonEmptyString(m.version)) {
    return bad(`hello "version" must be a non-empty string, got ${JSON.stringify(m.version)}`, { version: m.version })
  }
  const hasCapabilities = 'capabilities' in m
  if (m.role === 'agent' && !hasCapabilities) {
    return bad('an agent hello must advertise "capabilities" (the client greys out unsupported domains from it)', { role: m.role })
  }
  if (m.role === 'client' && hasCapabilities) {
    return bad('a client hello must not carry "capabilities" (only the agent advertises domains)', { role: m.role })
  }
  if (hasCapabilities) {
    const caps = m.capabilities
    if (!Array.isArray(caps)) {
      return bad(`hello "capabilities" must be an array, got ${describeJsonType(caps)}`, { capabilities: caps })
    }
    const seen = new Set<string>()
    for (const c of caps) {
      if (typeof c !== 'string') {
        return bad(`capability ids must be strings, got ${describeJsonType(c)}`, { capability: c })
      }
      if (!isCapabilityId(c)) {
        return bad(`unknown capability id "${c}" — not in the closed CAPABILITY_IDS vocabulary`, { capability: c })
      }
      if (seen.has(c)) {
        return bad(`duplicate capability id "${c}" in the advertisement`, { capability: c })
      }
      seen.add(c)
    }
  }
  return { ok: true, frame: m as unknown as HelloFrame }
}

const parseReq = (m: Record<string, unknown>): ParseResult => {
  const extra = unknownKey(m, ['type', 'id', 'method', 'params'], 'req frame')
  if (extra) return extra
  if (!isPositiveInteger(m.id)) {
    return bad(`req "id" must be a positive integer, got ${JSON.stringify(m.id)}`, { id: m.id })
  }
  if (!isNonEmptyString(m.method)) {
    return bad(`req "method" must be a non-empty string, got ${JSON.stringify(m.method)}`, { method: m.method })
  }
  if (!('params' in m)) {
    return bad('req frame is missing the required "params" key (null is allowed, absence is not)', { key: 'params' })
  }
  const paramsJson = validateJsonRepresentable(m.params, 'req.params')
  if (paramsJson) return paramsJson
  return { ok: true, frame: m as unknown as ReqFrame }
}

const parseRes = (m: Record<string, unknown>): ParseResult => {
  if (!isPositiveInteger(m.id)) {
    return bad(`res "id" must be a positive integer, got ${JSON.stringify(m.id)}`, { id: m.id })
  }
  if (typeof m.ok !== 'boolean') {
    return bad(`res "ok" must be a boolean, got ${JSON.stringify(m.ok)}`, { ok: m.ok })
  }
  if (m.ok) {
    const extra = unknownKey(m, ['type', 'id', 'ok', 'result'], 'res(ok:true) frame')
    if (extra) return extra
    if (!('result' in m)) {
      return bad('an ok:true res must carry the "result" key (null is allowed, absence is not)', { key: 'result' })
    }
    const resultJson = validateJsonRepresentable(m.result, 'res(ok:true).result')
    if (resultJson) return resultJson
  } else {
    const extra = unknownKey(m, ['type', 'id', 'ok', 'error'], 'res(ok:false) frame')
    if (extra) return extra
    if (!('error' in m)) {
      return bad('an ok:false res must carry the "error" object', { key: 'error' })
    }
    const err = m.error
    if (typeof err !== 'object' || err === null || Array.isArray(err)) {
      return bad(`res "error" must be an object, got ${describeJsonType(err)}`, { error: err })
    }
    const errObj = err as Record<string, unknown>
    const extraErr = unknownKey(errObj, ['message', 'code'], 'res error object')
    if (extraErr) return extraErr
    if (!isNonEmptyString(errObj.message)) {
      return bad(`res error "message" must be a non-empty string, got ${JSON.stringify(errObj.message)}`, { message: errObj.message })
    }
    if ('code' in errObj && !isNonEmptyString(errObj.code)) {
      return bad(`res error "code", when present, must be a non-empty string, got ${JSON.stringify(errObj.code)}`, { code: errObj.code })
    }
  }
  return { ok: true, frame: m as unknown as ResFrame }
}

const parseEvt = (m: Record<string, unknown>): ParseResult => {
  const extra = unknownKey(m, ['type', 'channel', 'args'], 'evt frame')
  if (extra) return extra
  if (!isNonEmptyString(m.channel)) {
    return bad(`evt "channel" must be a non-empty string, got ${JSON.stringify(m.channel)}`, { channel: m.channel })
  }
  if (!('args' in m)) {
    return bad('evt frame is missing the required "args" array', { key: 'args' })
  }
  if (!Array.isArray(m.args)) {
    return bad(`evt "args" must be an array, got ${describeJsonType(m.args)}`, { args: m.args })
  }
  const argsJson = validateJsonRepresentable(m.args, 'evt.args')
  if (argsJson) return argsJson
  return { ok: true, frame: m as unknown as EvtFrame }
}

const parseAck = (m: Record<string, unknown>): ParseResult => {
  const extra = unknownKey(m, ['type', 'id', 'bytes'], 'ack frame')
  if (extra) return extra
  if (!isNonEmptyString(m.id)) {
    return bad(`ack "id" must be a non-empty pane id string, got ${JSON.stringify(m.id)}`, { id: m.id })
  }
  if (!('bytes' in m)) {
    return bad('ack frame is missing the required "bytes" count', { key: 'bytes' })
  }
  if (!isPositiveInteger(m.bytes)) {
    return bad(`ack "bytes" must be a positive integer, got ${JSON.stringify(m.bytes)}`, { bytes: m.bytes })
  }
  return { ok: true, frame: m as unknown as AckFrame }
}

const parseWindow = (m: Record<string, unknown>): ParseResult => {
  const extra = unknownKey(m, ['type', 'size', 'id'], 'window frame')
  if (extra) return extra
  if (!('size' in m)) {
    return bad('window frame is missing the required "size" (bytes)', { key: 'size' })
  }
  if (!isPositiveInteger(m.size)) {
    return bad(`window "size" must be a positive integer, got ${JSON.stringify(m.size)}`, { size: m.size })
  }
  if ('id' in m && !isNonEmptyString(m.id)) {
    return bad(`window "id", when present, must be a non-empty pane id string, got ${JSON.stringify(m.id)}`, { id: m.id })
  }
  return { ok: true, frame: m as unknown as WindowFrame }
}

/**
 * Validate an arbitrary JSON value as a v1 wire message (REQ-007). Strict: unknown
 * types, unknown keys, and out-of-range fields are all rejected with the offender named
 * in both `message` and `detail`.
 */
export const parseWireMessage = (value: unknown): ParseResult => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return bad(`a wire message must be a JSON object, got ${describeJsonType(value)}`, { received: describeJsonType(value) })
  }
  const m = value as Record<string, unknown>
  const t = m.type
  if (typeof t !== 'string') {
    return bad(`wire frame "type" must be a string, got ${describeJsonType(t)}`, { type: t })
  }
  switch (t) {
    case 'hello': return parseHello(m)
    case 'req': return parseReq(m)
    case 'res': return parseRes(m)
    case 'evt': return parseEvt(m)
    case 'ack': return parseAck(m)
    case 'window': return parseWindow(m)
    default:
      return bad(`unknown wire frame type "${t}" — expected one of ${WIRE_TYPES.join('|')}`, { type: t })
  }
}
