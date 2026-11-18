import type { Contract as Start } from '../../snapshots/99239f90bc2b6bb170c23be0fc3d2b7931e14211777db6d086f3301be62f707b/contract';
import startContract from '../../snapshots/99239f90bc2b6bb170c23be0fc3d2b7931e14211777db6d086f3301be62f707b/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/adc839d7d404a69ced856b2528efb74e4f4aebb1b5401833b20c4ba144a791a5/contract';
import endContract from '../../snapshots/adc839d7d404a69ced856b2528efb74e4f4aebb1b5401833b20c4ba144a791a5/contract.json' with {
  type: 'json',
};

export const contracts = { start: startContract, end: endContract };
export type Contracts = { start: Start; end: End };
