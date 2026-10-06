import type { Contract as End } from '../../snapshots/d3a277a78b83a532f1ce006d0b7b5e059cc9d15a440922acd9df1055156afbf2/contract';
import endContract from '../../snapshots/d3a277a78b83a532f1ce006d0b7b5e059cc9d15a440922acd9df1055156afbf2/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
