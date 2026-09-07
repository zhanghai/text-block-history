import fastDiff from 'fast-diff';
import type { DeltaOp } from './types';

export function computeDelta(oldText: string, newText: string): DeltaOp[] {
  if (oldText === newText) return [];

  const diffs = fastDiff(oldText, newText);
  const ops: DeltaOp[] = [];

  for (const [kind, text] of diffs) {
    if (kind === fastDiff.EQUAL) ops.push({ retain: text.length });
    else if (kind === fastDiff.INSERT) ops.push({ insert: text });
    else if (kind === fastDiff.DELETE) ops.push({ delete: text.length });
  }

  return ops;
}
