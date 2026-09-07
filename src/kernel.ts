import { deriveState, INITIAL_STATE } from './reducer';
import { loadEventLog, saveEventLog } from './storage';
import type { DocumentEvent, DocumentState } from './types';

export class Kernel {
  private eventLog: DocumentEvent[];
  private state: DocumentState;
  private listeners = new Set<(state: DocumentState) => void>();

  constructor() {
    this.eventLog = loadEventLog();
    this.state = deriveState(INITIAL_STATE, this.eventLog);
  }

  getEventLog(): DocumentEvent[] {
    return [...this.eventLog];
  }

  subscribe(listener: (state: DocumentState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // The one mutation the Kernel supports: replace the persisted log
  // wholesale and re-derive state from scratch. A plain append is just
  // this with the old log plus one new event; clearing everything is
  // this with an empty array. It's also what makes undoing past a saved
  // point possible — saving after such an undo means the persisted log
  // needs to end up *shorter* than it was, not just grow.
  replaceEventLog(events: DocumentEvent[]): void {
    this.eventLog = [...events];
    this.state = deriveState(INITIAL_STATE, this.eventLog);
    saveEventLog(this.eventLog);
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }
}
