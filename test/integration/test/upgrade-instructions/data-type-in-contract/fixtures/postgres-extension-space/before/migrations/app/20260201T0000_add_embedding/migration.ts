import type { Contract as Start } from '../../snapshots/eb71bcdad05720d5faa9c875ab24d8e7247fcc24dbc9294d70d170808768f871/contract';
import startContract from '../../snapshots/eb71bcdad05720d5faa9c875ab24d8e7247fcc24dbc9294d70d170808768f871/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/8fe84ef30e8c9db2239923e644dd230639c7b97965a2d235dcc841806046ae34/contract';
import endContract from '../../snapshots/8fe84ef30e8c9db2239923e644dd230639c7b97965a2d235dcc841806046ae34/contract.json' with {
  type: 'json',
};

export const contracts = { start: startContract, end: endContract };
export type Contracts = { start: Start; end: End };
