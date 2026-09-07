import 'beercss/dist/cdn/beer.min.css';
import 'beercss/dist/cdn/beer.min.js';
import './style.css';
import { Kernel } from './kernel';
import { App } from './app';
import { initThemeToggle } from './theme';

initThemeToggle(document.getElementById('theme-toggle-button') as HTMLButtonElement);

const kernel = new Kernel();

new App(kernel, {
  list: document.getElementById('block-list') as HTMLElement,
  emptyState: document.getElementById('empty-state') as HTMLElement,
  addFirstButton: document.getElementById('add-first-button') as HTMLButtonElement,
  addTopButton: document.getElementById('add-top-button') as HTMLButtonElement,
  undoButton: document.getElementById('undo-button') as HTMLButtonElement,
  redoButton: document.getElementById('redo-button') as HTMLButtonElement,
  saveButton: document.getElementById('save-button') as HTMLButtonElement,
  saveBadge: document.getElementById('save-badge') as HTMLElement,
  historyButton: document.getElementById('history-button') as HTMLButtonElement,
  historyDialog: document.getElementById('history-dialog') as HTMLDialogElement,
  copyHistoryButton: document.getElementById('copy-history-button') as HTMLButtonElement,
  downloadHistoryButton: document.getElementById('download-history-button') as HTMLButtonElement,
  confirmClearDeleteButton: document.getElementById('confirm-clear-delete-button') as HTMLButtonElement,
  addBlockForm: document.getElementById('add-block-form') as HTMLFormElement,
  addBlockIdInput: document.getElementById('add-block-id-input') as HTMLInputElement,
  addBlockError: document.getElementById('add-block-error') as HTMLElement,
});
