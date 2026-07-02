import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { OrkyConfig, OrkyFeatureDetail, OrkyGateDetail } from '@shared/types'
import { compareOrkyFeatures } from '@shared/orky-status'
import { caseFoldFromPlatform } from '@shared/decision-queue'
import { sameProjectRoot, formatOrkyInstant } from '@shared/orky-pane'
import { useStore } from '../store'
import { OrkyRootPicker } from './OrkyRootPicker'

/**
 * The native Orky pane body (feature 0009, TASK-016) — a first-class mosaic pane kind bound to ONE
 * tracked project, rendering its FULL pipeline status (every feature, per-gate records, findings,
 * escalations) off the `registry:detail` payload. Strictly READ-only (REQ-013): no action
 * affordance, no mutation call, nothing persisted beyond `config.root` (via updatePaneConfig's own
 * autosave path on re-bind).
 *
 * Single source + single clock (REQ-009): once a detail payload is held, header accents AND rows
 * derive from THAT payload's carried statuses (computed under its one `computedAt` instant) — the
 * aggregate entry supplies ONLY membership and `source` provenance. Fields render VERBATIM
 * (REQ-015): this component re-derives no gate math, no stall/needs-human verdicts, no blocking
 * predicate, and reads no clock of its own.
 *
 * Refresh triggers (REQ-010) are exactly: T1 bind events (a GENUINE fresh mount with a bound
 * member root, re-bind, membership re-entry), T2 own-root `registry:rootChanged` notifications
 * while displayed (routed app-level through notifyOrkyRootChanged — this component wires no
 * subscription of its own), and T3 the hidden→displayed transition with suppressed staleness.
 * "Hidden" is the pane's EFFECTIVE visibility across BOTH keep-mounted hidden hosts (FINDING-013):
 * the MinimizedPaneHost mounts this component with `hidden`, and PaneTile passes
 * `hidden={workspace not active}` for panes in background workspaces — the slice's
 * setOrkyPaneHidden owns the stale-restore fetch for both.
 */
export function OrkyPane(
  { wsId, paneId, config, hidden = false }:
  { wsId: string; paneId: string; config: OrkyConfig; hidden?: boolean }
) {
  // Fold mode for binding equality — derived from the ONE platform signal that exists in the
  // contextIsolated main world (REQ-005 / the F6 FINDING-003 trap).
  const caseFold = caseFoldFromPlatform(navigator.platform)
  // Total over the config (REQ-020 belt-and-braces / FINDING-032): every instantiation path is
  // coercion-covered upstream, but a non-string binding reaching this component still renders the
  // unbound state — never a throw.
  const root = typeof config.root === 'string' ? config.root : ''

  // Narrow own-entry subscription (REQ-016): scalar picks behind useShallow, so churn on OTHER
  // roots' entries (which rebuilds the snapshot array) re-renders nothing here. `snapshotHeld`
  // distinguishes "membership unknown (no snapshot settled yet)" from a genuine non-member — the
  // unbound copy only renders against a HELD snapshot, never as a startup flash.
  const { snapshotHeld, isMember, source } = useStore(useShallow(s => {
    const entry = root === '' || s.registrySnapshot === null
      ? undefined
      : s.registrySnapshot.find(e =>
          e != null && typeof e.root === 'string' && sameProjectRoot(e.root, root, { caseFold }))
    return { snapshotHeld: s.registrySnapshot !== null, isMember: entry !== undefined, source: entry?.source ?? null }
  }))
  const detailEntry = useStore(s => s.orkyPaneDetail[paneId])
  const fetchOrkyDetail = useStore(s => s.fetchOrkyDetail)
  const setOrkyPaneHidden = useStore(s => s.setOrkyPaneHidden)
  const rebindOrkyPane = useStore(s => s.rebindOrkyPane)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  // Effective-visibility boundary + T1 bind events in ONE effect, so a restore-remount can never
  // double- or spuriously fetch (REQ-010 / FINDING-020). BOTH keep-mounted hidden hosts drive the
  // same boundary hook (FINDING-013): the minimized host mounts this component with `hidden`, and
  // PaneTile passes `hidden={workspace not active}` for the inactive-workspace host. The SURVIVING
  // orkyPaneDetail entry is consulted via getState() at event time (CONV-021) BEFORE the hidden
  // flip: an entry held with `hidden: true` identifies a hidden→displayed transition (restore
  // remount OR workspace activation), whose fetch decision T3 (`setOrkyPaneHidden`) ALONE owns —
  // fetch exactly once iff stale, zero otherwise. Genuine T1 binds still fetch here: a fresh mount
  // (no surviving entry — new pane, undock/redock re-creation in another window's store, a moved
  // pane whose entry was pruned) and membership RE-ENTRY after an unbound spell; a re-bind's own
  // in-flight fetch (rebindOrkyPane already issued exactly one) is never duplicated or coalesced
  // into a redundant follow-up.
  useEffect(() => {
    const prior = useStore.getState().orkyPaneDetail[paneId]
    const wasHidden = prior !== undefined && prior.hidden
    setOrkyPaneHidden(paneId, hidden)
    if (hidden || !isMember || root === '') return
    if (wasHidden) return // T3 owns the hidden→displayed fetch decision (stale → one, else zero)
    if (prior !== undefined && prior.inFlight && sameProjectRoot(prior.root, root, { caseFold })) return
    fetchOrkyDetail(paneId, root)
  }, [paneId, hidden, isMember, root, caseFold, fetchOrkyDetail, setOrkyPaneHidden])

  const detail = detailEntry?.detail ?? null
  // Binding-identity guard (REQ-009/REQ-010 / FINDING-029): the held payload renders ONLY while
  // its CARRIED root still sameProjectRoot-matches the pane's binding — the payload carries its
  // root precisely for this. A just-re-bound pane therefore shows the new root's loading/error,
  // never the previous root's rows stamped with the new identity (the slice also clears on
  // re-bind; this is the render-side belt and braces).
  const heldDetail = detail !== null && root !== '' && sameProjectRoot(detail.root, root, { caseFold })
    ? detail : null
  const okDetail = heldDetail !== null && heldDetail.ok ? heldDetail : null

  // Display order = the SHARED comparator over the payload's carried statuses (REQ-014/REQ-015) —
  // memoized on the payload reference so derivation runs at most once per settled fetch (REQ-016).
  const orderedFeatures = useMemo<OrkyFeatureDetail[]>(() => {
    if (!okDetail) return []
    return [...okDetail.features].sort((a, b) => compareOrkyFeatures(a.status, b.status))
  }, [okDetail])

  const unbound = root === '' || (snapshotHeld && !isMember)
  const unreadable = !unbound && heldDetail !== null && !heldDetail.ok && heldDetail.errorKind === 'orky-missing'
  // Any OTHER failure (a rejected bridge call, or a structured non-missing rejection) surfaces as
  // the explicit error state — while a held stale-but-valid detail keeps rendering underneath.
  const inlineError = unbound || unreadable
    ? null
    : detailEntry?.error ?? (heldDetail !== null && !heldDetail.ok ? heldDetail.error : null)
  const loading = !unbound && !unreadable && okDetail === null && inlineError === null
  const projectName = basenameOf(root)

  const anyNeedsHuman = orderedFeatures.some(f => f.status.needsHuman)
  const anyFailed = orderedFeatures.some(f => f.status.failed)
  // Header stall wording (REQ-009 / FINDING-024): when the comparator-top feature's carried reason
  // is 'stalled', the header surfaces that payload's carried wording VERBATIM (its `detail`, e.g.
  // "slug: stalled Xm — no heartbeat"), so a stalled project's header is distinguishable from an
  // awaiting-review one. Carried fields only — never re-derived with a renderer clock (REQ-015).
  const topStatus = orderedFeatures.length > 0 ? orderedFeatures[0].status : null
  const stalledTop = topStatus !== null && topStatus.reason === 'stalled' ? topStatus : null

  const toggleRow = (slug: string) =>
    setExpandedRows(e => ({ ...e, [slug]: !(e[slug] === true) }))

  // Per-gate title (REQ-009 / FINDING-024): the display set is EXHAUSTIVE per recorded gate —
  // pass/fail/unrecorded state, the CARRIED `at` (formatted from the payload epoch via the shared
  // pure formatter, never a renderer clock), the external marker (in the gate text), and any
  // evidence. An unrecorded gate invents nothing (no `at`, no fabricated text).
  const gateTitle = (g: OrkyGateDetail): string => {
    const state = g.passed === null ? 'not recorded' : g.passed ? 'passed' : 'failed'
    const at = g.at !== null ? ` at ${formatOrkyInstant(g.at)}` : ''
    const evidence = g.evidence !== null ? ` — ${g.evidence}` : ''
    return `${g.phase}: ${state}${at}${evidence}`
  }

  const featureRow = (f: OrkyFeatureDetail) => {
    const s = f.status
    // Row identity, render key and disclosure state ALL key on the payload's UNIQUE dir slug —
    // never the collidable status.feature (REQ-012 / FINDING-021): a copied feature dir must not
    // collapse rows, share disclosure state, or duplicate React keys.
    const isOpen = expandedRows[f.slug] === true
    return (
      <div key={f.slug} data-testid="orky-pane-feature"
        data-project-root={root} data-feature={f.slug}
        style={{ borderBottom: '1px solid var(--border, #333)', padding: '4px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <button type="button" aria-expanded={isOpen}
            aria-label={`Toggle details for ${f.slug}`}
            onClick={() => toggleRow(f.slug)}
            style={{ flex: 'none' }}>
            {isOpen ? '▾' : '▸'}
          </button>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.feature}</span>
          {/* A null LIVE phase is a complete feature — the established `?? 'done'` convention;
              the literal string "null" never renders (CONV-009). */}
          <span style={{ color: 'var(--fg-dim, #aaa)', whiteSpace: 'nowrap' }}>
            {s.phase ?? 'done'} · {s.gateN}/{s.gateM}
          </span>
          {s.needsHuman && s.reason !== null && (
            <span style={{ color: 'var(--status-needs, #ff8f00)', whiteSpace: 'nowrap' }}>{s.reason}</span>
          )}
          {s.openBlocking > 0 && (
            <span style={{ color: 'var(--status-needs, #ff8f00)', whiteSpace: 'nowrap' }}>●{s.openBlocking} open</span>
          )}
          <span style={{ flex: 1 }} />
          {/* Reserved trailing actions slot (REQ-012): deliberately EMPTY in this feature — F10
              injects answer/resume/record-gate affordances here without reflowing row identity. */}
          <span data-testid="orky-pane-row-actions" style={{ flex: 'none' }} />
        </div>
        <div title={s.detail} style={{ fontSize: 11, color: 'var(--fg-dim, #aaa)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.detail}
        </div>
        {isOpen && (
          <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
            <div data-testid="orky-pane-gates" aria-label={`Gates for ${f.slug}`}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
              {f.gates.map(g => (
                <span key={g.phase}
                  title={gateTitle(g)}
                  style={{ color: g.passed === false ? 'var(--status-failure, #c62828)' : 'var(--fg-dim, #aaa)' }}>
                  {g.phase} {g.passed === true ? '✓' : g.passed === false ? '✗' : '·'}{g.external ? ' (human)' : ''}
                </span>
              ))}
            </div>
            {f.findingsUnreadable && (
              <div style={{ fontSize: 11, color: 'var(--status-needs, #ff8f00)' }}>
                findings.json could not be read for this feature — its findings are unavailable until the next refresh.
              </div>
            )}
            {f.findings.map((fd, i) => (
              <div key={fd.id ?? `finding-${i}`} data-testid="orky-pane-finding"
                data-finding-id={fd.id ?? ''} title={fd.claim}
                style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ fontWeight: 600 }}>{fd.id ?? '(no id)'}</span>{' '}
                <span>{fd.severity ?? ''}</span>{' '}
                <span style={{ color: 'var(--fg-dim, #aaa)' }}>{fd.status ?? ''}</span>
                {fd.blocking && <span style={{ color: 'var(--status-needs, #ff8f00)' }}> blocking</span>}{' '}
                <span style={{ color: 'var(--fg-dim, #aaa)' }}>{fd.claim}</span>
              </div>
            ))}
            {f.escalations.map((esc, i) => (
              <div key={esc.id ?? `escalation-${i}`} data-testid="orky-pane-escalation"
                data-escalation-id={esc.id ?? ''} title={esc.reason}
                style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ fontWeight: 600 }}>{esc.id ?? '(no id)'}</span>{' '}
                <span style={{ color: 'var(--fg-dim, #aaa)' }}>{esc.status ?? ''}</span>{' '}
                <span>{esc.reason}</span>
                {esc.status === 'resolved' && esc.decision !== null && (
                  <span style={{ color: 'var(--fg-dim, #aaa)' }}> — decision: {esc.decision}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div data-testid="orky-pane" data-root={root} role="region"
      aria-label={`Orky project ${root === '' ? '(unbound)' : projectName}`}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
        background: 'var(--panel, #1e1e1e)', color: 'var(--fg, #eee)',
        fontSize: 'var(--font-size, 13px)' }}>
      {unbound ? (
        <div data-testid="orky-pane-unbound" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            This Orky pane is bound to <code title={root}>{root === '' ? '(no project)' : root}</code>,
            which is not currently tracked. Open a terminal in that project to track it again,
            or bind this pane to another tracked project.
          </div>
          <button type="button" data-testid="orky-pane-rebind" onClick={() => setPickerOpen(true)}
            style={{ alignSelf: 'flex-start' }}>
            Bind to a tracked project…
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 8px',
            borderBottom: '1px solid var(--border, #333)', minWidth: 0 }}>
            <span title={root} style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {projectName}
            </span>
            {source !== null && <span style={{ fontSize: 11, color: 'var(--fg-dim, #aaa)' }}>{source}</span>}
            {anyNeedsHuman && <span style={{ fontSize: 11, color: 'var(--status-needs, #ff8f00)' }}>needs you</span>}
            {anyFailed && <span style={{ fontSize: 11, color: 'var(--status-failure, #c62828)' }}>failed</span>}
            {stalledTop !== null && (
              <span title={stalledTop.detail}
                style={{ fontSize: 11, color: 'var(--status-needs, #ff8f00)', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                {stalledTop.detail}
              </span>
            )}
            {okDetail?.activeFeature != null && (
              <span style={{ fontSize: 11, color: 'var(--fg-dim, #aaa)', whiteSpace: 'nowrap' }}>
                active: {okDetail.activeFeature}
              </span>
            )}
          </div>
          {loading && (
            <div data-testid="orky-pane-loading" style={{ padding: 12, color: 'var(--fg-dim, #aaa)' }}>
              Loading Orky status for {projectName}…
            </div>
          )}
          {unreadable && heldDetail !== null && !heldDetail.ok && (
            <div data-testid="orky-pane-unreadable" style={{ padding: 12, color: 'var(--fg-dim, #aaa)' }}>
              The project at <code title={root}>{root}</code> is still tracked, but its <code>.orky/</code> data
              is missing or unreadable. {heldDetail.error}
            </div>
          )}
          {inlineError !== null && (
            <div data-testid="orky-pane-error" style={{ padding: '6px 8px', fontSize: 12,
              color: 'var(--status-needs, #ff8f00)' }}>
              {inlineError}
            </div>
          )}
          {okDetail !== null && (
            <div tabIndex={0} aria-label={`Orky features of ${projectName}`}
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 2 }}>
              {okDetail.featuresCapped && (
                <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--status-needs, #ff8f00)' }}>
                  Feature list capped at the read bound — showing the first {okDetail.features.length} by name.
                </div>
              )}
              {orderedFeatures.map(featureRow)}
              {okDetail.skippedFeatures.map(slug => (
                <div key={`skipped-${slug}`} data-testid="orky-pane-feature-unreadable" data-feature={slug}
                  style={{ padding: '4px 8px', fontSize: 12, color: 'var(--status-needs, #ff8f00)' }}>
                  {slug}: its state.json could not be read right now (a torn or oversized write) — listed so it never silently vanishes.
                </div>
              ))}
              {okDetail.features.length === 0 && okDetail.skippedFeatures.length === 0 && (
                <div style={{ padding: 12, color: 'var(--fg-dim, #aaa)' }}>
                  No features yet under this project&apos;s .orky/features/.
                </div>
              )}
            </div>
          )}
        </>
      )}
      {pickerOpen && (
        <OrkyRootPicker
          onSelect={picked => { setPickerOpen(false); rebindOrkyPane(wsId, paneId, picked) }}
          onCancel={() => setPickerOpen(false)} />
      )}
    </div>
  )
}

/** Basename of a root path, tolerant of both separators, trailing separators, and (REQ-020
 *  belt-and-braces) a non-string input — total, never a throw. */
function basenameOf(root: unknown): string {
  if (typeof root !== 'string') return ''
  const parts = root.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root
}
