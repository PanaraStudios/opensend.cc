# Dashboard keyboard shortcuts

Open **Keyboard shortcuts** in the sidebar or command menu, or press **?**.
Navigation hints also appear in sidebar tooltips and command-menu items. Create,
edit and delete actions show keycaps in their tooltips.

Use **Cmd** on macOS and **Ctrl** elsewhere for the modifier below.

| Keys | Action |
| --- | --- |
| ? | Open keyboard shortcuts |
| Cmd/Ctrl+K | Open command menu |
| Cmd/Ctrl+B | Toggle sidebar |
| D | Toggle light/dark appearance |
| G then E / B / A / T | Emails / Broadcasts / Automations / Templates |
| G then C / M / D / L | Audience / Metrics / Domains / Logs |
| G then K / W / S | API keys / Webhooks / Settings |
| / | Focus the current list’s search |
| C | Activate the page header’s Create or Add action |
| J / K | Highlight the next / previous rendered table row |
| Enter | Open the highlighted row’s link or actions menu |
| X | Toggle the highlighted row’s checkbox, when available |
| Cmd/Ctrl+A | Select the current page, when the table supports selection |
| Backspace | Open the selection’s delete confirmation |
| Esc | Dismiss an overlay; otherwise clear row highlight/selection, or return from a detail page to its list |
| E | Activate a detail header’s Edit action, when present |
| Cmd/Ctrl+Enter | Confirm the active confirmation dialog |
| Cmd/Ctrl+S | Activate an explicit Save action in the editor header, when present |

Navigation sequences expire after one second. Global shortcuts pause in inputs,
textareas, selects, editable content, dialogs, menus, and popovers. A confirmation
dialog owns its Cmd/Ctrl+Enter shortcut: the typed phrase, acknowledgement,
disabled state and pending request still apply. IME composition and repeated
keydown events do not activate shortcuts. Tab and Enter still operate ordinary
controls when a table row is highlighted.

The broadcast, template and automation editors currently autosave. Their own
editing shortcuts remain in control while typing; this feature adds no save
button. Actions remain available through the existing buttons and menus.

Implementation is shared: `ShortcutProvider` and `useShortcut` own key dispatch;
`PageHeader`, `DetailHeader`, `Button`, `ListToolbar`, `ResourceTable`,
`SelectionBar`, `ConfirmDialog`, `TypeToConfirmDialog` and `EditorTopBar` provide
their contextual actions. Dashboard and full-screen editor shells each mount one
provider. No backend or AWS permissions change.
