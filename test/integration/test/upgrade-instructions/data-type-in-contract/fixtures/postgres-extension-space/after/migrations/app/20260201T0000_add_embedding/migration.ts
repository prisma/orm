import type { Contract as Start } from '../../snapshots/99239f90bc2b6bb170c23be0fc3d2b7931e14211777db6d086f3301be62f707b/contract';
import startContract from '../../snapshots/99239f90bc2b6bb170c23be0fc3d2b7931e14211777db6d086f3301be62f707b/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/ab03042a26032f51c0dc4a04e19d96ece877f22a1e876f238327cb21f480d703/contract';
import endContract from '../../snapshots/ab03042a26032f51c0dc4a04e19d96ece877f22a1e876f238327cb21f480d703/contract.json' with {
  type: 'json',
};

export const contracts = { start: startContract, end: endContract };
export type Contracts = { start: Start; end: End };
