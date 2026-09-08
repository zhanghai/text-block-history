# Text Block History

A block-based plain-text editor built to validate an **event-sourcing** data
architecture in the browser: every change to the document — structural or
textual — is represented as an event, and the current document is nothing
more than those events replayed from scratch. There is no traditional
"save the whole document" model; the append-only event log *is* the
document.

## Concept

- **Structural changes** (add / delete / move a block) are recorded as
  [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) operations
  (`fast-json-patch`).
- **Text changes** are recorded as [Quill Delta](https://quilljs.com/docs/delta/)
  operations (`quill-delta`), computed by diffing old and new text
  (`fast-diff`).
- The document you see is always `replay(events)` — a pure fold over the
  event log, from an empty initial state.
- Events are append-only and persisted to `localStorage` as they're
  committed. Nothing is ever mutated or deleted from the log.

## Working-tree model

Edits don't turn into committed events immediately. The app keeps its own
**active timeline** — the full sequence of events the document is
currently derived from — separately from what's actually persisted, the
same way a working tree can differ from the last commit in version
control:

- Typing merges consecutive keystrokes to the *same* block into a single
  delta, and moving the *same* block repeatedly merges into one net
  displacement — which can collapse to nothing at all if it cancels out
  (e.g. moving a block down, then immediately back up). Anything else —
  editing or moving a *different* block, an add or delete, an undo/redo,
  or a save — always ends the current streak; later actions can't
  silently merge back across it.
- **Undo / redo** move one event at a time between the active timeline and
  a redo stack — including events that are already saved. Undoing past a
  saved change doesn't touch the event log by itself; it just makes the
  active timeline diverge from it, the same as any other unsaved change,
  until the next Save.
- **Save** replaces the persisted event log wholesale with the current
  active timeline. Usually that means it grows (new events appended), but
  if you've undone something that was previously saved, it can also
  shrink. Save never clears the redo stack — anything you could redo
  before a save, you can still redo after.
- Closing the tab with unsaved changes (the active timeline no longer
  matching the persisted log) triggers the browser's native "leave site?"
  confirmation.

## Features

- Blocks with user-chosen, immutable IDs (shown read-only on each card)
- Multiline plain-text editing per block
- Reordering, inserting before/after, and deleting blocks
- Manual save with an unsaved-changes indicator
- Undo / redo across the entire history, including already-saved changes
- A history viewer showing every committed event, pretty-printed, with
  one-click copy or download of the full log as JSONL
- "Clear everything" (with confirmation) to reset the document
- Light / dark / device-default theme toggle, remembering an explicit
  choice and otherwise following the OS live
- Keyboard shortcuts (see below)

## Keyboard shortcuts

| Shortcut           | Action       |
| ------------------ | ------------ |
| `Ctrl+S` / `Cmd+S` | Save          |
| `Ctrl+H` / `Cmd+H` | Open history  |

## Getting started

```sh
npm install
npm run dev
```

Then open the printed local URL. The document lives entirely in
`localStorage` — there's no backend.

### Other scripts

```sh
npm run build    # type-check, then produce a production build in dist/
npm run preview  # serve the production build locally
```

## Tech stack

- [Vite](https://vitejs.dev/) + vanilla TypeScript (no framework)
- [Beer CSS](https://www.beercss.com/) for Material 3 Expressive styling
  and dialog/theme behavior — used declaratively wherever possible
  (`data-ui` attributes, `window.ui(...)`), with only the CSS Beer
  genuinely has no equivalent for written by hand
- `fast-json-patch`, `quill-delta`, `fast-diff` for the event/diff
  machinery described above

## Project structure

```
index.html          Page shell: header, dialogs, empty state
src/
  main.ts            Wires the DOM to the Kernel and the App
  app.ts             App: DOM rendering, event delegation, active timeline, undo/redo
  kernel.ts          Kernel: the event log, derived state, persistence
  reducer.ts         Pure event → state transitions (the "replay" logic)
  commands.ts        Builds JSON Patch operations for add/delete/move
  diff.ts            Old text + new text → a Quill Delta
  storage.ts         localStorage load/save for the event log
  theme.ts           Light/dark/device-default toggle (delegates to Beer's ui('mode'))
  types.ts           DocumentState / DocumentEvent shapes
  style.css          The handful of rules Beer CSS doesn't provide
  beercss.d.ts       Ambient type for Beer's global window.ui()
```

## Data model

```ts
interface DocumentState {
  blocks: { id: string; content: string }[]; // in display order
}

type DocumentEvent =
  | { type: 'patch'; patch: Operation[] }                // fast-json-patch ops
  | { type: 'delta'; blockId: string; delta: DeltaOp[] }; // Quill Delta ops
```

Blocks are a plain array — array position doubles as display order, so
there's no separate ordering structure to keep in sync. Block IDs are
free text chosen by the user; since patch paths address blocks purely by
array position, an id never needs escaping — it only ever appears as a
plain value (`value.id` on an add, `blockId` on a delta event). Every
id-based lookup is a linear scan, which is fine at the expected scale of
roughly 4-16 blocks.

## Persistence

The full event log is stored under the `text-block-history:event-log` key
in `localStorage`; the theme preference under `text-block-history:theme`.
Clearing site data resets the document. There's no compaction or size
limit handling — this is a validation project, not a production editor.

## License

```
Copyright (c) 2026 Hai Zhang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
