import { readdir } from 'node:fs/promises';
import type { BetterAuthOptions } from '@better-auth/core';
import { schemaCheckFor } from '@better-auth/core/db/internal';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractMessage } from '../../src/contract/message';
import { prismaAdapter } from '../../src/exports/index';
import { type AdapterDatabases, createAdapterDatabases } from '../helpers/adapter-databases';
import { targets } from '../helpers/databases';
import { compare, pslForConfiguration } from '../helpers/printed-psl';
import { timeouts } from '../timeouts';

let databases: AdapterDatabases;

beforeAll(async () => {
  databases = await createAdapterDatabases();
}, timeouts.devServerStart);

afterAll(() => databases?.dispose(), timeouts.devServerClose + timeouts.hook);

const unusedPlugin = {
  id: 'unused',
  schema: { unused: { fields: { value: { type: 'string' as const } } } },
};

const signUp = {
  body: { email: 'ada@example.com', password: 'a-long-password', name: 'Ada' },
};

const mismatch = (message: string | undefined) =>
  expect.objectContaining({ name: 'BetterAuthError', code: 'SCHEMA_MISMATCH', message });

describe.each(targets)('the contract check on %s', (target) => {
  const corePsl = () => pslForConfiguration(databases.emptyContract(target), {});

  async function authOver(psl: string, options: Omit<BetterAuthOptions, 'database'>) {
    const client = await databases.open(target, psl);
    const auth = betterAuth({
      ...options,
      database: prismaAdapter(client),
      emailAndPassword: { enabled: true },
      secret: 'a-test-secret-that-is-long-enough-for-better-auth',
      baseURL: 'http://localhost:3000',
    });
    return { auth, client };
  }

  it('rejects the first API call when the contract lacks what Better Auth needs', async () => {
    const options = { plugins: [unusedPlugin] };
    const { auth, client } = await authOver(corePsl(), options);
    const expected = contractMessage(compare(client.contract, options));
    expect(expected).toContain('model Unused {');
    await expect(auth.api.signUpEmail(signUp)).rejects.toThrow(mismatch(expected));
  });

  it('lets calls through when the contract is complete', async () => {
    const options = { plugins: [twoFactor()] };
    const psl = pslForConfiguration(databases.emptyContract(target), options);
    const { auth } = await authOver(psl, options);
    await expect(auth.api.signUpEmail(signUp)).resolves.toMatchObject({
      user: { email: 'ada@example.com' },
    });
  });

  it('is skipped with validateSchema: false', async () => {
    const { auth } = await authOver(corePsl(), {
      plugins: [unusedPlugin],
      advanced: { database: { validateSchema: false } },
    });
    await expect(auth.api.signUpEmail(signUp)).resolves.toMatchObject({
      user: { email: 'ada@example.com' },
    });
  });

  it('runs once and rejects with the same error on every later call', async () => {
    const options = { plugins: [unusedPlugin] };
    const { auth } = await authOver(corePsl(), options);
    const context = await auth.$context;
    const check = context.explicitSchemaCheck;
    if (check === undefined) throw new Error('No check registered');
    const first = await Promise.resolve(check()).catch((error: unknown) => error);
    const second = await Promise.resolve(check()).catch((error: unknown) => error);
    expect(first).toBeInstanceOf(Error);
    expect(second).toBe(first);
  });

  it('returns nothing after a clean first run, and is not registered inside a transaction', async () => {
    const client = await databases.open(target, corePsl());
    const adapter = prismaAdapter(client, { transaction: true })({});
    const check = schemaCheckFor(adapter);
    if (check === undefined) throw new Error('No check registered');
    await check();
    expect(check()).toBeUndefined();
    await adapter.transaction(async (trx) => {
      expect(schemaCheckFor(trx)).toBeUndefined();
    });
  });
});

describe.each(targets)('createSchema on %s', (target) => {
  it('returns no code and the contract path when the contract is complete', async () => {
    const client = await databases.open(
      target,
      pslForConfiguration(databases.emptyContract(target), {}),
    );
    const adapter = prismaAdapter(client)({});
    expect(await adapter.createSchema?.({})).toEqual({ code: '', path: 'prisma/contract.prisma' });
    expect(await adapter.createSchema?.({}, 'schema/auth.prisma')).toEqual({
      code: '',
      path: 'schema/auth.prisma',
    });
  });

  it('throws the message with its code when the contract is incomplete, and writes nothing', async () => {
    const options = { plugins: [twoFactor()] };
    const client = await databases.open(
      target,
      pslForConfiguration(databases.emptyContract(target), {}),
    );
    const before = await readdir(process.cwd());
    const adapter = prismaAdapter(client)(options);
    await expect(adapter.createSchema?.(options)).rejects.toThrow(
      mismatch(contractMessage(compare(client.contract, options))),
    );
    expect(await readdir(process.cwd())).toEqual(before);
    expect(before).not.toContain('prisma');
  });

  it('leaves out the session table when sessions live in secondary storage', async () => {
    const psl = pslForConfiguration(databases.emptyContract(target), {})
      .replace(/model Session \{[^}]*\}/, '')
      .replace(/\n.*Session\[\]/, '');
    const client = await databases.open(target, psl);
    const options: BetterAuthOptions = {
      secondaryStorage: {
        get: () => null,
        set: () => undefined,
        delete: () => undefined,
        getAndDelete: () => null,
        increment: () => 1,
      },
    };
    expect(await prismaAdapter(client)(options).createSchema?.(options)).toEqual({
      code: '',
      path: 'prisma/contract.prisma',
    });
  });
});

describe.each(targets)('a Better Auth name that is not an identifier on %s', (target) => {
  const invalidName =
    'Better Auth\'s model name "verification-token" is not a valid Prisma model name: use letters, digits and "_", not starting with a digit. Rename the model with Better Auth\'s "modelName" option.';
  const options: BetterAuthOptions = { verification: { modelName: 'verification-token' } };

  it('makes the check and createSchema fail with the mismatch code', async () => {
    const client = await databases.open(
      target,
      pslForConfiguration(databases.emptyContract(target), {}),
    );
    const adapter = prismaAdapter(client)(options);
    const check = schemaCheckFor(adapter);
    if (check === undefined) throw new Error('No check registered');
    await expect(Promise.resolve(check())).rejects.toThrow(mismatch(invalidName));
    await expect(adapter.createSchema?.(options)).rejects.toThrow(mismatch(invalidName));
  });
});
