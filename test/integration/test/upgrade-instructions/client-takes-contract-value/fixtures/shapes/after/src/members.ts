import sqlite from '@prisma/orm-sqlite/runtime';
import { contractFromJson } from '@prisma/orm-sqlite/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

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

export const db = sqlite({ contract, path: './dev.db' });
