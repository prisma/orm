import type { Contract as End } from '../../snapshots/73264bd00bf86a4bb8a0a329d31d577149a05b9a267fe7679df22aaa2b7e8dbe/contract';
import endContract from '../../snapshots/73264bd00bf86a4bb8a0a329d31d577149a05b9a267fe7679df22aaa2b7e8dbe/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
