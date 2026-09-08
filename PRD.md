# Product Requirements Document: Text Block History

## 1. Product Overview

A purely frontend, block-based text editor built to validate an Event Sourcing data architecture. It abandons traditional full-document state storage in favor of an append-only event stream as the Single Source of Truth, combining JSON Patch (for structural changes) and Quill Delta (for text changes). The document the user sees is always a pure replay of that event stream from an empty initial state — there is no separately-stored "current document."

## 2. Core Constraints

* **Pure Text Content:** No rich text formatting. Each block is a multiline plain-text `<textarea>`.
* **Explicit Block Management:** The `Enter` key only inserts newlines within a block. Block creation, deletion, reordering, and clearing the whole document must be triggered via explicit UI controls.
* **User-Chosen Block IDs:** A block's ID is free text the user types when creating it, not an auto-generated identifier. It's shown read-only on the block afterward and can never be changed or reused by another block while it exists.
* **Scope Limits:** No multiplayer collaboration (CRDT), no cursor/selection tracking, and no nested blocks.

## 3. Functional Requirements

### 3.1 Manual Save Model

Unlike a typical auto-committing event log, changes here are staged locally and only become part of the persisted event history when the user explicitly saves:

* **Structural operations** (add, delete, move a block) and **text edits** are both staged as soon as they happen, and immediately reflected in the document the user sees.
* Nothing is written to the persisted event log until the user saves, via the Save button or `Ctrl+S`.
* An unsaved-changes indicator (a badge on the Save button) is shown whenever the currently displayed document doesn't match what's actually persisted.
* Closing the tab with unsaved changes prompts the browser's native "leave site?" confirmation.
* On save, consecutive edits to the same block are merged into a single event before being committed: consecutive text edits merge into one delta, and consecutive moves of the same block merge into one net displacement — which can collapse entirely if it cancels out (e.g. moving a block down, then immediately back up). See 3.2 for exactly what counts as "consecutive."

### 3.2 Undo / Redo

* Undo and Redo buttons revert or reapply one event at a time. There are deliberately no keyboard shortcuts for this — see the TDD for why.
* Undo is **not** limited to unsaved changes — it can also revert changes that were already saved in a previous save. Doing so does not retroactively edit the persisted log by itself; it just makes the displayed document diverge from what's persisted (i.e., it counts as an unsaved change) until the next save, at which point the persisted log is updated to match — which may mean it grows, or, if a previously-saved change was undone, that it shrinks.
* Redo is only cleared by making a new edit (typing, or a structural change) after an undo — never by saving. Anything redoable before a save is still redoable after.
* A run of consecutive same-kind actions on the same block — consecutive keystrokes, or consecutive moves — with nothing else happening in between, is treated as one undo step. Any of the following breaks that run, so a later action can't silently merge backward across it: editing or moving a *different* block, a different kind of action on the same block, an add or delete, an undo or redo, or a save.

### 3.3 History Viewer

* `Ctrl+H` or the History button opens a panel listing every event currently in the persisted log, in commit order, each pretty-printed.
* This view only ever reflects saved history — unsaved staged changes are not shown here.
* Copy and Download export the same persisted log as JSONL (one compact event per line), regardless of how it's pretty-printed in the panel.

### 3.4 Clear Everything

* A "Clear" action, gated behind a confirmation dialog, immediately deletes every block and the entire persisted history, resetting the document to empty. This action is not staged and is not itself undoable.

### 3.5 Empty Document

* The document may be fully empty (zero blocks), including as its starting state. An empty state placeholder with its own "add block" affordance is shown in that case. Deleting the last remaining block is allowed and returns the document to this empty state — no block is auto-created to prevent it.

### 3.6 Theming

* A theme toggle cycles through three preferences: Light, Dark, and Device Default (follows the OS setting, and continues to track it live if the OS setting changes while this preference is active). An explicit Light/Dark choice is remembered across sessions; Device Default is the state when nothing has been explicitly chosen.

## 4. Data Schema Contract

**Memory State:**

```typescript
interface DocumentState {
  blocks: {
    id: string;      // User-chosen, immutable
    content: string; // Plain text
  }[]; // Array position is display order — no separate ordering field.
}
```

**Event Log:**

```typescript
type DocumentEvent =
  | { type: 'patch'; patch: Operation[] } // fast-json-patch
  | { type: 'delta'; blockId: string; delta: DeltaOp[] }; // quill-delta ops
```

Events carry no ID or timestamp — the log's own position is the only ordering that matters, and nothing in the product needs to reference an individual event out of context.
