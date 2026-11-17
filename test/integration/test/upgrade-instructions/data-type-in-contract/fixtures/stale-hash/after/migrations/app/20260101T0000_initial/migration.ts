import type { Contract as End } from '../../snapshots/a9cae1d6a356a52a11343d60bde0357c78701cfce9fdae926f29c9e2c19b1a04/contract';
import endContract from '../../snapshots/a9cae1d6a356a52a11343d60bde0357c78701cfce9fdae926f29c9e2c19b1a04/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
