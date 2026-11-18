import type { Contract as End } from '../../snapshots/10bb15c2ae8fc4a31a394f5a046eb75fe13e6a78fb4c99b1e0397d038ba25212/contract';
import endContract from '../../snapshots/10bb15c2ae8fc4a31a394f5a046eb75fe13e6a78fb4c99b1e0397d038ba25212/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
