import type { Operation } from 'fast-json-patch';
import { buildAddBlockPatch, buildDeleteBlockPatch, buildMoveBlockPatch, buildPrependBlockPatch } from './commands';
import { computeDelta } from './diff';
import { Kernel } from './kernel';
import { deriveState, INITIAL_STATE } from './reducer';
import type { DocumentEvent, DocumentState, StructEvent } from './types';

interface AppElements {
  list: HTMLElement;
  emptyState: HTMLElement;
  addFirstButton: HTMLButtonElement;
  addTopButton: HTMLButtonElement;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  saveBadge: HTMLElement;
  historyButton: HTMLButtonElement;
  historyDialog: HTMLDialogElement;
  copyHistoryButton: HTMLButtonElement;
  downloadHistoryButton: HTMLButtonElement;
  confirmClearDeleteButton: HTMLButtonElement;
  addBlockForm: HTMLFormElement;
  addBlockIdInput: HTMLInputElement;
  addBlockError: HTMLElement;
}

interface BlockElements {
  article: HTMLElement;
  textarea: HTMLTextAreaElement;
}

export class App {
  private kernel: Kernel;
  private elements: AppElements;
  private blockElements = new Map<string, BlockElements>();

  // The full timeline currently in effect — everything the document is
  // derived from — which may differ from what's actually persisted
  // (kernel.getEventLog()) in either direction: it can run ahead (new
  // edits not yet saved) or fall behind (something saved was undone).
  // Either way, "unsaved changes" just means this no longer matches the
  // persisted log (see hasUnsavedChanges) — Save's job is to make the
  // persisted log match this exactly. Initialized from the kernel's log
  // at startup, then owned entirely by App; the kernel is never mutated
  // except by save()/clearAll() explicitly handing it a new log.
  //
  // Entries are appended in the exact order actions happen (see
  // recordTextEdit and stageStruct): a text edit only ever merges into
  // the immediately preceding entry if that entry is a text edit for the
  // very same block *and* isn't already saved — so a struct change, a
  // save, or switching to edit a different block, all end up as hard
  // boundaries that later edits can't merge back across.
  private activeEvents: DocumentEvent[] = [];

  // Events popped off activeEvents by undo(), in pop order, so redo()
  // can push them straight back. Undo/redo can reach all the way back
  // through saved history, not just unsaved edits — since it never
  // touches the kernel directly, "undoing" a saved event just means the
  // document no longer matches what's persisted until the next Save
  // (same as any other unsaved change). A new edit (not an undo/redo)
  // clears this, same as any other undo/redo implementation: once
  // you've branched off with a new change, the old "future" no longer
  // applies. Saving does *not* clear it — a save doesn't invalidate
  // anything you could still redo.
  private redoStack: DocumentEvent[] = [];

  // Set right before the add-block dialog opens: null means "insert at
  // the very start", a block id means "insert after that block".
  private pendingInsertAfterId: string | null = null;

  // The event, if any, that a fresh keystroke is still allowed to merge
  // into — i.e. the tail end of an uninterrupted typing streak started by
  // recordTextEdit itself. Reference equality against activeEvents' last
  // element is what actually gates the merge (see recordTextEdit); this
  // is what breaks the streak the moment anything *other* than plain
  // typing touches the timeline. Without it, typing right after an undo
  // or redo would silently fuse the new keystroke into whatever text
  // event undo/redo just moved into that slot, corrupting that step's
  // undo granularity instead of recording it as its own step.
  private streakEvent: DocumentEvent | null = null;

  // Mirrors streakEvent above, but for moves. A 'move' JSON Patch op only
  // names array indices, not the block that moved, so unlike a text
  // event there's no way to recover "which block does this event belong
  // to" just by looking at the event — the id has to be tracked here
  // explicitly instead. A merged run of moves keeps only the *net*
  // displacement, from wherever the block sat before the run started to
  // wherever it sits now; moving it back to that same spot collapses the
  // whole run to nothing, the same as typing back to a text event's
  // original content does in recordTextEdit.
  private moveStreak: { blockId: string; event: StructEvent } | null = null;

  constructor(kernel: Kernel, elements: AppElements) {
    this.kernel = kernel;
    this.elements = elements;
    this.activeEvents = kernel.getEventLog();

    this.render();
    this.kernel.subscribe(() => this.render());
    this.bindEvents();
  }

  private getDisplayState(): DocumentState {
    return deriveState(INITIAL_STATE, this.activeEvents);
  }

  private render(): void {
    const state = this.getDisplayState();

    for (const id of state.order) {
      if (!this.blockElements.has(id)) {
        this.createBlockElement(id, state.blocks[id].content);
      }
    }

    for (const id of [...this.blockElements.keys()]) {
      if (!state.order.includes(id)) {
        this.blockElements.get(id)!.article.remove();
        this.blockElements.delete(id);
      }
    }

    const focusedId = this.getFocusedBlockId();
    const focusedTextarea = focusedId ? this.blockElements.get(focusedId)?.textarea : undefined;
    const selection = focusedTextarea
      ? { start: focusedTextarea.selectionStart, end: focusedTextarea.selectionEnd }
      : null;

    state.order.forEach((id, index) => {
      const element = this.blockElements.get(id)!.article;
      const expected = this.elements.list.children[index];
      if (expected !== element) {
        this.elements.list.insertBefore(element, expected ?? null);
      }
    });

    if (focusedTextarea && document.activeElement !== focusedTextarea) {
      focusedTextarea.focus();
      if (selection) focusedTextarea.setSelectionRange(selection.start, selection.end);
    }

    // Note: an existing block's textarea value is deliberately never
    // resynced to committed content here. A block's live value is a
    // pending edit the user hasn't saved yet; render() now runs on every
    // staged structural action (not just after a save), so resyncing
    // unconditionally would wipe out unsaved text in unrelated blocks
    // the moment focus moved elsewhere. New blocks get their initial
    // value from createBlockElement(); nothing else should overwrite it.

    this.elements.emptyState.hidden = state.order.length > 0;
    this.updateChangeIndicators();
  }

  private getFocusedBlockId(): string | undefined {
    for (const [id, { textarea }] of this.blockElements) {
      if (document.activeElement === textarea) return id;
    }
    return undefined;
  }

  private createBlockElement(id: string, content: string): void {
    const article = document.createElement('article');
    article.className = 'block round surface-container-low';
    article.dataset.blockId = id;
    article.innerHTML = `
      <h6 class="block-id"></h6>
      <div class="field textarea">
        <textarea placeholder="Type something…"></textarea>
      </div>
      <nav>
        <button class="circle transparent" data-action="move-up" title="Move up"><i>arrow_upward</i></button>
        <button class="circle transparent" data-action="move-down" title="Move down"><i>arrow_downward</i></button>
        <div class="max"></div>
        <button class="circle transparent" data-action="add-after" data-ui="#add-block-dialog" title="Add after"><i>add</i></button>
        <button class="circle transparent" data-action="delete" title="Delete"><i>delete</i></button>
      </nav>
    `;

    // Set via textContent, not interpolated into the template above — the
    // id is user-chosen free text and must never be treated as markup.
    (article.querySelector('.block-id') as HTMLElement).textContent = id;

    const textarea = article.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = content;
    textarea.dataset.blockId = id;

    this.elements.list.appendChild(article);
    this.blockElements.set(id, { article, textarea });
  }

  private bindEvents(): void {
    this.elements.list.addEventListener('input', (e) => {
      const target = e.target;
      if (target instanceof HTMLTextAreaElement && target.dataset.blockId) {
        this.recordTextEdit(target.dataset.blockId, target.value);
      }
    });

    this.elements.list.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button[data-action]');
      if (!(button instanceof HTMLButtonElement)) return;
      const article = button.closest('article[data-block-id]');
      const blockId = article instanceof HTMLElement ? article.dataset.blockId : undefined;
      if (!blockId) return;
      this.handleAction(button.dataset.action ?? '', blockId);
    });

    this.elements.addTopButton.addEventListener('click', () => this.openAddBlockDialog(null));
    this.elements.addFirstButton.addEventListener('click', () => this.openAddBlockDialog(null));
    this.elements.addBlockForm.addEventListener('submit', (e) => this.handleAddBlockSubmit(e));

    this.elements.undoButton.addEventListener('click', () => this.undo());
    this.elements.redoButton.addEventListener('click', () => this.redo());
    this.elements.saveButton.addEventListener('click', () => this.save());

    // No shortcut for undo/redo: Ctrl+Z / Ctrl+Shift+Z are also the
    // browser's native undo/redo for whatever textarea has focus, and
    // claiming them globally would fight that instead of complementing
    // it. Undo/redo here stay button-only.
    document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      switch (e.key.toLowerCase()) {
        case 's':
          e.preventDefault();
          this.save();
          break;
        case 'h':
          e.preventDefault();
          // Simulate a real click rather than duplicating what a click
          // already does (populate the log, then let Beer's data-ui
          // attribute open the dialog) — one code path for both triggers.
          this.elements.historyButton.click();
          break;
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (!this.hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = '';
    });

    // Opening/closing dialogs — including focus handling, the dimmed
    // .overlay backdrop, Escape-to-close, and outside-click dismissal —
    // is handled entirely by Beer CSS's data-ui attributes in index.html;
    // see main.ts / beer.min.js. We only need our own listeners for the
    // app-specific side effects that Beer knows nothing about: staging
    // the add-block form's result, populating the history log, copying
    // or downloading it, and actually clearing the document.
    this.elements.historyButton.addEventListener('click', () => this.populateHistory());
    this.elements.copyHistoryButton.addEventListener('click', () => this.copyHistory());
    this.elements.downloadHistoryButton.addEventListener('click', () => this.downloadHistory());
    this.elements.confirmClearDeleteButton.addEventListener('click', () => this.clearAll());
  }

  // "Unsaved" means the active timeline no longer matches what's
  // actually persisted — which can happen either by running ahead (new
  // edits) or by falling behind (something saved was undone). Comparing
  // by reference, not just length: an event object only ever ends up at
  // the same array slot in both places if it round-tripped through
  // save()/undo()/redo() untouched, so this also correctly reports
  // "nothing unsaved" if you undo something and then redo it right back.
  private hasUnsavedChanges(): boolean {
    const saved = this.kernel.getEventLog();
    if (this.activeEvents.length !== saved.length) return true;
    return this.activeEvents.some((event, i) => event !== saved[i]);
  }

  private updateChangeIndicators(): void {
    this.elements.saveBadge.hidden = !this.hasUnsavedChanges();
    this.elements.undoButton.disabled = this.activeEvents.length === 0;
    this.elements.redoButton.disabled = this.redoStack.length === 0;
  }

  // Records a live text edit into the active timeline, in the exact
  // order it happens. If the immediately preceding entry is the tail of
  // this same uninterrupted typing streak (streakEvent) — and isn't the
  // last-saved event — it's updated in place (recomputing the delta from
  // the baseline before that entry, so many keystrokes collapse into one
  // delta); otherwise a new entry is appended and becomes the new streak
  // tail. A saved event is never mutated in place: it's the same object
  // the kernel's persisted log points to, and touching it directly would
  // silently corrupt what hasUnsavedChanges() (and the kernel) think is
  // actually saved.
  private recordTextEdit(blockId: string, newText: string): void {
    this.redoStack = [];
    this.moveStreak = null;
    const saved = this.kernel.getEventLog();
    const last = this.activeEvents[this.activeEvents.length - 1];
    const lastIsMergeable = last === this.streakEvent && last?.type === 'text' && last.blockId === blockId && last !== saved[saved.length - 1];

    if (lastIsMergeable && last?.type === 'text') {
      const baseline = deriveState(INITIAL_STATE, this.activeEvents.slice(0, -1)).blocks[blockId]?.content ?? '';
      if (newText === baseline) {
        this.activeEvents.pop();
        this.streakEvent = null;
      } else {
        last.delta = computeDelta(baseline, newText);
      }
    } else {
      const baseline = this.getDisplayState().blocks[blockId]?.content ?? '';
      if (newText === baseline) {
        this.streakEvent = null;
        return;
      }
      const event: DocumentEvent = { type: 'text', blockId, delta: computeDelta(baseline, newText) };
      this.activeEvents.push(event);
      this.streakEvent = event;
    }

    this.updateChangeIndicators();
  }

  // For struct changes other than a move (add, delete, prepend) — moves
  // go through moveBlock instead, since they can merge with a preceding
  // move of the same block.
  private stageStruct(patch: Operation[]): void {
    this.redoStack = [];
    this.streakEvent = null;
    this.moveStreak = null;
    this.activeEvents.push({ type: 'struct', patch });
    this.render();
  }

  // Undo/redo move one event at a time between activeEvents and
  // redoStack — the same operation whether that event happens to be
  // saved or not. render() already handles any structural fallout (a
  // block reappearing, disappearing, or moving); the one thing it
  // deliberately never does — resyncing an existing block's live
  // textarea — is exactly what a text event's undo/redo needs, so that's
  // done here.
  private undo(): void {
    const event = this.activeEvents.pop();
    if (!event) return;
    this.redoStack.push(event);
    this.streakEvent = null;
    this.moveStreak = null;
    this.syncAfterUndoRedo(event);
  }

  private redo(): void {
    const event = this.redoStack.pop();
    if (!event) return;
    this.activeEvents.push(event);
    this.streakEvent = null;
    this.moveStreak = null;
    this.syncAfterUndoRedo(event);
  }

  private syncAfterUndoRedo(event: DocumentEvent): void {
    this.render();
    if (event.type === 'text') {
      const textarea = this.blockElements.get(event.blockId)?.textarea;
      if (textarea) textarea.value = this.getDisplayState().blocks[event.blockId]?.content ?? '';
    }
  }

  // Makes the persisted log match the active timeline exactly — whether
  // that means appending new events, or ending up shorter than before
  // because an undo reached back into previously saved history. A single
  // atomic replace, so the kernel's own notification triggers exactly
  // one render() against the final result — no intermediate, partially
  // -applied state ever gets rendered along the way.
  private save(): void {
    this.kernel.replaceEventLog(this.activeEvents);
  }

  private clearAll(): void {
    // Unlike a normal delete, this reset is already immediate and
    // confirmed (via the dialog) rather than staged, and isn't itself
    // undoable.
    this.activeEvents = [];
    this.redoStack = [];
    this.streakEvent = null;
    this.moveStreak = null;
    this.kernel.replaceEventLog([]);
  }

  private handleAction(action: string, blockId: string): void {
    switch (action) {
      case 'delete':
        this.deleteBlock(blockId);
        break;
      case 'add-after':
        this.openAddBlockDialog(blockId);
        break;
      case 'move-up':
        this.moveBlock(blockId, -1);
        break;
      case 'move-down':
        this.moveBlock(blockId, 1);
        break;
    }
  }

  private deleteBlock(blockId: string): void {
    const patch = buildDeleteBlockPatch(this.getDisplayState(), blockId);
    if (!patch) return;
    this.stageStruct(patch);
  }

  // Consecutive moves of the same block merge into one event holding
  // just the net displacement, the same way consecutive keystrokes merge
  // in recordTextEdit — moving a block down three times and saving
  // should leave one move event in the log, not three. Moving it back to
  // where it started collapses the run to nothing at all: this is
  // expected, not a bug — the document really hasn't changed.
  private moveBlock(blockId: string, direction: -1 | 1): void {
    const state = this.getDisplayState();
    const currentIndex = state.order.indexOf(blockId);
    const newIndex = currentIndex + direction;
    if (currentIndex === -1 || newIndex < 0 || newIndex >= state.order.length) return;

    this.redoStack = [];
    this.streakEvent = null;

    const saved = this.kernel.getEventLog();
    const last = this.activeEvents[this.activeEvents.length - 1];
    const mergeable =
      this.moveStreak !== null &&
      this.moveStreak.blockId === blockId &&
      last === this.moveStreak.event &&
      last !== saved[saved.length - 1];

    if (mergeable && this.moveStreak) {
      const before = deriveState(INITIAL_STATE, this.activeEvents.slice(0, -1));
      const originalIndex = before.order.indexOf(blockId);
      if (originalIndex === newIndex) {
        this.activeEvents.pop();
        this.moveStreak = null;
      } else {
        this.moveStreak.event.patch = [{ op: 'move', from: `/order/${originalIndex}`, path: `/order/${newIndex}` }];
      }
    } else {
      const patch = buildMoveBlockPatch(state, blockId, direction)!;
      const event: StructEvent = { type: 'struct', patch };
      this.activeEvents.push(event);
      this.moveStreak = { blockId, event };
    }

    this.render();
  }

  private openAddBlockDialog(afterId: string | null): void {
    this.pendingInsertAfterId = afterId;
    this.elements.addBlockIdInput.value = '';
    this.elements.addBlockError.hidden = true;
  }

  private showAddBlockError(message: string): void {
    this.elements.addBlockError.textContent = message;
    this.elements.addBlockError.hidden = false;
  }

  private handleAddBlockSubmit(e: SubmitEvent): void {
    e.preventDefault();

    const id = this.elements.addBlockIdInput.value.trim();
    if (!id) {
      this.showAddBlockError('Block ID cannot be empty.');
      return;
    }

    const state = this.getDisplayState();
    if (state.blocks[id]) {
      this.showAddBlockError('That ID is already in use.');
      return;
    }

    const afterId = this.pendingInsertAfterId;
    const patch = afterId === null ? buildPrependBlockPatch(id) : buildAddBlockPatch(state, afterId, id);
    this.stageStruct(patch);

    // Beer's dialog close runs on a deferred requestAnimationFrame and
    // unconditionally blurs whatever is focused at that later point —
    // focusing the new block synchronously here would just get blurred
    // right back out. Queue our focus behind Beer's own rAF callback
    // (registered synchronously by window.ui() below) so it wins.
    window.ui?.('#add-block-dialog');
    requestAnimationFrame(() => this.blockElements.get(id)?.textarea.focus());
  }

  private populateHistory(): void {
    const dialog = this.elements.historyDialog;
    // Articles (both log entries and the empty-state placeholder) are
    // appended directly as children of the dialog, alongside its
    // <header> — only remove what a previous populateHistory() call
    // added, never the header itself.
    dialog.querySelectorAll(':scope > article').forEach((element) => element.remove());

    const events = this.kernel.getEventLog();
    this.elements.copyHistoryButton.disabled = events.length === 0;
    this.elements.downloadHistoryButton.disabled = events.length === 0;

    if (events.length === 0) {
      const empty = document.createElement('article');
      empty.className = 'medium middle-align center-align';

      const wrapper = document.createElement('div');
      const icon = document.createElement('i');
      icon.className = 'extra';
      icon.textContent = 'history';
      const heading = document.createElement('h5');
      heading.textContent = 'No history yet';
      const description = document.createElement('p');
      description.textContent = 'Saved changes will show up here.';
      wrapper.append(icon, heading, description);

      empty.appendChild(wrapper);
      dialog.appendChild(empty);
      return;
    }

    for (const event of events) {
      const article = document.createElement('article');
      article.className = 'large-padding border';

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = JSON.stringify(event, null, 2);
      pre.appendChild(code);
      article.appendChild(pre);

      dialog.appendChild(article);
    }
  }

  // Copy and Download both export the log as JSONL — one compact JSON
  // object per line — regardless of how populateHistory() pretty-prints
  // it for display; built straight from the log, not from that dialog's
  // DOM.
  private historyJsonl(): string {
    return this.kernel.getEventLog().map((event) => JSON.stringify(event)).join('\n');
  }

  private copyHistory(): void {
    void navigator.clipboard.writeText(this.historyJsonl()).then(() => {
      // 2000ms matches Android's short-toast duration — long enough to
      // notice, short enough not to linger over a copy confirmation.
      window.ui?.('#copy-history-snackbar', 2000);
    });
  }

  private downloadHistory(): void {
    const url = URL.createObjectURL(new Blob([this.historyJsonl()], { type: 'application/jsonl' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'history.jsonl';
    link.click();
    URL.revokeObjectURL(url);
  }
}
