import type { Contract as End } from '../../snapshots/4f20c9f9047b394c4018e94a5e6538e6b4bd30b46604c73d84a4bbd3c12b5b8e/contract';
import endContract from '../../snapshots/4f20c9f9047b394c4018e94a5e6538e6b4bd30b46604c73d84a4bbd3c12b5b8e/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
