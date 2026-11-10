import type { Contract as End } from '../../snapshots/563f9e0b2a9d656e14bd2909f2f5864b160744a27b6922a2a3f10bf6df7abec8/contract';
import endContract from '../../snapshots/563f9e0b2a9d656e14bd2909f2f5864b160744a27b6922a2a3f10bf6df7abec8/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
