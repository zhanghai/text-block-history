import { applyPatch } from 'fast-json-patch';
import Delta from 'quill-delta';
import type { DocumentEvent, DocumentState } from './types';

export const INITIAL_STATE: DocumentState = { order: [], blocks: {} };

function applyEventToState(state: DocumentState, event: DocumentEvent): DocumentState {
  if (event.type === 'struct') {
    return applyPatch(state, event.patch, false, false).newDocument;
  }

  const block = state.blocks[event.blockId];
  if (!block) return state;

  const composed = new Delta().insert(block.content).compose(new Delta(event.delta));
  const newContent = composed.ops.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');

  return {
    ...state,
    blocks: {
      ...state.blocks,
      [event.blockId]: { ...block, content: newContent },
    },
  };
}

export function deriveState(initial: DocumentState, events: DocumentEvent[]): DocumentState {
  return events.reduce(applyEventToState, initial);
}
