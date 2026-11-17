import type { Contract as End } from '../../snapshots/85008a1e38a85164c8ad699585433ec7cd2b599eceffbbf7f753923b114e3219/contract';
import endContract from '../../snapshots/85008a1e38a85164c8ad699585433ec7cd2b599eceffbbf7f753923b114e3219/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
