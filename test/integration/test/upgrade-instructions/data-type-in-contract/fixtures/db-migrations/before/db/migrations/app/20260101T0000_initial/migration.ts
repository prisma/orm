import type { Contract as End } from '../../snapshots/55ea5bec09638773a4537b126c44a94c3c7714adacbc44298605dcf6d850c201/contract';
import endContract from '../../snapshots/55ea5bec09638773a4537b126c44a94c3c7714adacbc44298605dcf6d850c201/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
