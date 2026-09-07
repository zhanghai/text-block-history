import type { Operation } from 'fast-json-patch';
import type { DocumentState } from './types';

// Block IDs are now user-chosen free text, and they get embedded directly
// into JSON Patch path strings (RFC 6901), where "/" and "~" are special.
// Escaping here means a user-chosen ID can safely contain either.
function blockPath(blockId: string): string {
  return `/blocks/${blockId.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function buildInsertBlockPatch(index: number, newBlockId: string): Operation[] {
  return [
    { op: 'add', path: blockPath(newBlockId), value: { content: '' } },
    { op: 'add', path: `/order/${index}`, value: newBlockId },
  ];
}

export function buildAddBlockPatch(state: DocumentState, afterId: string | null, newBlockId: string): Operation[] {
  const index = afterId ? state.order.indexOf(afterId) + 1 : state.order.length;
  return buildInsertBlockPatch(index, newBlockId);
}

export function buildPrependBlockPatch(newBlockId: string): Operation[] {
  return buildInsertBlockPatch(0, newBlockId);
}

export function buildDeleteBlockPatch(state: DocumentState, blockId: string): Operation[] | null {
  const index = state.order.indexOf(blockId);
  if (index === -1) return null;
  return [
    { op: 'remove', path: `/order/${index}` },
    { op: 'remove', path: blockPath(blockId) },
  ];
}

export function buildMoveBlockPatch(state: DocumentState, blockId: string, direction: -1 | 1): Operation[] | null {
  const index = state.order.indexOf(blockId);
  const newIndex = index + direction;
  if (index === -1 || newIndex < 0 || newIndex >= state.order.length) return null;
  return [{ op: 'move', from: `/order/${index}`, path: `/order/${newIndex}` }];
}
