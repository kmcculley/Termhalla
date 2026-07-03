import { useEffect, useRef, useState } from 'react'
import type { OrkyRootDetailResult } from '@shared/types'
import { api } from '../api'
import { useStore } from '../store'
import {
  answerModeFor,
  bindEscalationTarget,
  buildDriveStatusRequest,
  buildRecordHumanGateRequest,
  buildResolveEscalationRequest,
  flightKey,
  isInFlight,
  settleAnswer,
  settlePreview,
  subscribeFlights,
  verifyEscalationTarget,
  withSingleFlight,
  type EscalationBinding,
  type OrkyActionSettleInput,
  type OrkyEntryActionKind,
  type OrkyEntryTarget,
  type SettledOutcome
} from './orky-entry-actions-core'
import { useOpenFocusRestore } from './use-open-focus-restore'

/**
 * The shared entry-action layer (feature 0008, D5/REQ-011): answer an escalation / record a
 * human-review verdict, the read-only next-action preview, and resume-in-terminal — one hook + one
 * presentational region, keyed on the OrkyEntryTarget identity and mounted by the decision-queue
 * rows today and F10's OrkyPane feature rows next, verbatim. Everything decision-shaped (the
 * cross-instance single-flight gate, the escalation identity binding + submit-time
 * re-verification, the request builders, the result-honesty classifier) lives in the pure core
 * module; THIS file is the composition point — the ONLY renderer home of the three F7 action
 * bridges (REQ-001), while the resume launch rides the store's narrow launchTerminalAt action
 * (REQ-014, FINDING-008).
 *
 * Every dispatch is tied to an explicit user gesture: the calls below sit exclusively inside
 * event-handler functions, never an effect body (REQ-006, CONV-033) — merely mounting this region
 * dispatches nothing and commits no pane.
 */

/** The per-entry action lifecycle a mounted instance renders. Pending is ALSO derived from the
 *  shared gate (see the hook), so a second mount of the same target shows it too (REQ-007). */
export type OrkyEntryActionPhase =
  | { status: 'idle' }
  | { status: 'pending'; action: OrkyEntryActionKind }
  | { status: 'success'; action: OrkyEntryActionKind; message: string }
  | { status: 'failure'; action: OrkyEntryActionKind; kind: string; error: string; message: string; indeterminate: boolean }

/** The display-time escalation binding state: null = not requested, 'pending' = pull in flight. */
export type AnswerBinding = EscalationBinding | 'pending' | null

/** The injected F9 detail pull the pure core consumes — the composition point the testability
 *  rule prescribes (the core never imports the api module itself). */
const registryDetail = (root: string): Promise<OrkyRootDetailResult> => api.registryDetail(root)

export function useOrkyEntryActions(target: OrkyEntryTarget, hostHidden = false) {
  const [phase, setPhase] = useState<OrkyEntryActionPhase>({ status: 'idle' })
  const [binding, setBinding] = useState<AnswerBinding>(null)

  // Cross-instance pending (REQ-007): re-render on every shared-gate acquire/release so EVERY
  // mounted instance of the same target — an F8 row and an F10 pane row alike — renders the
  // pending state while a flight it did not start is in the air.
  const [, setFlightTick] = useState(0)
  useEffect(() => subscribeFlights(() => setFlightTick(t => t + 1)), [])

  // Detached-outcome tracking (REQ-010): a settle that arrives after unmount must never update the
  // removed component — it routes through the store-level toast chokepoint instead (see deliver).
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  // Hidden-at-settle tracking (FINDING-018, feature 0010 REQ-005): mount-aliveness alone is a bad
  // user-visibility proxy for the PANE mount, which lives inside keep-mounted-HIDDEN hosts (an
  // inactive workspace / maximized-over — PaneTile's hidden prop — and the minimized host). The
  // host threads its own hidden signal in as the OPTIONAL hostHidden argument (the queue mount,
  // whose drawer unmounts on close, supplies nothing and keeps the detached path alone), and
  // deliver() reads it at SETTLE time via a ref — the flight's continuation would otherwise close
  // over a stale render's value.
  const hostHiddenRef = useRef(hostHidden)
  useEffect(() => { hostHiddenRef.current = hostHidden }, [hostHidden])

  const answerKey = flightKey(target.projectRoot, target.featureSlug, 'answer')
  const previewKey = flightKey(target.projectRoot, target.featureSlug, 'preview')
  /** The SHARED single-flight gate over the async kinds (REQ-007) — read from the core registry,
   *  never a per-instance ref. */
  const busy = isInFlight(answerKey) || isInFlight(previewKey)

  /** Deliver a settled outcome: to local phase state while mounted; a DETACHED settle reports
   *  through the store-level toast chokepoint instead (REQ-010, CONV-034 — no outcome is ever
   *  silently swallowed): the FAILURE as an error-kind (never-suppressed) toast, the SUCCESS on
   *  the default suppressible kind (FINDING-012 — the F12 OrkyCaptureModal precedent; suppression
   *  is the STORE's mechanism, never a call-site drop), both carrying the SAME honesty-class
   *  message the core classifier computed. A settle while the owning surface is HIDDEN
   *  (FINDING-018, feature 0010 REQ-005) is treated the same way — the outcome ALSO rides the
   *  toast chokepoint, never ONLY an invisible surface (the blind-duplicate-retry invite
   *  CONV-015/CONV-034 exist to prevent) — while the still-mounted instance keeps its phase
   *  update so the pane shows the settled state when it is displayed again. */
  const deliver = (action: OrkyEntryActionKind, settled: SettledOutcome): void => {
    if (!aliveRef.current || hostHiddenRef.current) {
      const s = useStore.getState()
      if (settled.status === 'failure') s.pushToast(settled.message, 'error')
      else s.pushToast(settled.message)
      if (!aliveRef.current) return
    }
    setPhase(settled.status === 'success'
      ? { status: 'success', action, message: settled.message }
      : { status: 'failure', action, kind: settled.kind, error: settled.error, message: settled.message, indeterminate: settled.indeterminate })
  }

  /** Reset the rendered lifecycle to idle. The component calls this when the answer form OPENS
   *  (FINDING-011): the settled outcome of one control is never left to mask the fresh context of
   *  another — a stale preview result/failure clears instead of outranking the binding state. */
  const resetPhase = (): void => setPhase({ status: 'idle' })

  /** Display-time identity binding (REQ-003): called from the answer-open GESTURE, never a mount
   *  effect. A supplied target.escalationId (the F10 path) binds as-is with zero pulls; the F8
   *  queue row sources the id from the F9 detail channel — never from status.detail free text. */
  const bindAnswer = (): void => {
    setBinding('pending')
    void bindEscalationTarget(target, registryDetail).then(bound => {
      if (aliveRef.current) setBinding(bound)
    })
  }

  /** Answer the BOUND escalation (reason === 'escalation'). Submit re-verifies the bound id
   *  against a fresh detail pull first (REQ-003): a changed world refuses honestly, and the CLI
   *  is never invoked with a guessed or substituted id. The gesture routes UNCONDITIONALLY
   *  through the shared gate (FINDING-009): the core dedups — an existing flight is returned
   *  AS-IS and the started fn is never re-invoked (one dispatch, REQ-007) — and THIS caller's own
   *  continuation is what renders THIS instance's settled result, so no pre-check may bail before
   *  it attaches (the F10 same-target vector). */
  const answerEscalation = (decision: string): void => {
    if (answerModeFor(target.reason) !== 'escalation') return
    if (decision.trim().length === 0) return
    if (binding === null || binding === 'pending' || !binding.ok) return
    const boundId = binding.escalationId
    setPhase({ status: 'pending', action: 'answer' })
    void withSingleFlight(answerKey, async (): Promise<SettledOutcome> => {
      const verified = await verifyEscalationTarget(target, boundId, registryDetail)
      if (!verified.ok) {
        return { status: 'failure', kind: 'escalation-changed', error: verified.message, message: verified.message, indeterminate: false }
      }
      let result: OrkyActionSettleInput
      try {
        result = await api.orkyResolveEscalation(buildResolveEscalationRequest(target, verified.escalationId, decision))
      } catch (err) {
        // an invoke REJECTION is a transport failure: the write's fate is UNKNOWN — synthesize the
        // renderer-scoped kind, never an F7-mapped verdict (REQ-009)
        result = { ok: false, dispatched: false, errorKind: 'ipc-failure', error: String(err) }
      }
      return settleAnswer('escalation', result)
    }).then(settled => deliver('answer', settled))
  }

  /** Record the human-review verdict (reason === 'human-review') — the same unconditional
   *  shared-gate routing (FINDING-009). */
  const answerReview = (verdict: 'pass' | 'fail', evidence?: string): void => {
    if (answerModeFor(target.reason) !== 'human-review') return
    setPhase({ status: 'pending', action: 'answer' })
    void withSingleFlight(answerKey, async (): Promise<SettledOutcome> => {
      let result: OrkyActionSettleInput
      try {
        result = await api.orkyRecordHumanGate(buildRecordHumanGateRequest(target, verdict, evidence))
      } catch (err) {
        result = { ok: false, dispatched: false, errorKind: 'ipc-failure', error: String(err) }
      }
      return settleAnswer('human-review', result)
    }).then(settled => deliver('answer', settled))
  }

  /** The read-only next-action preview (REQ-005 part 1): driveStatus computes, never mutates —
   *  the same unconditional shared-gate routing (FINDING-009). */
  const preview = (): void => {
    setPhase({ status: 'pending', action: 'preview' })
    void withSingleFlight(previewKey, async (): Promise<SettledOutcome> => {
      let result: OrkyActionSettleInput
      try {
        result = await api.orkyDriveStatus(buildDriveStatusRequest(target))
      } catch (err) {
        result = { ok: false, dispatched: false, errorKind: 'ipc-failure', error: String(err) }
      }
      return settlePreview(result)
    }).then(settled => deliver('preview', settled))
  }

  /** REQ-014 (resume part 2, the actionable continuation): one gesture opens exactly ONE terminal
   *  pane at the entry's project root running the claude binary with Orky's sanctioned human
   *  resume as its initial prompt argument — via the store's NARROW launchTerminalAt action
   *  (FINDING-008: kind, shell and placement are fixed inside the store; the raw pane primitive
   *  never rides the public surface). Whether the installed Claude Code executes the initial
   *  prompt is ITS contract; either way the user gets a visible, user-owned session at the right
   *  project. Store access is gesture-time getState (CONV-021), never a subscribed value; zero
   *  Orky dispatches ride this path (REQ-005 part 2). */
  const resumeInTerminal = (): void => {
    useStore.getState().launchTerminalAt(target.projectRoot, {
      command: 'claude',
      args: ['/orky:resume'],
      title: `Orky resume — ${target.featureSlug}`
    })
  }

  return { phase, binding, busy, bindAnswer, answerEscalation, answerReview, preview, resumeInTerminal, resetPhase }
}

const fieldStyle = {
  background: 'var(--panel, #1e1e1e)',
  color: 'var(--fg, #eee)',
  border: '1px solid var(--border, #444)',
  borderRadius: 3,
  padding: '2px 6px',
  fontSize: 11,
  fontFamily: 'inherit'
} as const

/** The inline escalation-answer form — mounted exactly while the answer flow is OPEN, so the
 *  SHARED open-focus substrate (CONV-020's open half, FINDING-016 — as F12 does) lands keyboard
 *  focus in the decision input on the open gesture itself: no second aim, no Tab traversal
 *  across the sibling controls. */
function EscalationAnswerForm(props: {
  binding: AnswerBinding
  decision: string
  refuse: boolean
  onDecisionChange: (value: string) => void
  onSubmitGesture: () => void
}) {
  const { binding, decision, refuse } = props
  const inputRef = useRef<HTMLInputElement>(null)
  useOpenFocusRestore(inputRef)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span data-testid="dq-action-answer-target"
        title="The exact escalation this decision resolves — bound when the form opened, re-verified at submit"
        style={{ color: 'var(--fg-dim, #aaa)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {binding === null || binding === 'pending'
          ? 'binding the open escalation…'
          : binding.ok
            ? `${binding.escalationId}${binding.escalationReason ? ` — ${binding.escalationReason}` : ''}`
            : 'no escalation bound'}
      </span>
      <input type="text" data-testid="dq-action-answer-input"
        ref={inputRef}
        value={decision}
        placeholder="your decision…"
        aria-label="Decision for the bound escalation"
        onChange={e => props.onDecisionChange(e.target.value)}
        onKeyDown={e => {
          // FINDING-017: Enter IN the single decision input submits — input-scoped by construction
          // (CONV-030), honoring the SAME refusal gates as the submit control (whitespace-only
          // decision, in-flight, unbound target all refuse; nothing dispatches).
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (!refuse) props.onSubmitGesture()
        }}
        style={{ ...fieldStyle, flex: '1 1 120px', minWidth: 100 }} />
      <button type="button" data-testid="dq-action-answer-submit"
        disabled={refuse}
        onClick={props.onSubmitGesture}
        style={{ fontSize: 11 }}>
        submit
      </button>
    </div>
  )
}

/** The inline human-review verdict form — the same open-focus substrate lands focus in the
 *  evidence input on open (FINDING-016). The evidence input deliberately has NO Enter path:
 *  with TWO verdict buttons a default submit would be ambiguous (FINDING-017's own boundary). */
function HumanReviewForm(props: {
  busy: boolean
  evidence: string
  onEvidenceChange: (value: string) => void
  onVerdict: (verdict: 'pass' | 'fail') => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useOpenFocusRestore(inputRef)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input type="text" data-testid="dq-action-evidence"
        ref={inputRef}
        value={props.evidence}
        placeholder="evidence (optional)"
        aria-label="Evidence for the human-review verdict"
        onChange={e => props.onEvidenceChange(e.target.value)}
        style={{ ...fieldStyle, flex: '1 1 120px', minWidth: 100 }} />
      <button type="button" data-testid="dq-action-verdict-pass"
        disabled={props.busy} onClick={() => props.onVerdict('pass')} style={{ fontSize: 11 }}>
        pass
      </button>
      <button type="button" data-testid="dq-action-verdict-fail"
        disabled={props.busy} onClick={() => props.onVerdict('fail')} style={{ fontSize: 11 }}>
        fail
      </button>
    </div>
  )
}

/**
 * The presentational actions region. Pane-agnostic (D5/REQ-011): DecisionQueuePanel mounts it per
 * queue row and F10's OrkyPane mounts it per detail feature row, keyed on the same OrkyEntryTarget
 * identity — no dependency on either host. The region STOPS pointer propagation at its boundary
 * (REQ-015, the click twin of CONV-030): a click on any nested control or inline input never
 * reaches a host row's own click gesture, while the host row's activation surface OUTSIDE this
 * region keeps working. Controls are native buttons (keyboard-activatable by construction); no
 * container-level key handling redirects a focused control's own activation (CONV-030).
 */
export function OrkyEntryActions({ target, hostHidden }: { target: OrkyEntryTarget; hostHidden?: boolean }) {
  const { phase, binding, busy, bindAnswer, answerEscalation, answerReview, preview, resumeInTerminal, resetPhase } = useOrkyEntryActions(target, hostHidden)
  const regionRef = useRef<HTMLDivElement>(null)
  const [answerOpen, setAnswerOpen] = useState(false)
  // The mode the open answer form was ARMED with — set ONLY by the explicit toggle gesture
  // (CONV-046, feature 0010 REQ-006): each form below renders only while the target's LIVE mode
  // still equals it, so a data-driven reason flip can never swap in the OTHER mode's
  // focus-on-mount form without a gesture.
  const [armedMode, setArmedMode] = useState<ReturnType<typeof answerModeFor>>(null)
  const [decision, setDecision] = useState('')
  const [evidence, setEvidence] = useState('')

  const mode = answerModeFor(target.reason)
  const boundOk = binding !== null && binding !== 'pending' && binding.ok
  const showPending = busy || phase.status === 'pending'
  // One error surface: a settled failure (incl. the changed/re-open refusal), else an unbindable
  // display-time target (REQ-003's actionable message class) — never a silent non-dispatch. A
  // failure rendered while the form is open is always the form's OWN fresh context: stale settled
  // outcomes are cleared on open (FINDING-011, toggleAnswer below).
  // The unbound branch is ESCALATION-mode-gated (FINDING-010, feature 0010 REQ-006): the binding
  // is only ever pulled for the escalation flow, so a FAILED binding surviving a mode flip must
  // never resurface as a stale role=alert beside a later re-opened verdict form of the OTHER mode.
  const errorView = phase.status === 'failure'
    ? { kind: phase.kind, message: phase.message }
    : answerOpen && mode === 'escalation' && binding !== null && binding !== 'pending' && !binding.ok
      ? { kind: 'escalation-unbound', message: binding.message }
      : null

  // FINDING-020 (disarm-on-success): after the non-idempotent answer succeeds, the submitting
  // affordance DISARMS — the form closes and the typed payload clears — so a settled answer can't
  // be re-fired against a still-open escalation (on the feedback path Orky applies the queued
  // decision later, so the row legitimately stays queued meanwhile). Re-arming is an explicit
  // re-open gesture, which re-binds fresh with an empty input.
  useEffect(() => {
    if (phase.status === 'success' && phase.action === 'answer') {
      setAnswerOpen(false)
      setDecision('')
      setEvidence('')
    }
  }, [phase])

  // CONV-046 (feature 0010 REQ-006 — closes F8 FINDING-022): a DATA-driven flip of the target's
  // reason (and so its answer mode) while the form is open DISARMS — the form closes and the
  // typed decision/evidence clear — the mode-keyed twin of the FINDING-020 disarm above. Together
  // with the armed-mode render key, an open form is never silently re-purposed from decision-entry
  // to verdict-entry. Nothing dispatches and nothing launches; per FINDING-009 (feature 0010
  // ESC-001) the disarm is no longer SILENT about data loss: discarding a NON-EMPTY typed draft
  // reports through the store toast chokepoint on the never-suppressed 'error' kind (every other
  // kind is droppable unless the user opted in — a data-loss notice must never be), and when the
  // flip collapsed keyboard focus onto <body> (the escalation→null vector unmounts the answer
  // toggle WITH the form, so the captured focus-restore opener is gone from the document) focus
  // re-anchors onto this instance's own still-mounted region — collapse-guarded, never a blind
  // yank (CONV-020's close-half discipline).
  useEffect(() => {
    if (!answerOpen || mode === armedMode) return
    if (decision.trim().length > 0 || evidence.trim().length > 0) {
      useStore.getState().pushToast(
        'Orky: this feature changed while your answer form was open — the form closed and the typed draft was discarded',
        'error'
      )
    }
    setAnswerOpen(false)
    setDecision('')
    setEvidence('')
    if (document.activeElement === null || document.activeElement === document.body) {
      regionRef.current?.focus()
    }
  }, [mode, answerOpen, armedMode, decision, evidence])

  const toggleAnswer = (): void => {
    const next = !answerOpen
    setAnswerOpen(next)
    if (next) setArmedMode(mode) // the ONE arming point — an explicit gesture (CONV-046)
    // FINDING-011: the rendered outcome is scoped to the control the user is looking at — opening
    // the answer flow clears a stale settled result/failure from another action, so it can never
    // mask the fresh binding message (or sit, misleading, beside the newly-opened form).
    if (next) resetPhase()
    if (next && mode === 'escalation') bindAnswer()
  }

  return (
    // tabIndex={-1}: programmatic-focus-only — the disarm's collapse-guarded re-anchor target
    // (FINDING-009); never in the Tab order, so keyboard traversal is unchanged.
    <div className="dq-actions" ref={regionRef} tabIndex={-1}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, cursor: 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {mode !== null && (
          <button type="button" data-testid="dq-action-answer"
            title={mode === 'escalation'
              ? 'Answer the open escalation inline (changes real pipeline state)'
              : 'Record the human-review verdict inline (changes real pipeline state)'}
            onClick={toggleAnswer}
            style={{ fontSize: 11 }}>
            answer…
          </button>
        )}
        <button type="button" data-testid="dq-action-preview"
          title="Show Orky's computed next action — a read-only preview that changes nothing"
          disabled={busy}
          onClick={preview}
          style={{ fontSize: 11 }}>
          next?
        </button>
        <button type="button" data-testid="dq-action-resume"
          title={`Open a terminal at ${target.projectRoot} running a claude session primed with Orky's resume command`}
          onClick={resumeInTerminal}
          style={{ fontSize: 11 }}>
          resume in terminal
        </button>
        {showPending && (
          <span data-testid="dq-action-pending" role="status" style={{ color: 'var(--fg-dim, #aaa)' }}>working…</span>
        )}
      </div>
      {answerOpen && armedMode === mode && mode === 'escalation' && (
        <EscalationAnswerForm
          binding={binding}
          decision={decision}
          refuse={decision.trim().length === 0 || busy || !boundOk}
          onDecisionChange={setDecision}
          onSubmitGesture={() => answerEscalation(decision)} />
      )}
      {answerOpen && armedMode === mode && mode === 'human-review' && (
        <HumanReviewForm
          busy={busy}
          evidence={evidence}
          onEvidenceChange={setEvidence}
          onVerdict={verdict => answerReview(verdict, evidence)} />
      )}
      {phase.status === 'success' && (
        <div data-testid="dq-action-result" role="status"
          style={{ color: 'var(--fg-dim, #aaa)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {phase.message}
        </div>
      )}
      {errorView !== null && (
        <div data-testid="dq-action-error" data-error-kind={errorView.kind} role="alert"
          style={{ color: 'var(--status-failure, #c62828)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {errorView.message}
        </div>
      )}
    </div>
  )
}
