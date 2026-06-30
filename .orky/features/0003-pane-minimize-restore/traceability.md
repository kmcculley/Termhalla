# 0003 — Minimize / restore panes — Traceability (Phase 7, doc-sync reconciled)

REQ → TASK → TEST matrix, regenerated from `traceability.json` and reconciled against the shipped
code and test suite at doc-sync. Every REQ maps to ≥1 TASK **and** ≥1 existing TEST; every referenced
`TEST-NNN` appears as a real marker in a test file (verified by grep over `tests/`). The
`doc-sync`/`traceability` gate re-derives this from `traceability.json`.

| REQ | Summary | TASK(s) | TEST(s) | Constraints |
|---|---|---|---|---|
| REQ-001 | Minimize action: toolbar + context menu + keybinding | TASK-003, TASK-005, TASK-006, TASK-013 | TEST-021, TEST-024 | — |
| REQ-002 | Minimize reflows siblings to fill 100% | TASK-002, TASK-004, TASK-016 | TEST-009, TEST-010, TEST-025, TEST-043 | C2 |
| REQ-003 | Minimized pane stays alive (PTY/scrollback/Monaco) | TASK-004, TASK-011, TASK-018 | TEST-026, TEST-036, TEST-037 | C1, C2, C3 |
| REQ-004 | Per-workspace minimized tray, restore-on-click | TASK-007, TASK-016 | TEST-027, TEST-043 | C4 |
| REQ-005 | Tray chips surface live background status | TASK-007, TASK-019 | TEST-019, TEST-020, TEST-033, TEST-037, TEST-040 | — |
| REQ-006 | Restore returns pane intact to deterministic slot (OQ5) | TASK-002, TASK-003 | TEST-011, TEST-012, TEST-028 | C2 |
| REQ-007 | Minimize state persisted across reload | TASK-001, TASK-003 | TEST-006, TEST-031 | C5 |
| REQ-008 | Maximize converted transient → persisted (D5) | TASK-001, TASK-003 | TEST-007, TEST-032 | C5 |
| REQ-009 | Explicit tested schema migration, prune, no cap | TASK-001, TASK-014 | TEST-001, TEST-002, TEST-003, TEST-004, TEST-005, TEST-039 | C5 |
| REQ-010 | Minimize/maximize precedence & mutual exclusion (DF1) | TASK-002, TASK-003, TASK-013, TASK-014 | TEST-013, TEST-014, TEST-039, TEST-041 | — |
| REQ-011 | Minimize last pane; all-minimized empty state (DF2) | TASK-004, TASK-007 | TEST-010, TEST-029 | C1 |
| REQ-012 | Uniform across Terminal / Editor / Explorer (DF3) | TASK-004, TASK-005, TASK-012 | TEST-030, TEST-038 | C3 |
| REQ-013 | Keybinding ↔ accelerator/tooltip in sync (CONV-005) | TASK-005, TASK-006, TASK-017 | TEST-021, TEST-022, TEST-044 | — |
| REQ-014 | Accessibility: keyboard-operable, focusable chips (CONV-007) | TASK-008, TASK-015 | TEST-034, TEST-042 | C4 |
| REQ-015 | Cross-workspace move / undock no view-state corruption (OQ6) | TASK-003, TASK-009 | TEST-018, TEST-035 | C2, C5 |
| REQ-016 | No pane content persisted (security) | TASK-001 | TEST-008 | C5 |
| REQ-017 | Idempotent / total minimize & restore (CONV-002) | TASK-002, TASK-003, TASK-020 | TEST-015, TEST-016, TEST-017 | C2 |
| REQ-018 | Test-id contract + e2e proof | TASK-005, TASK-007 | TEST-024, TEST-025, TEST-026 | — |
| REQ-019 | Documentation updated + baseline reconciled (doc-drift) | TASK-010 | TEST-023 | — |

## Coverage check
- REQs total: 19 (REQ-001..019). REQs with ≥1 TASK: 19. REQs with ≥1 existing TEST: 19. **Uncovered: none.**
- TASKs total: 20 (TASK-001..020). Every TASK maps to ≥1 REQ.
- TESTs referenced: TEST-001..044 (minus the gaps that are e2e-only addenda). Every referenced
  `TEST-NNN` exists as a marker in a real test file under `tests/` (feature-0003 specs:
  `tests/shared/minimize-persistence.test.ts`, `tests/shared/minimize-view-state.test.ts`,
  `tests/shared/chip-status.test.ts`, `tests/shared/minimize-keybinding.test.ts`,
  `tests/minimize-pane-menu-style.test.ts`, `tests/docs-feature-0003.test.ts`, and
  `tests/e2e/minimize-{restore,uniform,persistence,tray-status,undock,hardening}.spec.ts`).

## REQ → touched files (from `traceability.json`)
| REQ | Files |
|---|---|
| REQ-001 | `store/types.ts`, `store.ts`, `PaneToolbar.tsx`, `PaneContextMenu.tsx`, `keybindings.ts`, `App.tsx` |
| REQ-002 | `workspace-model.ts`, `WorkspaceView.tsx`, `MinimizedPaneHost.tsx`, `index.css` |
| REQ-003 | `WorkspaceView.tsx`, `MinimizedPaneHost.tsx`, `terminal-registry.ts`, `pane-transit.ts`, `window-manager.ts`, `ipc-contract.ts`, `register-pty.ts`, `api.ts`, `store.ts`, `TerminalPane.tsx`, `preload/index.ts` |
| REQ-004 | `MinimizedTray.tsx`, `WorkspaceView.tsx`, `index.css` |
| REQ-005 | `MinimizedTray.tsx`, `chip-status.ts` |
| REQ-006 | `workspace-model.ts`, `store.ts` |
| REQ-007 | `types.ts`, `workspace-model.ts`, `store.ts`, `store/internals.ts` |
| REQ-008 | `types.ts`, `workspace-model.ts`, `store.ts`, `store/internals.ts` |
| REQ-009 | `types.ts`, `workspace-model.ts` |
| REQ-010 | `workspace-model.ts`, `store.ts` |
| REQ-011 | `WorkspaceView.tsx`, `MinimizedTray.tsx` |
| REQ-012 | `MinimizedPaneHost.tsx`, `PaneToolbar.tsx`, `PaneContextMenu.tsx`, `ExplorerPane.tsx`, `explorer-registry.ts` |
| REQ-013 | `PaneToolbar.tsx`, `PaneContextMenu.tsx`, `keybindings.ts`, `menu.ts` |
| REQ-014 | `MinimizedTray.tsx`, `index.css` |
| REQ-015 | `store.ts`, `window-manager.ts` |
| REQ-016 | `types.ts`, `workspace-model.ts` |
| REQ-017 | `workspace-model.ts`, `store.ts`, `store/internals.ts` |
| REQ-018 | `PaneToolbar.tsx`, `PaneContextMenu.tsx`, `MinimizedTray.tsx`, `WorkspaceView.tsx` |
| REQ-019 | `docs/features/workspaces.md`, `CLAUDE.md`, `CHANGELOG.md`, `docs/features/keybindings.md`, `docs/decisions.md`, `.orky/baseline/architecture.md` |

## Finding → TASK closure map
| Finding | Sev / contract | TASK | REQ | Disposition |
|---|---|---|---|---|
| FINDING-CODEX-001 | HIGH / cv | TASK-011 | REQ-003 | resolved (TEST-036) |
| FINDING-DA-001 | HIGH / cv | TASK-012 | REQ-012 | resolved (TEST-038) |
| FINDING-SEC-001 | MEDIUM / cv | TASK-013 | REQ-010 | resolved (TEST-041) |
| FINDING-QOL-002 | MEDIUM | TASK-013 | REQ-001 | resolved |
| FINDING-CODEX-002 | MEDIUM / cv | TASK-014 | REQ-010, REQ-009 | resolved (TEST-039) |
| FINDING-UX-001 | HIGH / cv | TASK-015 | REQ-014 | resolved (TEST-042) |
| FINDING-QOL-001 | HIGH | TASK-016 | REQ-002, REQ-004 | resolved (TEST-043) |
| FINDING-QUAL-002 | MEDIUM / cv | TASK-017 | REQ-013 | resolved (TEST-044) |
| FINDING-DA-002 | MEDIUM | TASK-018 | REQ-003 | resolved (TEST-037) |
| FINDING-DA-003 | MEDIUM | TASK-019 | REQ-005 | resolved (TEST-040) |
| FINDING-DA-004 | MEDIUM | TASK-009 (extended) | REQ-015 | resolved (TEST-035) |
| FINDING-SEC-003 | MEDIUM / cv | TASK-011 (transit hardening) | REQ-003 | resolved |
| FINDING-QUAL-001/003/004/005/006/007, SEC-002, QUAL-008 | LOW/MED | TASK-020 | REQ-017 (consistency) | resolved |
| FINDING-DOC-001/002 | MED/LOW | TASK-010 (extended) | REQ-019 | resolved (doc-sync) |
| FINDING-DA-005 | MEDIUM | — (deferred) | REQ-003 | **deferred** — see `docs/superpowers/0003-pane-minimize-restore-review-followups.md` |

## Constraint → task index
- **C1 (keep-mounted, no display:none/unmount):** TASK-004, TASK-007, TASK-011, TASK-018
- **C2 (prune visible tree / keep subtree / no ptyKill):** TASK-002, TASK-003, TASK-004, TASK-009, TASK-011
- **C3 (editor drafts flushed-not-deleted):** TASK-003, TASK-004, TASK-012
- **C4 (mosaic-tile overlays portal to body):** TASK-007, TASK-008, TASK-015
- **C5 (main owns windows[]; no renderer app-state write; no PTY double-mount):** TASK-001, TASK-003, TASK-009, TASK-011

## Test-id contract (shipped)
- `min-${paneId}` — toolbar minimize button (TASK-005)
- `pane-menu-minimize` — context-menu item (TASK-005)
- `min-tray-${wsId}` — tray container (TASK-007)
- `min-chip-${paneId}` — tray chip (TASK-007)
- `data-needs-input="1"` — needs-input marker on a chip (TASK-007)
- `data-status="exited"` — exited marker on a chip (TASK-019)
- `ws-empty-${wsId}` — all-minimized empty state (TASK-007)
- `pane-menu` — portalled context-menu container (focus/hover allow-list, TASK-015)
