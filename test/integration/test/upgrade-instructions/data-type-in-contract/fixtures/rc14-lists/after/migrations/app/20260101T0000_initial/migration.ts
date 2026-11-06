import type { Contract as End } from '../../snapshots/2830fe0ef5f06f7b80b4ab1a88117aed494e45538e6ea67fa6bce37d41ee7250/contract';
import endContract from '../../snapshots/2830fe0ef5f06f7b80b4ab1a88117aed494e45538e6ea67fa6bce37d41ee7250/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
