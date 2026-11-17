import { MongoContractView } from '@prisma/orm-mongo/family/ir';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract';
import contractJson from '../src/contract.json' with { type: 'json' };

describe('migration', () => {
  it('contract contains expected index definitions', () => {
    const collections = MongoContractView.fromJson<Contract>(contractJson).collection;

    expect(collections.products.indexes).toMatchObject([
      {
        keys: [
          { field: 'name', direction: 'text' },
          { field: 'description', direction: 'text' },
        ],
        weights: { name: 10, description: 1 },
      },
      {
        keys: [
          { field: 'brand', direction: 1 },
          { field: 'subCategory', direction: 1 },
        ],
      },
      {
        keys: [
          { field: 'primaryCategory', direction: 1 },
          { field: 'articleType', direction: 1 },
        ],
      },
      { keys: [{ field: 'code', direction: 'hashed' }] },
    ]);

    expect(collections.users.indexes).toMatchObject([
      { keys: [{ field: 'email', direction: 1 }], unique: true },
    ]);

    expect(collections.carts.indexes).toMatchObject([
      { keys: [{ field: 'userId', direction: 1 }], unique: true },
    ]);

    expect(collections.orders.indexes).toMatchObject([
      { keys: [{ field: 'userId', direction: 1 }] },
    ]);

    expect(collections.events.indexes).toMatchObject([
      {
        keys: [
          { field: 'userId', direction: 1 },
          { field: 'timestamp', direction: -1 },
        ],
      },
      { keys: [{ field: 'timestamp', direction: 1 }], expireAfterSeconds: 7776000 },
    ]);

    expect(collections.invoices.indexes).toMatchObject([
      { keys: [{ field: 'orderId', direction: 1 }] },
      { keys: [{ field: 'issuedAt', direction: -1 }], sparse: true },
    ]);

    expect(collections.locations.indexes).toMatchObject([
      {
        keys: [
          { field: 'city', direction: 1 },
          { field: 'country', direction: 1 },
        ],
        collation: { locale: 'en', strength: 2 },
      },
    ]);
  });
});
