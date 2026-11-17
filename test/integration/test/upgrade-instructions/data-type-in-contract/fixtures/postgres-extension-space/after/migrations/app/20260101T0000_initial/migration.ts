import type { Contract as End } from '../../snapshots/99239f90bc2b6bb170c23be0fc3d2b7931e14211777db6d086f3301be62f707b/contract';
import endContract from '../../snapshots/99239f90bc2b6bb170c23be0fc3d2b7931e14211777db6d086f3301be62f707b/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
