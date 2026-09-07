# Technical Design Document: Text Block History

## 1. Architecture & Tech Stack

* **UI Framework:** Beer CSS (Material 3 Expressive semantics), both its CSS and its `beer.min.js` behavior layer. Used as declaratively as possible — dialogs, the unsaved-changes badge, the empty-state layout, and light/dark mode switching are all driven through Beer's own `data-ui` attributes and `window.ui(...)` calls rather than hand-rolled JS/CSS. Custom CSS in `style.css` is limited to the handful of things Beer has no equivalent for.
* **Language/Logic:** Vanilla TypeScript (no framework).
* **Build Tool:** Vite.
* **Core Libraries:**
  * `fast-diff`: computes the character-level difference between a block's old and new text.
  * `quill-delta`: composes and applies Delta operations.
  * `fast-json-patch`: applies RFC 6902 JSON Patch operations to the state tree.

## 2. State Management

The document is derived state, not stored state, split across two layers:

* **`Kernel`** owns the one thing that's actually persisted: the committed event log, plus the `DocumentState` derived from it. Its entire mutation surface is a single method, `replaceEventLog(events)`, which overwrites the log wholesale, re-derives state from scratch, persists to `localStorage`, and notifies subscribers. A plain append is just this call with the old log plus new events; "Clear Everything" is this call with an empty array; saving after an undo that reached into saved history is this call with a log that's shorter than before. Collapsing every mutation into one method means there's no separate code path that could special-case growing the log versus shrinking it.
* **`App`** owns everything not yet known to be persisted: an `activeEvents` array (the full timeline the currently displayed document is derived from — seeded from `kernel.getEventLog()` at startup) and a `redoStack`. The document rendered on screen is always `deriveState(INITIAL_STATE, activeEvents)`, independent of what the Kernel currently holds.

"Unsaved changes" is defined as `activeEvents` no longer matching `kernel.getEventLog()` — checked by length plus per-index **reference equality**, not a deep comparison. This is deliberate: an event object only ends up at the same array slot in both places if it round-tripped through save/undo/redo untouched, which also makes "undo something, then redo it right back" correctly report no unsaved changes without needing to compare event contents at all.

## 3. Module Responsibilities

* **`types.ts`**: `DocumentState`, `DocumentEvent` (discriminated union on `type`), and the Quill-Delta-shaped `DeltaOp`.
* **`reducer.ts`**: `INITIAL_STATE` and the pure fold `deriveState(initial, events)`. `applyEventToState` routes a single event to either `fast-json-patch`'s `applyPatch` (struct events) or a Delta compose against the target block's current content (text events); this stays module-private since nothing outside `reducer.ts` needs to apply one event in isolation.
* **`commands.ts`**: Builds the `fast-json-patch` operations for add/delete/move, including `blockPath(blockId)`, which RFC-6901-escapes a block ID (`~`→`~0`, `/`→`~1`) before embedding it in a patch path — necessary because IDs are free text the user chooses, not generated identifiers guaranteed to be path-safe.
* **`diff.ts`**: Wraps `fast-diff` to turn an `(oldText, newText)` pair into a normalized Quill Delta op array (`retain` / `insert` / `delete`).
* **`storage.ts`**: `localStorage` load/save for the event log, under `text-block-history:event-log`.
* **`kernel.ts`**: The `Kernel` class described above.
* **`app.ts`**: DOM rendering, event delegation, and the `activeEvents`/`redoStack` undo-redo machinery described above and in section 4.
* **`theme.ts`**: The light/dark/device-default toggle. Preference is tracked via a `localStorage` key that's either `'light'`, `'dark'`, or absent (device default); applying it delegates to Beer's `ui('mode', 'light' | 'dark' | 'auto')`, so this module never computes `matchMedia` state itself except to know when to re-invoke `ui('mode', 'auto')` while device-default is active and the OS setting changes.
* **`style.css`**: Only what Beer CSS doesn't already provide (e.g. block spacing, a couple of `[hidden]` overrides — see section 4).
* **`beercss.d.ts`**: Ambient type declaration for Beer's global `window.ui()`.

## 4. Edge Cases & Implementation Notes

* **Sequential integrity:** A `Record` for block content plus a separate `order` array means JSON Patch `move` operations (by index) never corrupt or lose text content.
* **Focus preservation:** `app.ts`'s render reconciles the DOM by `blockId` and never resyncs an existing block's live `textarea.value` from derived state — only newly created blocks get an initial value. Renders now happen after every staged action (not just after a save), so unconditionally resyncing would wipe out unsaved text in unrelated blocks the moment focus moved elsewhere. Undo/redo are the one exception: `syncAfterUndoRedo` explicitly resyncs the affected block's textarea, since that's exactly the DOM state a text event's undo/redo needs to change.
* **Text-edit merge boundary:** Typing merges into the previous event only if it's still the tail of an *uninterrupted* streak. This is tracked with an explicit `streakEvent` reference in `App`, not inferred structurally — inferring it from "is the last event a text event for this block" alone is insufficient, because that's also true immediately after an undo/redo lands a text event back at the top of `activeEvents`, and merging a fresh keystroke into that event would silently erase the undo/redo step's own granularity. `streakEvent` is cleared on any struct change, undo, redo, or save-that-makes-it-the-saved-boundary — so a later edit can never merge backward across any of those.
* **Move merge boundary:** Consecutive moves of the same block merge the same way consecutive keystrokes do, via an analogous `moveStreak` reference — but a 'move' JSON Patch op only names array indices (`from`/`path`), not a block id, so unlike `streakEvent` it can't be inferred from the event itself; `moveStreak` explicitly pairs the block id with its streak event. Merging keeps only the *net* displacement: the block's index in the state just before the streak started, to its index now. If those two indices are equal, the whole run cancels out and the event is removed entirely, exactly like typing back to a text event's original content removes it. `moveStreak` is cleared by anything that would also break a text streak — a different block, a different kind of action, an add/delete, an undo/redo, or a save.
* **Never mutate a saved event:** Because a saved event and its `activeEvents` counterpart are the *same object reference* (Kernel's `replaceEventLog` keeps array elements as-is), merging a text edit in place must first confirm the target event isn't `kernel.getEventLog()`'s last element. Skipping this check would corrupt what the Kernel considers already-persisted without going through `replaceEventLog`, silently breaking the reference-equality unsaved-change check.
* **Undo past a save:** Undo/redo operate purely on `App`'s `activeEvents`/`redoStack` and never touch the Kernel directly. This is what makes undoing a saved change possible at all — it's just a divergence from the persisted log like any other unsaved change, resolved the same way (by the next `save()` call, via `replaceEventLog`).
* **JSONL is an export format, not the storage format:** `storage.ts` persists the log as one JSON array. Copy and Download instead serialize it as JSONL — one compact object per line, via a shared `historyJsonl()` helper — purely because that's a more useful format to paste or hand off elsewhere.
* **Beer CSS dialog focus timing:** Beer's dialog close is deferred via `requestAnimationFrame` and unconditionally blurs the active element when it runs. Focusing a newly created element (e.g. a just-added block's textarea) must be deferred via our own `requestAnimationFrame`, registered after Beer's own, so ours wins.
* **No Undo/Redo shortcut:** `Ctrl+Z` / `Ctrl+Shift+Z` are also the browser's native undo/redo for whatever textarea currently has focus. Binding them globally to our own undo/redo would fight that instead of complementing it, so those buttons are deliberately click-only.
* **Beer CSS `[hidden]` vs. utility classes:** Beer's own layout utility classes (e.g. `.middle-align`) set `display` unconditionally, which can outrank the UA's default `[hidden]{display:none}` rule by specificity. Handled with explicit `#id[hidden]{display:none}` overrides in `style.css` wherever this collision actually occurs.
