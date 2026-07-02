# Quick-capture new-work inbox

A global, workspace-independent **capture modal**: type an idea mid-flow, land it in a tracked Orky
project's feedback **inbox** for later **triage**, get back to work. Fast in, fast out — no
persistent UI, no draft outliving the modal (feature 0012).

## Invocation

- **Chord:** the rebindable `capture-orky-work` command, default `mod+shift+u` (Ctrl+Shift+U).
  Registered in the ordinary `COMMANDS` table (`src/shared/keybindings.ts`), so rebinds and the
  explicit `'none'` unbind ride the one `resolveBindings` registry. `u` because every plausible
  mnemonic collides (o = queue, n = notes, w = close-workspace, i = Electron's toggleDevTools role
  accelerator, c = terminal-copy).
- **Palette:** a Ctrl+K command entry ("Capture Orky work item…", search terms
  `capture orky work idea inbox`).

Both paths work with **no active workspace**: App's keydown case reads no `activeId`, and the
palette handles the action before its active-workspace guard (the `toggle-orky-queue` precedent).

## The one entry point

Both invocation paths (and, later, the OrkyPane's "inject" gesture — F10) call the single
store-level entry point:

```ts
openOrkyCapture(root?: string)  // no root -> picker-first flow; root -> the form directly,
                                // the root held byte-verbatim (membership is F7's job)
closeOrkyCapture()              // discards the draft; every close path runs through it
```

Re-invoking `openOrkyCapture` while the modal is open is a reference-stable no-op — a chord
re-press never resets the typed draft. State lives in
`src/renderer/store/orky-capture-slice.ts`; the modal itself is
`src/renderer/components/OrkyCaptureModal.tsx`, hosted app-level in `App.tsx`.

## Flow: picker → form (sequential, never stacked)

Invoked without a pre-selected root, the flow first opens the **shared `OrkyRootPicker`** (the same
component F9 ships — relabelled via its new optional, default-preserving `ariaLabel`/`heading`
props: "Capture work for a tracked Orky project"), then the capture form with the chosen root
displayed verbatim. Cancelling the *initial* picker abandons the capture entirely. The form's
"Change project" button reopens the same picker; cancelling *that* returns to the form with the
prior root — and the typed draft — intact.

The form: a required single-line **title**, an optional multi-line **detail** (Enter inside it is a
newline, never a submit), the target project, submit/cancel. Submit gestures: the button, Enter in
the title, or `mod+Enter` anywhere in the form — each gesture-tied, single-flight, and issued
synchronously from the event handler (never an effect). Escape closes and discards. No client-side
length caps, no trimming, no rewriting: title and detail travel byte-verbatim; F7 revalidates
server-side. An always-visible hint line (`orky-capture-hint`, static copy) reads "Enter captures ·
Ctrl+Enter captures from anywhere · Esc cancels" so the fast-capture and discard keys — including
the deliberately-kept Enter-in-title capture — are discoverable before a first accidental keystroke.

## Transport: exclusively F7's dispatch (D2)

The modal is the **first renderer consumer** of the `orkyAction:*` write surface, and its ONE call
is `api.orkySubmitWork({ projectRoot, title[, detail] })` — no new IPC channel, preload method, or
main-process module. Server-side, the dispatcher's `doSubmitWork` (amended by this feature,
REQ-013) invokes the Orky plugin's local-inbox injection command:

```
feedback submit --app <root> --json {"kind":"work.request","title":…[,"detail":…]}
```

(plugin v0.28.0+; an older plugin without `submit` surfaces honestly as `cli-unparseable`). The
item lands durably in `<root>/.orky/feedback/inbox/IN-*.json` — the exact store the orchestrator's
`apply` drains into `.orky/backlog.jsonl` as a `status:'pending'` record awaiting **planner
triage**. See [orky-action-dispatch](orky-action-dispatch.md) for the full result universe.

## Result honesty (CONV-013)

Success is keyed on the result's own `ok && dispatched` — never re-derived from the transport
shape. The copy says **"Captured — queued in `<root>`'s Orky inbox for triage."** — capture ≠
accept ≠ apply ≠ triage; Orky has not started anything. Confirmation is a suppressible success
toast; failures render **in-modal** (`orky-capture-error`, `data-error-kind`), draft preserved for
an explicit retry:

- **`feedback-disabled`** — a distinct state carrying the CLI's refusal verbatim. Nothing was
  written, and the modal offers no enable affordance: enabling the write path is an audited human
  decision made outside Termhalla (ADR-027).
- **`cli-timeout`** — indeterminate (CONV-015): the item may or may not have been captured (the
  timed-out child can still complete its write); retrying may create a duplicate. Reserved for a
  genuine elapsed-time timeout/abort — a spawn-class failure (e.g. an oversized `--json` argv
  element) is classified as a DEFINITE `cli-error`/`cli-unparseable` instead (REQ-014).
- **`ipc-failure`** — a renderer-synthesized kind (never an F7-mapped literal), used only when the
  `orkySubmitWork` `ipcRenderer.invoke` call itself REJECTS (a transport failure, not a dispatcher
  verdict — the dispatcher is total and never throws). The write's fate is unknown, so this also
  renders through the indeterminate copy class alongside `cli-timeout` (REQ-014/FINDING-019).
- everything else (`root-not-allowed`, `cli-error` — including the http-mode refusal directing to
  the control plane's own inbox API — `cli-unparseable`, …) — F7's error text verbatim, generic
  failure treatment, retry allowed.

Closing the modal mid-flight (Escape, Cancel, backdrop click) never drops a settled failure
silently: the outcome DETACHES from the removed component and routes through the store-level toast
chokepoint as a never-suppressed error-kind toast naming the lost title (REQ-009/REQ-012,
FINDING-013) — and that detached toast carries the SAME honesty class as the in-modal region: the
indeterminate kinds (`cli-timeout`/`ipc-failure`) get "outcome uncertain … may still have been
captured; retrying may create a duplicate" wording, never the definite "Capture failed" copy
(FINDING-024).
