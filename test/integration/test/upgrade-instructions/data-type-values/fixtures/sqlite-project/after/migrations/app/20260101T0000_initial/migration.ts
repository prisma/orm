import type { Contract as End } from '../../snapshots/87f816322dd1925839d0a5ac49589f22d308c3d3db34a1585a4b25f699735684/contract';
import endContract from '../../snapshots/87f816322dd1925839d0a5ac49589f22d308c3d3db34a1585a4b25f699735684/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
