# Interface refresh

The walking view keeps the room visible with a compact toolbar and three small
controls. Open the room menu below the toolbar for bedroom navigation, **Controls**
for keyboard help, and the voice information icon for microphone details and
**Leave Voice**. Join and mute remain directly accessible. Menus close when you
click outside or press Escape. Navigation guidance appears only after choosing a
door to find.

The saved-layout badge and full-width footer no longer occupy the walking view.
Save appears while decorating or when a layout has pending changes; it still
requires a completed placement. Errors remain visible. The owner's Edit button
opens the complete editor; visitors do not get a disabled decoration button.
On small screens, pending changes take priority over navigation in the toolbar,
and an idle voice prompt is hidden while editing. An active microphone stays
accessible. No room, voice, or persistence behavior has been replaced.

The furniture editor has two views:

- **Catalog**: search or filter by Furniture, Seating, and Interactive. Choose
  a piece and click a clear floor spot to place it.
- **In room**: select an existing instance from the list, including furniture
  that is difficult to click in 3D. Its outline and existing Move, Rotate, Size,
  Delete, and configuration controls work just like scene selection.

Only the collection scrolls. Selected-piece controls and the footer stay visible.
The small × clears a selection or cancels placement. Empty searches offer a
clear-filters action. On narrow screens the editor becomes a bottom sheet;
choosing or moving a piece temporarily hides the collection to expose the floor.
Cancel restores the list. Object names/descriptions retain the catalog's existing
English/Spanish text; this is not a full localization pass.

## Files and data flow

| File | Responsibility and data |
| --- | --- |
| `src/App.jsx` | Passes the existing furniture array and selection callback into RoomUI. It remains the owner of layout, selection, persistence, and multiplayer state. |
| `src/RoomUI.jsx` | Displays navigation, status, save/edit actions, and editor sections. Receives room/game state and delegates changes through callbacks. Its local state selects an editor section; refs identify native menus for outside-click/Escape dismissal. |
| `src/ui/FurnitureEditor.jsx` | Receives furniture, selection, placement, messages, and action callbacks. Owns only search/category/list-view state. Filters existing data without changing furniture records. |
| `src/ui/FurnitureIcon.jsx` | Draws catalog illustrations using static SVG elements. Reuses the original basic furniture artwork and adds illustrations for interactive pieces. It reads an object type and changes no state. |
| `src/ui/Icon.jsx` | Small interface icons, selected by name. No downloaded assets or dependencies. |
| `src/VoiceControls.jsx` | Receives the existing voice hook and calls its Join/Mute/Leave actions. Native details owns the information menu's display state; listeners dismiss it without changing the microphone connection. |
| `src/styles.css` | Shared surface colors, spacing, scroll layout, responsive sheet, focus indicators, and reduced-motion treatment. |
| `tests/browserObjects.mjs` | Updates its save-status selector to the new user-facing “All changes saved” label. |

Clicking **In room → Chair → Delete** calls `onSelect(id)` and then `onDelete()`.
App changes the draft array. The UI receives that new array, updates the count,
and shows the unsaved badge. **Save Room** uses the same Flask/PostgreSQL path as
before. Search and category selections are never sent to the server.

## Concepts to understand

UI state describes what is being displayed; room state describes what is saved.
Keeping those responsibilities separate lets the editor change without replacing
the movement or networking code. A child requests changes with callbacks while
the parent supplies the resulting data through props.

The sidebar uses flex layout and `min-height: 0`: the collection can shrink and
scroll while the selection controls remain visible. SVG artwork and native
details avoid extra libraries. Icon-only buttons have accessible names, filter
buttons expose their selected state, and motion transitions respect reduced motion.
Menu listeners are installed in effects and removed during cleanup, preventing
duplicate event handlers when components unmount or remount. Opening a menu
changes only its HTML display state, not the shared room data.

In an interview, explain the difference between local filter state and shared
application state, why deleting a list row removes a 3D object, and why independent
scrolling keeps critical actions reachable.

Practice: add a “Lighting” filter, improve one SVG thumbnail, and change the
sidebar's width while checking that the selected-item controls remain visible.

Verification includes the frontend test suite, production build, and real browser
checks of filters, empty states, list deletion, 3D placement, saving, navigation,
and editor bounds. The compact HUD was also checked with actual pointer/keyboard
events, microphone join/mute/leave using a test audio source, WASD movement, and
menu dismissal at 1440×900, 1024×768, 390×844, and 320×667. The existing large
bundle warning remains; these changes are an interface refresh, not a bundle-size
optimization.
