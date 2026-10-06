import type { Contract as Start } from '../../snapshots/eb71bcdad05720d5faa9c875ab24d8e7247fcc24dbc9294d70d170808768f871/contract';
import startContract from '../../snapshots/eb71bcdad05720d5faa9c875ab24d8e7247fcc24dbc9294d70d170808768f871/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/ffcb5620e06a06ea2c6dad025087d882406fe4c66a282dbda185b6d54638b155/contract';
import endContract from '../../snapshots/ffcb5620e06a06ea2c6dad025087d882406fe4c66a282dbda185b6d54638b155/contract.json' with {
  type: 'json',
};

export const contracts = { start: startContract, end: endContract };
export type Contracts = { start: Start; end: End };
