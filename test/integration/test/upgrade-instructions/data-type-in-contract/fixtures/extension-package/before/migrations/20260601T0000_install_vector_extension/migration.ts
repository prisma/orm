import type { Contract as End } from '../snapshots/3d2c56a2944685bd21b05bc8a8d73164397df51c014201902932fbe7e80ff1b8/contract';
import endContract from '../snapshots/3d2c56a2944685bd21b05bc8a8d73164397df51c014201902932fbe7e80ff1b8/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
