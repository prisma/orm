import type { Contract as End } from '../../snapshots/eb71bcdad05720d5faa9c875ab24d8e7247fcc24dbc9294d70d170808768f871/contract';
import endContract from '../../snapshots/eb71bcdad05720d5faa9c875ab24d8e7247fcc24dbc9294d70d170808768f871/contract.json' with {
  type: 'json',
};

export const contracts = { start: null, end: endContract };
export type Contracts = { start: never; end: End };
