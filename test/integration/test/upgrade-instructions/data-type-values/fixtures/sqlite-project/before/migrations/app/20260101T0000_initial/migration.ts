import type { Contract as End } from '../../snapshots/e12144f8cb1dd3d315b65f0098cc5ac938bbb6e4f6706a733a1a9f9194ef614b/contract';
import endContract from '../../snapshots/e12144f8cb1dd3d315b65f0098cc5ac938bbb6e4f6706a733a1a9f9194ef614b/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
