import type { Contract as End } from '../../snapshots/2d59ae34d8f960548d4ccab7dbf2fdf972c643c279b18fe71bd043dc3bfe7211/contract';
import endContract from '../../snapshots/2d59ae34d8f960548d4ccab7dbf2fdf972c643c279b18fe71bd043dc3bfe7211/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
