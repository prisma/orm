import type { BetterAuthOptions } from '@better-auth/core';
import { getAuthTables } from '@better-auth/core/db';
import { describe, expect, it } from 'vitest';
import { compareContract } from '../../src/contract/compare';
import { useContractFixture } from '../helpers/contract-fixture';
import { type TargetName, targets } from '../helpers/databases';
import { compare, problemsOf, pslForConfiguration } from '../helpers/printed-psl';

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
      expect(problemsOf(compare(contract, {}, { usePlural: true }))).toEqual([]);
      expect(problemsOf(compare(contract, {}))).toEqual([
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
      expect(problemsOf(compare(contract, options))).toEqual([]);
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
        problemsOf(
          compareContract({
            contract,
            tables,
            betterAuthOptions,
            namespace: undefined,
            usePlural: false,
          }),
        );

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
      expect(problemsOf(compare(contract, options))).toEqual([]);
    });
  });

  describe('the problems it reports', () => {
    it('a name that is not an identifier, as the only problem', async () => {
      const contract = await contractOf(target, editedPsl(target, {}));
      expect(problemsOf(compare(contract, { user: { fields: { email: 'e-mail' } } }))).toEqual([
        { kind: 'invalid-name', model: 'user', field: 'e-mail' },
      ]);
    });

    it('a missing field and a missing id', async () => {
      const contract = await contractOf(
        target,
        editedPsl(target, {}, [
          [/\n {2}image +String\?/, ''],
          [/(model Verification \{\n {2})id(\s+String\s+@id)/, '$1uid$2'],
        ]),
      );
      expect(problemsOf(compare(contract, {}))).toEqual([
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
      expect(problemsOf(compare(contract, {}))).toEqual([
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
      expect(problemsOf(compare(withoutDefault, serial))).toEqual([
        { kind: 'id-without-default', model: 'User' },
      ]);

      const databaseIds: BetterAuthOptions = { advanced: { database: { generateId: false } } };
      const withoutGenerator = await contractOf(
        target,
        editedPsl(target, databaseIds, [
          [/(model User \{\n\s+id\s+String\s+@id) @onCreate\(uuid\(\)\)/, '$1'],
        ]),
      );
      expect(problemsOf(compare(withoutGenerator, databaseIds))).toEqual([
        { kind: 'id-without-default', model: 'User' },
      ]);
      expect(problemsOf(compare(withoutGenerator, {}))).toEqual([]);
    });

    describe('an optional Better Auth field the contract makes required', () => {
      async function imageProblems(image: string, options: BetterAuthOptions = {}) {
        const contract = await contractOf(
          target,
          editedPsl(target, options, [[/image(\s+)String\?/, `image$1${image}`]]),
        );
        return problemsOf(compare(contract, options));
      }
      const notNullable = [
        {
          kind: 'optional-field-not-nullable',
          model: 'User',
          field: 'image',
          expectedType: 'String',
        },
      ];

      it('is reported', async () => {
        expect(await imageProblems('String')).toEqual(notNullable);
      });

      it('is reported when it has a database default, since Better Auth writes null to it', async () => {
        expect(await imageProblems('String @default("")')).toEqual(notNullable);
      });

      it('is not reported when it is optional, with or without a default', async () => {
        expect(await imageProblems('String? @default("")')).toEqual([]);
      });

      it('is not reported when Better Auth gives it a default value', async () => {
        const options: BetterAuthOptions = {
          user: {
            additionalFields: { image: { type: 'string', required: false, defaultValue: '' } },
          },
        };
        expect(await imageProblems('String', options)).toEqual([]);
      });
    });

    describe('a required field Better Auth never writes', () => {
      async function problemsWith(extraField: string) {
        const contract = await contractOf(
          target,
          editedPsl(target, {}, [[/(model User \{\n)/, `$1  ${extraField}\n`]]),
        );
        return problemsOf(compare(contract, {}));
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
    expect(problemsOf(compare(contract, {}, { namespace: 'auth' }))).toEqual([]);
    expect(problemsOf(compare(contract, {}, { namespace: 'public' }))).toEqual([
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
    expect(problemsOf(compare(contract, {}))).toEqual([
      {
        kind: 'ambiguous-model',
        model: 'User',
        namespaceIds: ['auth', 'public'],
      },
    ]);
  });
});
