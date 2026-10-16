import type { Contract as End } from '../../snapshots/be4174af061494b515cb3031f75051235fd9307ab05a00c78b5b017c1578b32a/contract';
import endContract from '../../snapshots/be4174af061494b515cb3031f75051235fd9307ab05a00c78b5b017c1578b32a/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
