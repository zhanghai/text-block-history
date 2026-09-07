import type { DocumentEvent } from './types';

const STORAGE_KEY = 'text-block-history:event-log';

export function loadEventLog(): DocumentEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEventLog(events: DocumentEvent[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}
