import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

interface Holder {
  contract: string;
}

export class Store {
  contract = 'main';
  contractName(): string {
    return this.contract;
  }
}

export const settings: Holder = { contract: 'main' };

export const db = sqlite<Contract>({ contractJson, path: './dev.db' });
