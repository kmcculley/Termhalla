import { useEffect, useRef, useState } from 'react'
import { Modal, Z } from './Modal'
import { OrkyRootPicker } from './OrkyRootPicker'
import { useOpenFocusRestore } from './use-open-focus-restore'
import { useStore } from '../store'
import { api } from '../api'

/**
 * The global quick-capture modal (feature 0012 — D1/D2): type an idea mid-flow, land it in a
 * tracked project's Orky feedback inbox for later triage, get back to work. Hosted app-level in
 * App.tsx while the capture slice holds an open request; every close path runs through
 * closeOrkyCapture and the App host unmounts this component, so a reopen always starts fresh
 * (decision #8 — the draft lives only while the modal is open, preserved across an in-modal
 * failure and across the change-project picker step, discarded on close).
 *
 * Flow (D3/D4): opened with no pre-selected root, the SHARED OrkyRootPicker runs first (relabelled
 * for this gesture — never a fork); cancelling that INITIAL picker abandons the whole flow. Opened
 * with a pre-selected root, the form shows directly; "Change project" reopens the same picker and
 * cancelling it returns to the form with the prior root intact.
 *
 * The ONLY renderer call site of api.orkySubmitWork (REQ-005): the request is built from exactly
 * the modal's own state — { projectRoot, title } plus detail iff the textarea is non-empty, every
 * value byte-verbatim as typed, no other key — and the call is issued SYNCHRONOUSLY from the
 * submit gesture's event handler, never from an effect (REQ-006/FINDING-004: an effect-issued
 * dispatch double-fires under StrictMode's remount). The verdict is keyed ONLY on the returned
 * result's own ok/dispatched/errorKind fields (REQ-008/REQ-009, CONV-013) — never re-derived from
 * the transport shape.
 */

type CaptureFailure = { kind: string; error: string }

export function OrkyCaptureModal({ initialRoot }: { initialRoot: string | null }) {
  // The chosen target root (byte-verbatim) and whether the shared picker step is showing.
  const [root, setRoot] = useState<string | null>(initialRoot)
  const [picking, setPicking] = useState(initialRoot === null)
  // The draft + result state — component-local (decision #8). This component stays mounted across
  // the picker⇄form handoff, so the draft survives a change-project round trip.
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [inFlight, setInFlight] = useState(false)
  const [failure, setFailure] = useState<CaptureFailure | null>(null)
  // Event-time truth for the single-flight guard: two gestures can land before a re-render, and a
  // ref (unlike state-in-closure) is current the instant the first gesture flips it (REQ-006).
  const inFlightRef = useRef(false)
  // Unmount tracking so a settled result that arrives AFTER the user closed the flow is DETACHED:
  // no state update against the removed component, but the outcome is still reported through the
  // store-level toast chokepoint — a failure as a never-suppressed error-kind toast (REQ-009/
  // REQ-012, FINDING-013), never silently dropped.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const closeCapture = () => { useStore.getState().closeOrkyCapture() }

  const handlePickSelect = (picked: string) => {
    // FINDING-008: a failure verdict describes the root it was dispatched against — choosing a
    // DIFFERENT root makes the rendered error mis-describe the current target, so clear it. The
    // draft (title/detail) is preserved (REQ-009); only the now-mismatched error region is dropped.
    if (picked !== root) setFailure(null)
    setRoot(picked)
    setPicking(false)
  }
  // Editing the draft after a failure invalidates that verdict too (FINDING-008): the error region is
  // cleared on the next title/detail keystroke so it never lingers against changed content (REQ-009 —
  // the draft itself is never touched).
  const onTitleChange = (v: string) => { setTitle(v); if (failure !== null) setFailure(null) }
  const onDetailChange = (v: string) => { setDetail(v); if (failure !== null) setFailure(null) }
  const handlePickCancel = () => {
    // Cancelling the INITIAL picker abandons the capture entirely (REQ-003 — no form, no dispatch,
    // no state left behind); cancelling a re-pick returns to the form with the prior root intact.
    if (root === null) { closeCapture(); return }
    setPicking(false)
  }

  /** The ONE submit gesture handler (REQ-006): submit button, Enter in the title, or mod+Enter —
   *  each lands here synchronously, valid + idle only, at most one dispatch per gesture. */
  async function submitCapture(): Promise<void> {
    if (inFlightRef.current) return // single-flight: an in-flight gesture is a no-op
    if (root === null || title.trim().length === 0) return
    inFlightRef.current = true
    setInFlight(true)
    setFailure(null) // the error region is failure-only chrome — absent while in flight (REQ-002)
    // Exactly { projectRoot, title } plus detail iff non-empty — byte-verbatim, no trim/rewrite,
    // no extra key (REQ-005/REQ-010); an empty detail body is absence, not content.
    const req: { projectRoot: string; title: string; detail?: string } = { projectRoot: root, title }
    if (detail !== '') req.detail = detail
    let result: { ok: boolean; dispatched: boolean; errorKind?: string; error?: string }
    try {
      result = await api.orkySubmitWork(req)
    } catch (err) {
      // An invoke REJECTION is a renderer↔main TRANSPORT failure — the dispatcher itself is total and
      // never throws, so the write's fate is UNKNOWN here (the request may have reached the dispatcher
      // and completed). Synthesize the renderer-scoped 'ipc-failure' kind — never an F7-mapped verdict
      // — and route it through the INDETERMINATE copy class (REQ-014/FINDING-019).
      result = { ok: false, dispatched: false, errorKind: 'ipc-failure', error: String(err) }
    }
    inFlightRef.current = false
    const stillMounted = aliveRef.current
    if (result.ok && result.dispatched) {
      // Success iff the result's own ok && dispatched (REQ-008, CONV-013). The copy claims capture/
      // queued-for-triage only — the item now sits in the project's feedback inbox awaiting the
      // planner's triage, nothing more. Confirmation rides the suppressible pushToast chokepoint;
      // failures never do (they render in-modal, or — when detached — as a never-suppressed toast).
      const s = useStore.getState()
      if (stillMounted) s.closeOrkyCapture()
      s.pushToast(`Captured — queued in ${root}'s Orky inbox for triage.`)
      return
    }
    const fail: CaptureFailure = {
      kind: result.errorKind ?? 'cli-error',
      error: result.error ?? 'the capture request settled without an error message'
    }
    if (!stillMounted) {
      // The modal was closed mid-flight (REQ-012): the settled outcome DETACHES from the removed
      // component and can no longer render in-modal — but a FAILURE is NEVER dropped silently
      // (REQ-009/FINDING-013). Route it to the store-level toast chokepoint as an error-kind toast,
      // which is never suppressed (toasts-slice.ts:20) and needs no live component, naming the lost
      // title. (The aliveRef silent drop of rev-1 is retired.)
      //
      // The toast MUST carry the kind's own honesty class (REQ-009 / CONV-015 / FINDING-024): an
      // indeterminate outcome (a timed-out child or a transport failure whose write may still land)
      // must NOT read as a definite non-capture, or the user retries and duplicates. Mirror the
      // in-modal branch's split (see the failure region below).
      const indeterminate = fail.kind === 'cli-timeout' || fail.kind === 'ipc-failure'
      const msg = indeterminate
        ? `Capture outcome uncertain for "${title}" — ${fail.error}. It may still have been captured; retrying may create a duplicate.`
        : `Capture failed for "${title}" — ${fail.error}`
      useStore.getState().pushToast(msg, 'error')
      return
    }
    setInFlight(false)
    setFailure(fail)
  }

  if (picking) {
    return (
      <OrkyRootPicker
        ariaLabel="Capture work for a tracked Orky project"
        heading="Capture work for a tracked Orky project"
        onSelect={handlePickSelect}
        onCancel={handlePickCancel} />
    )
  }
  if (root === null) return null // unreachable: picking is true whenever no root is chosen

  return (
    <CaptureForm
      root={root}
      title={title}
      detail={detail}
      inFlight={inFlight}
      failure={failure}
      onTitleChange={onTitleChange}
      onDetailChange={onDetailChange}
      onSubmitGesture={() => { void submitCapture() }}
      onCancel={closeCapture}
      onChangeRoot={() => setPicking(true)} />
  )
}

const fieldStyle = {
  background: 'var(--panel, #1e1e1e)',
  color: 'var(--fg, #eee)',
  border: '1px solid var(--border, #444)',
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit'
} as const

function CaptureForm(props: {
  root: string
  title: string
  detail: string
  inFlight: boolean
  failure: CaptureFailure | null
  onTitleChange: (v: string) => void
  onDetailChange: (v: string) => void
  onSubmitGesture: () => void
  onCancel: () => void
  onChangeRoot: () => void
}) {
  const { root, title, detail, inFlight, failure } = props
  const titleRef = useRef<HTMLInputElement>(null)
  // CONV-020 via the SHARED hook (never a hand copy): the title input takes focus on open (also
  // the picker→form modal-to-modal handoff); on close, focus returns to the pre-open element ONLY
  // when it collapsed out of the removed dialog — coexisting with Modal's microtask refocus.
  useOpenFocusRestore(titleRef)

  const onFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); props.onCancel(); return } // discard, zero dispatch
    if (e.key !== 'Enter') return
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); props.onSubmitGesture(); return } // mod+Enter, form-wide
    // Target guard (CONV-030): plain Enter submits ONLY from the title input itself. A focused
    // textarea keeps its native newline; a focused button keeps its OWN activation (Enter on
    // Cancel cancels, Enter on Change project re-picks) — never redirected to a default submit.
    if (e.target === titleRef.current) { e.preventDefault(); props.onSubmitGesture() }
  }

  return (
    <Modal onClose={props.onCancel} z={Z.palette}
      backdropTestId="orky-capture-backdrop"
      card={{ width: 520, maxHeight: '80vh', padding: 12 }}>
      <div data-testid="orky-capture" role="dialog" aria-modal="true"
        aria-label="Capture Orky work item" onKeyDown={onFormKeyDown}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg, #eee)' }}>Capture Orky work item</div>

        <label htmlFor="oc-title" style={{ fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>Title</label>
        <input id="oc-title" data-testid="orky-capture-title" ref={titleRef} type="text"
          value={title} onChange={e => props.onTitleChange(e.target.value)}
          placeholder="One line: what needs doing?"
          style={fieldStyle} />

        <label htmlFor="oc-detail" style={{ fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>Detail (optional)</label>
        {/* maxHeight bounds the user resize inside the 80vh card (FINDING-017) — a CSS clamp, NOT a
            length cap on the value (REQ-010 forbids client caps); the field scrolls internally. */}
        <textarea id="oc-detail" data-testid="orky-capture-detail" rows={5}
          value={detail} onChange={e => props.onDetailChange(e.target.value)}
          style={{ ...fieldStyle, resize: 'vertical', minHeight: 60, maxHeight: '30vh', overflowY: 'auto' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0 }}>
          <span style={{ color: 'var(--fg-dim, #aaa)', flexShrink: 0 }}>Project:</span>
          {/* The chosen root, byte-verbatim (REQ-004) — exactly what submission sends as projectRoot. */}
          <span data-testid="orky-capture-target" title={root}
            style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg, #eee)' }}>{root}</span>
          <button type="button" data-testid="orky-capture-change-root"
            onClick={props.onChangeRoot} disabled={inFlight} style={{ flexShrink: 0 }}>
            Change project
          </button>
        </div>

        {failure !== null && (
          <div data-testid="orky-capture-error" data-error-kind={failure.kind} role="alert"
            style={{ border: '1px solid var(--status-failure, #c62828)', borderRadius: 4, padding: 8,
              overflowY: 'auto', maxHeight: '30vh',
              fontSize: 12, color: 'var(--fg, #eee)', display: 'flex', flexDirection: 'column', gap: 4,
              whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {failure.kind === 'feedback-disabled' ? (
              <>
                {/* The DISTINCT non-dispatch outcome (REQ-009): nothing was written. No enable
                    affordance exists here — turning the write path on is an audited human decision
                    made outside Termhalla (ADR-027). The CLI's own refusal renders verbatim. */}
                <div style={{ color: 'var(--status-failure, #c62828)', fontWeight: 600 }}>
                  Not captured — this project&apos;s Orky feedback write path is disabled.
                </div>
                <div>{failure.error}</div>
                <div style={{ color: 'var(--fg-dim, #aaa)' }}>
                  Enabling it is an audited human decision made outside Termhalla (ADR-027).
                </div>
              </>
            ) : failure.kind === 'cli-timeout' || failure.kind === 'ipc-failure' ? (
              <>
                {/* INDETERMINATE (CONV-015/REQ-014, FINDING-019): a timed-out child or a transport
                    failure leaves the write's fate unknown — never the definite non-capture copy. */}
                <div style={{ color: 'var(--status-failure, #c62828)', fontWeight: 600 }}>
                  The result is uncertain: the item may or may not have been captured.
                </div>
                <div>{failure.error}</div>
                <div style={{ color: 'var(--fg-dim, #aaa)' }}>
                  The command may still finish its write — retrying may create a duplicate item.
                </div>
              </>
            ) : (
              <>
                <div style={{ color: 'var(--status-failure, #c62828)', fontWeight: 600 }}>The capture request was rejected.</div>
                <div>{failure.error}</div>
              </>
            )}
          </div>
        )}

        {/* Always-visible discoverability hint (REQ-002/FINDING-012): the fast-capture keys and the
            discard key, so an accidental Enter is never a silent surprise. Static copy — never a
            per-kind message. Enter-in-title capture is KEPT deliberately (ESC-001). */}
        <div data-testid="orky-capture-hint" style={{ fontSize: 11, color: 'var(--fg-dim, #aaa)' }}>
          Enter captures · Ctrl+Enter captures from anywhere · Esc cancels
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" data-testid="orky-capture-submit"
            onClick={props.onSubmitGesture}
            disabled={title.trim().length === 0 || inFlight}>
            {inFlight ? 'Capturing…' : 'Capture'}
          </button>
          <button type="button" data-testid="orky-capture-cancel" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
