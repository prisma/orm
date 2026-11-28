import { blindCast } from '@prisma/orm-framework/utils/casts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClientLike, prismaAdapter } from '../../src/adapter';
import { type AdapterDatabases, createAdapterDatabases } from '../helpers/adapter-databases';
import { type TargetName, targets } from '../helpers/databases';
import { pslForConfiguration } from '../helpers/printed-psl';
import { timeouts } from '../timeouts';

let databases: AdapterDatabases;

beforeAll(async () => {
  databases = await createAdapterDatabases();
}, timeouts.devServerStart);

afterAll(() => databases?.dispose(), timeouts.devServerClose + timeouts.hook);

const corePsl = (target: TargetName, namespace?: string) =>
  pslForConfiguration(
    databases.emptyContract(target),
    {},
    namespace === undefined ? {} : { namespace },
  );

const verification = () => ({
  identifier: 'someone@example.com',
  value: 'token',
  expiresAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('prismaAdapter refuses', () => {
  it('an object with no contract, such as a transaction', async () => {
    const client = await databases.open('sqlite', corePsl('sqlite'));
    await client.transaction(async (tx) => {
      const transaction = blindCast<
        PrismaClientLike,
        'an application can pass a transaction by mistake: it has no contract, which the types also refuse'
      >({ orm: tx.orm, transaction: client.transaction.bind(client) });
      expect(() => prismaAdapter(transaction)).toThrow(
        'prismaAdapter needs the Prisma client, not a transaction.',
      );
    });
  });

  it.each(targets)('a namespace the %s contract does not have', async (target) => {
    const client = await databases.open(target, corePsl(target));
    expect(() => prismaAdapter(client, { namespace: 'auth' })).toThrow(
      'Namespace "auth" is not in your Prisma contract.',
    );
  });
});

describe.each(targets)('model lookup on %s', (target) => {
  it('raises the missing-model error for a model the contract lacks', async () => {
    const client = await databases.open(target, corePsl(target));
    const adapter = prismaAdapter(client)({
      plugins: [{ id: 'extra', schema: { extra: { fields: { value: { type: 'string' } } } } }],
    });
    await expect(adapter.findOne({ model: 'extra', where: [] })).rejects.toThrow(
      'Model "extra" is not in your Prisma contract. Run `npx auth@latest generate` to see what to add.',
    );
  });

  it('refuses a model name that is not an identifier', async () => {
    const client = await databases.open(target, corePsl(target));
    const adapter = prismaAdapter(client)({ verification: { modelName: 'verification-token' } });
    await expect(adapter.count({ model: 'verification' })).rejects.toThrow(
      'Better Auth\'s model name "verification-token" is not a valid Prisma model name: use letters, digits and "_", not starting with a digit. Rename the model with Better Auth\'s "modelName" option.',
    );
  });

  it('uses the model with the exact name before the upper-cased one', async () => {
    const psl = `${corePsl(target).replace(
      /model Verification \{[^}]*\}/,
      'model Verification {\n  id String @id\n\n  @@map("upper_verification")\n}',
    )}
model verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime
  updatedAt  DateTime

  @@map("exact_verification")
}
`;
    const adapter = prismaAdapter(await databases.open(target, psl))({});
    const created = await adapter.create({ model: 'verification', data: verification() });
    expect(created).toMatchObject({ value: 'token' });
  });
});

describe('model lookup across Postgres namespaces', () => {
  it('finds the models in the namespace the option names', async () => {
    const client = await databases.open('postgres', corePsl('postgres', 'auth'));
    const adapter = prismaAdapter(client, { namespace: 'auth' })({});
    await adapter.create({ model: 'verification', data: verification() });
    expect(await adapter.count({ model: 'verification' })).toBe(1);
  });

  it('raises the several-namespaces error without the option', async () => {
    const psl = `${corePsl('postgres', 'auth')}
model Verification {
  id String @id

  @@map("verification")
}
`;
    const client = await databases.open('postgres', psl);
    await expect(prismaAdapter(client)({}).count({ model: 'verification' })).rejects.toThrow(
      'Model "Verification" is in more than one namespace of your Prisma contract (auth, public). Set the adapter\'s "namespace" option.',
    );
    const adapter = prismaAdapter(client, { namespace: 'auth' })({});
    await adapter.create({ model: 'verification', data: verification() });
    expect(await adapter.count({ model: 'verification' })).toBe(1);
  });
});
