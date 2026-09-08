import { applyPatch } from 'fast-json-patch';
import Delta from 'quill-delta';
import type { DocumentEvent, DocumentState } from './types';

export const INITIAL_STATE: DocumentState = { blocks: [] };

function applyEventToState(state: DocumentState, event: DocumentEvent): DocumentState {
  if (event.type === 'patch') {
    return applyPatch(state, event.patch, false, false).newDocument;
  }

  const index = state.blocks.findIndex((block) => block.id === event.blockId);
  if (index === -1) return state;

  const block = state.blocks[index];
  const composed = new Delta().insert(block.content).compose(new Delta(event.delta));
  const newContent = composed.ops.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');

  const blocks = [...state.blocks];
  blocks[index] = { ...block, content: newContent };
  return { blocks };
}

export function deriveState(initial: DocumentState, events: DocumentEvent[]): DocumentState {
  return events.reduce(applyEventToState, initial);
}
