import paradedb from '@prisma/orm-extension-paradedb/runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import { ItemCollection } from '../orm-client/collections';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = postgres({
  contract,
  extensions: [paradedb],
  collections: {
    Item: ItemCollection,
  },
});
