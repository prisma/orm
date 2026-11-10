import type { Contract as End } from '../../snapshots/28369815a587ef18873c40e9269de8b47a1f0d86f1c34db4748d24cd98cdb9cb/contract';
import endContract from '../../snapshots/28369815a587ef18873c40e9269de8b47a1f0d86f1c34db4748d24cd98cdb9cb/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
