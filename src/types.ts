import type { Operation } from 'fast-json-patch';

export interface Block {
  content: string;
}

export interface DocumentState {
  order: string[];
  blocks: Record<string, Block>;
}

export interface DeltaOp {
  insert?: string;
  delete?: number;
  retain?: number;
}

export interface StructEvent {
  type: 'struct';
  patch: Operation[];
}

export interface TextEvent {
  type: 'text';
  blockId: string;
  delta: DeltaOp[];
}

export type DocumentEvent = StructEvent | TextEvent;
