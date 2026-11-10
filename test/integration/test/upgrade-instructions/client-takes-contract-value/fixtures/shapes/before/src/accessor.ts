import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import json from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson: Object.assign(json, {
    get extra() {
      return 1;
    },
  }),
  url: process.env['DATABASE_URL'],
});

export const extra = 2;
