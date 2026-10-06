import type { Contract as End } from '../../snapshots/3fa48ebe1f86cf8587c9887b33f8fd0b38caf19703ca83aa25657456e12bd675/contract';
import endContract from '../../snapshots/3fa48ebe1f86cf8587c9887b33f8fd0b38caf19703ca83aa25657456e12bd675/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
