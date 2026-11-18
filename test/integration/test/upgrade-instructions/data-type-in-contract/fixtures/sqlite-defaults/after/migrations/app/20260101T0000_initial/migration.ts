import type { Contract as End } from '../../snapshots/9df4e74652f749c2f4006615728f0bf1b589cb7b30a4159211c4661d0af93109/contract';
import endContract from '../../snapshots/9df4e74652f749c2f4006615728f0bf1b589cb7b30a4159211c4661d0af93109/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
