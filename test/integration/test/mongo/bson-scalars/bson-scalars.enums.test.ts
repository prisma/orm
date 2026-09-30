import { Decimal128, Long } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

type Role =
  Contract['domain']['namespaces']['__unbound__']['enum']['Role']['members'][number]['value'];

function untypedRole(value: string): Role {
  return value as Role;
}

const refusal = {
  code: 'RUNTIME.ENCODE_FAILED',
  message:
    'Failed to encode field role in collection \'authors\': "ADMIN" is not a value of enum Role; the values are "USER" and "admin"',
  details: { label: 'role', collection: 'authors', allowed: ['USER', 'admin'] },
};

describe('Mongo enum fields', () => {
  it(
    'refuse a value outside the enum on create and update, naming the field and the values',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await expect(
          db.authors.create({ karma: 1n, balance: '1', role: untypedRole('ADMIN') }),
        ).rejects.toMatchObject(refusal);

        await db.authors.create({ karma: 2n, balance: '2', role: 'admin' });
        await expect(
          db.authors.where({ karma: 2n }).update({ role: untypedRole('ADMIN') }),
        ).rejects.toMatchObject(refusal);
        await expect(
          db.authors.where({ karma: 2n }).update((u) => [u.role.set(untypedRole('ADMIN'))]),
        ).rejects.toMatchObject(refusal);

        expect(await mongoDb.collection('authors').distinct('role')).toEqual(['admin']);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'query for a value outside the enum, so stored strays can be found',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await mongoDb.collection('authors').insertOne(
          {
            karma: Long.fromNumber(1),
            balance: Decimal128.fromString('1'),
            role: 'ADMIN',
          },
          { bypassDocumentValidation: true },
        );

        expect(await db.authors.where({ role: untypedRole('ADMIN') }).all()).toMatchObject([
          { role: 'ADMIN' },
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
