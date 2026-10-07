import type { Contract as End } from '../../snapshots/28d0397503caeb837ce9b4e066368eb18074e3aa6ca3455388983c4164565eb6/contract';
import endContract from '../../snapshots/28d0397503caeb837ce9b4e066368eb18074e3aa6ca3455388983c4164565eb6/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
