import type {
  ResolveEscalationRequest,
  SubmitWorkRequest,
  RecordHumanGateRequest,
  DriveStatusRequest
} from './types'

/**
 * Pure request validation for the four `orkyAction:*` actions (feature 0007, TASK-002). Covers
 * feature-slug confinement (REQ-005) and malformed/empty/boundary tolerance (REQ-014, CONV-002).
 * NEVER throws. Every distinct rejection reason carries its OWN, field-specific message (CONV-001) —
 * this is what REQ-014's "distinct actionable message per rejection" acceptance is graded against.
 *
 * `gate` is validated here ONLY for shape (non-empty string) — the `{brainstorm,human-review}` SET
 * restriction is a SEPARATE, dispatcher-level business rule (REQ-008) that returns the distinct
 * `errorKind:'gate-not-allowed'`, never `invalid-args`, for a shape-valid-but-disallowed gate like
 * 'spec' (see 04-tests.md "Reconciled judgment calls" #1). `verdict` has no such split — its only two
 * valid values ARE its whole shape — so it stays fully enum-checked here.
 */

export type ValidationResult<T> = { ok: true; req: T } | { ok: false; error: string }

/** The shared single-path-segment check reused by every feature-scoped validator (REQ-005). Rejects
 *  any value containing a path separator (`/` or `\`), a literal `..` segment, or an absolute-path
 *  form — never resolves outside `<projectRoot>/.orky/features/`. */
export function validateFeatureSlug(slug: unknown): { ok: true; slug: string } | { ok: false; error: string } {
  if (typeof slug !== 'string') return { ok: false, error: 'feature must be a string' }
  if (slug.length === 0) return { ok: false, error: 'feature must not be empty' }
  if (slug === '..' || slug === '.') return { ok: false, error: 'feature must not be ".." or "."' }
  if (slug.includes('/') || slug.includes('\\')) {
    return { ok: false, error: 'feature must be a single path segment (no / or \\)' }
  }
  if (isAbsolutePathLike(slug)) return { ok: false, error: 'feature must not be an absolute path' }
  const flagLike = rejectFlagLike('feature', slug)
  if (flagLike) return flagLike
  return { ok: true, slug }
}

/** CLI-argument-injection guard (ESC-003 / FINDING-SEC-001): several fields travel as a RAW, un-encoded
 *  argv element to Orky's `gatekeeper` CLI, whose own naive `parseArgs` reinterprets ANY `--`-prefixed
 *  argv token as a new flag regardless of position. Reject such values here, before they can ever reach
 *  that raw argv position. Returns `null` when `value` is fine. */
function rejectFlagLike(field: string, value: string): { ok: false; error: string } | null {
  if (value.startsWith('--')) {
    return { ok: false, error: `${field} must not start with '--' (reserved for CLI flags)` }
  }
  return null
}

/** Windows drive-absolute ("C:foo", "C:\\foo") or POSIX-absolute ("/foo") forms with no separator
 *  already caught above — this only needs to catch the no-separator drive-letter case. */
function isAbsolutePathLike(slug: string): boolean {
  return /^[a-zA-Z]:/.test(slug)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function requireString(input: Record<string, unknown>, field: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = input[field]
  if (v === undefined || v === null) return { ok: false, error: `${field} is required` }
  if (typeof v !== 'string') return { ok: false, error: `${field} must be a string` }
  return { ok: true, value: v }
}

function requireNonEmptyString(input: Record<string, unknown>, field: string): { ok: true; value: string } | { ok: false; error: string } {
  const r = requireString(input, field)
  if (!r.ok) return r
  if (r.value.length === 0) return { ok: false, error: `${field} must not be empty` }
  return r
}

function optionalString(input: Record<string, unknown>, field: string): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const v = input[field]
  if (v === undefined) return { ok: true, value: undefined }
  if (typeof v !== 'string') return { ok: false, error: `${field} must be a string` }
  return { ok: true, value: v }
}

/** For the three actions where `feature` is REQUIRED (resolveEscalation/recordHumanGate/driveStatus —
 *  unlike submitWork, where it is optional): checks presence FIRST with the same "is required" phrasing
 *  every other required field uses, and only delegates to `validateFeatureSlug` (for its own
 *  shape/confinement checks) once a value is actually present. */
function requireFeatureSlug(input: Record<string, unknown>): { ok: true; slug: string } | { ok: false; error: string } {
  if (input.feature === undefined || input.feature === null) return { ok: false, error: 'feature is required' }
  return validateFeatureSlug(input.feature)
}

export function validateResolveEscalationRequest(input: unknown): ValidationResult<ResolveEscalationRequest> {
  if (!isPlainObject(input)) return { ok: false, error: 'request must be an object' }

  const projectRoot = requireNonEmptyString(input, 'projectRoot')
  if (!projectRoot.ok) return projectRoot
  // projectRoot travels as a RAW `--app <root>` argv element in every dispatch path; defend it with
  // the same flag-like guard the other raw argv fields use (REQ-013/FINDING-011), fired right after
  // extraction so its field-specific message wins over any later field's rejection (CONV-001).
  const projectRootFlagLike = rejectFlagLike('projectRoot', projectRoot.value)
  if (projectRootFlagLike) return projectRootFlagLike

  const slug = requireFeatureSlug(input)
  if (!slug.ok) return { ok: false, error: slug.error }

  const escalationId = requireNonEmptyString(input, 'escalationId')
  if (!escalationId.ok) return escalationId
  const escalationIdFlagLike = rejectFlagLike('escalationId', escalationId.value)
  if (escalationIdFlagLike) return escalationIdFlagLike

  const decision = requireNonEmptyString(input, 'decision')
  if (!decision.ok) return decision
  const decisionFlagLike = rejectFlagLike('decision', decision.value)
  if (decisionFlagLike) return decisionFlagLike

  return {
    ok: true,
    req: { projectRoot: projectRoot.value, feature: slug.slug, escalationId: escalationId.value, decision: decision.value }
  }
}

export function validateSubmitWorkRequest(input: unknown): ValidationResult<SubmitWorkRequest> {
  if (!isPlainObject(input)) return { ok: false, error: 'request must be an object' }

  const projectRoot = requireNonEmptyString(input, 'projectRoot')
  if (!projectRoot.ok) return projectRoot
  // projectRoot travels as a RAW `--app <root>` argv element in every dispatch path; defend it with
  // the same flag-like guard the other raw argv fields use (REQ-013/FINDING-011), fired right after
  // extraction so its field-specific message wins over any later field's rejection (CONV-001).
  const projectRootFlagLike = rejectFlagLike('projectRoot', projectRoot.value)
  if (projectRootFlagLike) return projectRootFlagLike

  let feature: string | undefined
  if (input.feature !== undefined) {
    const slug = validateFeatureSlug(input.feature)
    if (!slug.ok) return { ok: false, error: slug.error }
    feature = slug.slug
  }

  const title = requireNonEmptyString(input, 'title')
  if (!title.ok) return title

  const detail = optionalString(input, 'detail')
  if (!detail.ok) return detail

  const phase = optionalString(input, 'phase')
  if (!phase.ok) return phase

  const req: SubmitWorkRequest = { projectRoot: projectRoot.value, title: title.value }
  if (feature !== undefined) req.feature = feature
  if (detail.value !== undefined) req.detail = detail.value
  if (phase.value !== undefined) req.phase = phase.value
  return { ok: true, req }
}

export function validateRecordHumanGateRequest(input: unknown): ValidationResult<RecordHumanGateRequest> {
  if (!isPlainObject(input)) return { ok: false, error: 'request must be an object' }

  const projectRoot = requireNonEmptyString(input, 'projectRoot')
  if (!projectRoot.ok) return projectRoot
  // projectRoot travels as a RAW `--app <root>` argv element in every dispatch path; defend it with
  // the same flag-like guard the other raw argv fields use (REQ-013/FINDING-011), fired right after
  // extraction so its field-specific message wins over any later field's rejection (CONV-001).
  const projectRootFlagLike = rejectFlagLike('projectRoot', projectRoot.value)
  if (projectRootFlagLike) return projectRootFlagLike

  const slug = requireFeatureSlug(input)
  if (!slug.ok) return { ok: false, error: slug.error }

  const gate = requireNonEmptyString(input, 'gate')
  if (!gate.ok) return gate

  const verdictField = requireString(input, 'verdict')
  if (!verdictField.ok) return verdictField
  if (verdictField.value !== 'pass' && verdictField.value !== 'fail') {
    return { ok: false, error: "verdict must be 'pass' or 'fail'" }
  }

  const evidence = optionalString(input, 'evidence')
  if (!evidence.ok) return evidence
  if (evidence.value !== undefined) {
    const evidenceFlagLike = rejectFlagLike('evidence', evidence.value)
    if (evidenceFlagLike) return evidenceFlagLike
  }

  const req: RecordHumanGateRequest = {
    projectRoot: projectRoot.value,
    feature: slug.slug,
    gate: gate.value as RecordHumanGateRequest['gate'],
    verdict: verdictField.value
  }
  if (evidence.value !== undefined) req.evidence = evidence.value
  return { ok: true, req }
}

export function validateDriveStatusRequest(input: unknown): ValidationResult<DriveStatusRequest> {
  if (!isPlainObject(input)) return { ok: false, error: 'request must be an object' }

  const projectRoot = requireNonEmptyString(input, 'projectRoot')
  if (!projectRoot.ok) return projectRoot
  // projectRoot travels as a RAW `--app <root>` argv element in every dispatch path; defend it with
  // the same flag-like guard the other raw argv fields use (REQ-013/FINDING-011), fired right after
  // extraction so its field-specific message wins over any later field's rejection (CONV-001).
  const projectRootFlagLike = rejectFlagLike('projectRoot', projectRoot.value)
  if (projectRootFlagLike) return projectRootFlagLike

  const slug = requireFeatureSlug(input)
  if (!slug.ok) return { ok: false, error: slug.error }

  return { ok: true, req: { projectRoot: projectRoot.value, feature: slug.slug } }
}
