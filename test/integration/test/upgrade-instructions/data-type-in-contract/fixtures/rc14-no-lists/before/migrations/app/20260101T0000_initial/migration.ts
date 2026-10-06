import type { Contract as End } from '../../snapshots/17398e6d66de2a0c1a138453eac935af0f965aa197c409a946436619f204a21a/contract';
import endContract from '../../snapshots/17398e6d66de2a0c1a138453eac935af0f965aa197c409a946436619f204a21a/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
