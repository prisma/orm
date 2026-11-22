import type { BetterAuthOptions } from '@better-auth/core';
import { getAuthTables } from '@better-auth/core/db';
import { describe, expect, it } from 'vitest';
import { compareContract } from '../../src/contract/compare';
import { useContractFixture } from '../helpers/contract-fixture';
import { type TargetName, targets } from '../helpers/databases';
import { compare, pslForConfiguration } from '../helpers/printed-psl';

const fixture = useContractFixture();
const emptyContract = (target: TargetName) => fixture().emptyContract(target);

/** The printed PSL for a configuration, with each `[from, to]` replacement applied. */
function editedPsl(
  target: TargetName,
  options: BetterAuthOptions,
  replacements: readonly (readonly [RegExp | string, string])[] = [],
): string {
  return replacements.reduce(
    (psl, [from, to]) => {
      const next = psl.replace(from, to);
      if (next === psl) throw new Error(`The PSL has no ${String(from)}`);
      return next;
    },
    pslForConfiguration(emptyContract(target), options),
  );
}

const contractOf = (target: TargetName, psl: string) => fixture().contractOf(target, psl);

describe.each(targets)('the comparison on %s', (target) => {
  describe('which models it expects', () => {
    it('appends s to every model name with usePlural', async () => {
      const contract = await contractOf(
        target,
        pslForConfiguration(emptyContract(target), {}, { usePlural: true }),
      );
      expect(compare(contract, {}, { usePlural: true }).problems).toEqual([]);
      expect(compare(contract, {}).problems).toEqual([
        { kind: 'missing-model', model: 'user' },
        { kind: 'missing-model', model: 'session' },
        { kind: 'missing-model', model: 'account' },
        { kind: 'missing-model', model: 'verification' },
      ]);
    });

    it('leaves out a table with disableMigrations', async () => {
      const contract = await contractOf(target, editedPsl(target, {}));
      const options: BetterAuthOptions = {
        plugins: [
          {
            id: 'legacy',
            schema: { legacy: { fields: { value: { type: 'string' } }, disableMigration: true } },
          },
        ],
      };
      expect(getAuthTables(options)['legacy']).toBeDefined();
      expect(compare(contract, options).problems).toEqual([]);
    });

    it('leaves out the session table when sessions live in secondary storage', async () => {
      const contract = await contractOf(
        target,
        editedPsl(target, {}, [[/model Session \{[^}]*\}/, '']]).replace(/\n.*Session\[\]/, ''),
      );
      const secondaryStorage = {
        get: () => null,
        set: () => undefined,
        delete: () => undefined,
        getAndDelete: () => null,
        increment: () => 1,
      };
      const tables = getAuthTables({});
      const compareWith = (betterAuthOptions: BetterAuthOptions) =>
        compareContract({
          contract,
          tables,
          betterAuthOptions,
          namespace: undefined,
          usePlural: false,
        }).problems;

      expect(tables['session']).toBeDefined();
      expect(compareWith({ secondaryStorage })).toEqual([]);
      expect(compareWith({})).toEqual([{ kind: 'missing-model', model: 'session' }]);
      expect(compareWith({ secondaryStorage, session: { storeSessionInDatabase: true } })).toEqual([
        { kind: 'missing-model', model: 'session' },
      ]);
    });

    it('merges tables that share a model name', async () => {
      const contract = await contractOf(
        target,
        editedPsl(target, {}, [[/(model User \{\n)/, '$1  nickname String?\n']]),
      );
      const options: BetterAuthOptions = {
        plugins: [
          {
            id: 'profile',
            schema: {
              profile: {
                modelName: 'user',
                fields: { nickname: { type: 'string', required: false } },
              },
            },
          },
        ],
      };
      expect(compare(contract, options).problems).toEqual([]);
    });
  });

  describe('the problems it reports', () => {
    it('a missing field and a missing id', async () => {
      const contract = await contractOf(
        target,
        editedPsl(target, {}, [
          [/\n {2}image +String\?/, ''],
          [/(model Verification \{\n {2})id(\s+String\s+@id)/, '$1uid$2'],
        ]),
      );
      expect(compare(contract, {}).problems).toEqual([
        { kind: 'missing-field', model: 'User', field: 'image' },
        { kind: 'missing-field', model: 'Verification', field: 'id' },
        { kind: 'required-field-not-written', model: 'Verification', field: 'uid' },
      ]);
    });

    it('a field of the wrong type', async () => {
      const contract = await contractOf(
        target,
        editedPsl(target, {}, [[/emailVerified Boolean/, 'emailVerified String ']]),
      );
      expect(compare(contract, {}).problems).toEqual([
        {
          kind: 'wrong-type',
          model: 'User',
          field: 'emailVerified',
          expectedType: 'Boolean',
          found: target === 'sqlite' ? 'sqlite/text@1' : 'pg/text@1',
        },
      ]);
    });

    it('an id without a default when Better Auth sends no id', async () => {
      const serial: BetterAuthOptions = { advanced: { database: { generateId: 'serial' } } };
      const withoutDefault = await contractOf(
        target,
        editedPsl(target, serial, [
          [/(model User \{\n\s+id\s+Int\s+@id) @default\(autoincrement\(\)\)/, '$1'],
        ]),
      );
      expect(compare(withoutDefault, serial).problems).toEqual([
        { kind: 'id-without-default', model: 'User' },
      ]);

      const databaseIds: BetterAuthOptions = { advanced: { database: { generateId: false } } };
      const withoutGenerator = await contractOf(
        target,
        editedPsl(target, databaseIds, [
          [/(model User \{\n\s+id\s+String\s+@id) @onCreate\(uuid\(\)\)/, '$1'],
        ]),
      );
      expect(compare(withoutGenerator, databaseIds).problems).toEqual([
        { kind: 'id-without-default', model: 'User' },
      ]);
      expect(compare(withoutGenerator, {}).problems).toEqual([]);
    });

    describe('a required field Better Auth never writes', () => {
      async function problemsWith(extraField: string) {
        const contract = await contractOf(
          target,
          editedPsl(target, {}, [[/(model User \{\n)/, `$1  ${extraField}\n`]]),
        );
        return compare(contract, {}).problems;
      }

      it('is reported', async () => {
        expect(await problemsWith('nickname String')).toEqual([
          { kind: 'required-field-not-written', model: 'User', field: 'nickname' },
        ]);
      });

      it('is not reported when it is optional', async () => {
        expect(await problemsWith('nickname String?')).toEqual([]);
      });

      it('is not reported when it has a database default', async () => {
        expect(await problemsWith('nickname String @default("anonymous")')).toEqual([]);
      });

      it('is not reported when a generator fills it on create', async () => {
        expect(await problemsWith('seenAt DateTime @onCreate(now())')).toEqual([]);
      });

      it('is reported when a generator fills it only on update', async () => {
        expect(await problemsWith('seenAt DateTime @onUpdate(now())')).toEqual([
          { kind: 'required-field-not-written', model: 'User', field: 'seenAt' },
        ]);
      });
    });
  });
});

describe('the comparison on postgres namespaces', () => {
  const postgres = () => emptyContract('postgres');

  it('searches only the namespace the option names, and ignores the others', async () => {
    const authModels = pslForConfiguration(postgres(), {}, { namespace: 'auth' });
    const contract = await contractOf(
      'postgres',
      `${authModels}\nmodel User {\n  id       String @id\n  nickname String\n}\n`,
    );
    expect(compare(contract, {}, { namespace: 'auth' }).problems).toEqual([]);
    expect(compare(contract, {}, { namespace: 'public' }).problems).toEqual([
      { kind: 'missing-field', model: 'User', field: 'name' },
      { kind: 'missing-field', model: 'User', field: 'email' },
      { kind: 'missing-field', model: 'User', field: 'emailVerified' },
      { kind: 'missing-field', model: 'User', field: 'image' },
      { kind: 'missing-field', model: 'User', field: 'createdAt' },
      { kind: 'missing-field', model: 'User', field: 'updatedAt' },
      { kind: 'required-field-not-written', model: 'User', field: 'nickname' },
      { kind: 'missing-model', model: 'session' },
      { kind: 'missing-model', model: 'account' },
      { kind: 'missing-model', model: 'verification' },
    ]);
  });

  it('reports a model in more than one namespace', async () => {
    const authModels = pslForConfiguration(postgres(), {}, { namespace: 'auth' });
    const contract = await contractOf(
      'postgres',
      `${authModels}\nmodel User {\n  id String @id\n}\n`,
    );
    expect(compare(contract, {}).problems).toEqual([
      {
        kind: 'ambiguous-model',
        message:
          'Model "User" is in more than one namespace of your Prisma contract (auth, public). Set the adapter\'s "namespace" option.',
      },
    ]);
  });
});
