import type { Contract as End } from '../../snapshots/66a408f76796db73433c83fbd088c87d168b3800d3f0a737059e3c1f8fd013b0/contract';
import endContract from '../../snapshots/66a408f76796db73433c83fbd088c87d168b3800d3f0a737059e3c1f8fd013b0/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
