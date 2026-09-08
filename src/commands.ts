import type { Operation } from 'fast-json-patch';
import type { DocumentState } from './types';

// Paths address blocks purely by array position, so — unlike an id-keyed
// object — a block's user-chosen id never appears in a patch path and
// never needs escaping; it only ever appears as a plain value (below,
// and as `blockId` on a delta event).
function buildInsertBlockPatch(index: number, newBlockId: string): Operation[] {
  return [{ op: 'add', path: `/blocks/${index}`, value: { id: newBlockId, content: '' } }];
}

export function buildAddBlockPatch(state: DocumentState, afterId: string | null, newBlockId: string): Operation[] {
  const index = afterId ? state.blocks.findIndex((block) => block.id === afterId) + 1 : state.blocks.length;
  return buildInsertBlockPatch(index, newBlockId);
}

export function buildPrependBlockPatch(newBlockId: string): Operation[] {
  return buildInsertBlockPatch(0, newBlockId);
}

export function buildDeleteBlockPatch(state: DocumentState, blockId: string): Operation[] | null {
  const index = state.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return null;
  return [{ op: 'remove', path: `/blocks/${index}` }];
}

export function buildMoveBlockPatch(state: DocumentState, blockId: string, direction: -1 | 1): Operation[] | null {
  const index = state.blocks.findIndex((block) => block.id === blockId);
  const newIndex = index + direction;
  if (index === -1 || newIndex < 0 || newIndex >= state.blocks.length) return null;
  return [{ op: 'move', from: `/blocks/${index}`, path: `/blocks/${newIndex}` }];
}
