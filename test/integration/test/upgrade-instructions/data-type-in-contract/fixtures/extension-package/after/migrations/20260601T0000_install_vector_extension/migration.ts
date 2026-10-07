import type { Contract as End } from '../snapshots/4a96b488a4ce92b434e5f7d6607b6435c0955f0d36b0018077045787764240e6/contract';
import endContract from '../snapshots/4a96b488a4ce92b434e5f7d6607b6435c0955f0d36b0018077045787764240e6/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
