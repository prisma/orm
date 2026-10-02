import type { Contract as End } from '../../snapshots/275857ebc0d7a9b0ed6617bb8555fe85616026ac8ff4c25f2da9b67dcd768407/contract';
import endContract from '../../snapshots/275857ebc0d7a9b0ed6617bb8555fe85616026ac8ff4c25f2da9b67dcd768407/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
