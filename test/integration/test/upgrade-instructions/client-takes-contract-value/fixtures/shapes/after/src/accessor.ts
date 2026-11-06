import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';
import json from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(Object.assign(json, {
    get extra() {
      return 1;
    },
  }));

export const db = postgres({
  contract,
  url: process.env['DATABASE_URL'],
});

export const extra = 2;
