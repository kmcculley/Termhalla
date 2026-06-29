# 0001 — Edit menu + settings & toast-notification toggle

## Phase 0 — Intake

**Status:** intake captured — awaiting brainstorm (phase 1, human-led).

### Raw idea (verbatim)

> Move the settings button to become a menu option under a new "Edit" menu. Within the
> settings window i want a new option to enable/disable toast notifications.

### Restated requirements (to be confirmed in brainstorm)

1. Introduce a new top-level **"Edit"** menu in the application chrome.
2. **Move** the existing Settings entry point: the standalone settings *button* is removed,
   and Settings becomes a **menu option under the new Edit menu**.
3. Inside the **Settings window**, add a **new control to enable/disable toast notifications**.
4. The toast-notifications preference is honored by whatever currently raises toasts (toasts
   are suppressed when disabled) and is **persisted** like other settings.

### Open questions for brainstorm

- What exactly is the "settings button" today, and where does it live (titlebar / toolbar /
  command palette)? Is the Edit menu a new native app menu, or a renderer-level menu bar?
- Should the Edit menu hold *only* Settings for now, or are other Edit-type actions
  (cut/copy/paste, find, etc.) expected to live there too?
- Default state of toast notifications (enabled vs disabled) for existing and new users?
- Scope of "toast notifications" — which notifications count as toasts (all transient
  pop-ups, or a specific subset)?
- Where in the Settings window does the toggle live (which section/grouping)?
- Migration: how does the persisted-settings schema version change to add the new flag?

### Likely concern tags (proposed — NOT yet committed; finalized in the spec)

- **ux** — primary. Menu reorganization and a moved entry point change the discoverability
  and interaction model of a core surface.
- **qol** — the toast on/off toggle is a quality-of-life preference.
- **doc-drift** — feature docs, keybindings, and any "where things live" tables will need
  updating once Settings moves and a menu is added.

(Always-on lenses `security`, `quality`, `devils-advocate` apply regardless.)
