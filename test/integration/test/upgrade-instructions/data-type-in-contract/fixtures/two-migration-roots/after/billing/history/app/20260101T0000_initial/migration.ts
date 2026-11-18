import type { Contract as End } from '../../snapshots/7b90ed66186d9fc6824cca0d0cc7b957bb47de724164cfe891ea0b8477641664/contract';
import endContract from '../../snapshots/7b90ed66186d9fc6824cca0d0cc7b957bb47de724164cfe891ea0b8477641664/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
