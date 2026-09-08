import type { Operation } from 'fast-json-patch';

export interface Block {
  id: string;
  content: string;
}

export interface DocumentState {
  blocks: Block[];
}

export interface DeltaOp {
  insert?: string;
  delete?: number;
  retain?: number;
}

export interface PatchEvent {
  type: 'patch';
  patch: Operation[];
}

export interface DeltaEvent {
  type: 'delta';
  blockId: string;
  delta: DeltaOp[];
}

export type DocumentEvent = PatchEvent | DeltaEvent;
