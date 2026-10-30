import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { charColumn, varcharColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { defineContract, field, gen, model } from '@internal/postgres/contract-builder';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import sqlite from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const postgresStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
});
const sqliteStack = createControlStack({ family: sql, target: sqlite, adapter: sqliteAdapter });

async function author(
  target: 'postgres' | 'sqlite',
  field: string,
  blocks = '',
): Promise<
  | { readonly ok: true; readonly onCreate: unknown }
  | { readonly ok: false; readonly diagnostics: readonly { code: string; message: string }[] }
> {
  const stack = target === 'postgres' ? postgresStack : sqliteStack;
  const folder = mkdtempSync(join(tmpdir(), 'psl-generator-length-'));
  folders.push(folder);
  const schemaPath = join(folder, 'schema.prisma');
  writeFileSync(
    schemaPath,
    `// use prisma-8\n\n${blocks}model Row {\n  id Int @id\n  value ${field}\n}\n`,
    'utf-8',
  );
  const result = await prismaContract(
    schemaPath,
    target === 'postgres'
      ? { target: postgresPackRef, createNamespace: postgresCreateNamespace }
      : { target: sqlitePackRef, createNamespace: sqliteCreateNamespace },
  ).source.load({
    composedExtensions: [],
    defaultNamespaceId: stack.target.defaultNamespaceId,
    composedExtensionContracts: new Map(),
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypes: stack.dataTypes,
    controlMutationDefaults: stack.controlMutationDefaults,
    generatorFunctions: stack.generatorFunctions,
    resolvedInputs: [schemaPath],
    capabilities: stack.capabilities,
  });
  return result.ok
    ? { ok: true, onCreate: result.value.execution?.mutations.defaults[0]?.onCreate }
    : {
        ok: false,
        diagnostics: result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
      };
}

describe('a generator on a Postgres column with a length', () => {
  it.each([
    ['VarChar(5) @onCreate(uuid())', '', 'uuid()', 36, '5 characters'],
    [
      'Short @onCreate(cuid(2))',
      'types {\n  Short = VarChar(3)\n}\n\n',
      'cuid(2)',
      24,
      '3 characters',
    ],
    ['Char(5) @onCreate(nanoid())', '', 'nanoid()', 21, '5 characters'],
    ['Char(10) @onCreate(nanoid(20))', '', 'nanoid(20)', 20, '10 characters'],
    ['Char @onCreate(uuid(7))', '', 'uuid(7)', 36, '1 character'],
    ['Char(25) @onCreate(ulid())', '', 'ulid()', 26, '25 characters'],
    ['VarChar(26) @onCreate(ksuid())', '', 'ksuid()', 27, '26 characters'],
  ])(
    'refuses %s, which is too short for what the generator writes',
    async (field, blocks, call, written, held) => {
      expect(await author('postgres', field, blocks)).toEqual({
        ok: false,
        diagnostics: [
          {
            code: 'PSL_GENERATOR_NOT_APPLICABLE',
            message: `Field "Row.value": ${call} writes ${written} characters, which does not fit a column of ${held}.`,
          },
        ],
      });
    },
  );

  it.each([
    ['VarChar(36) @onCreate(uuid())', { kind: 'generator', id: 'uuidv4' }],
    ['Char(36) @onCreate(uuid(7))', { kind: 'generator', id: 'uuidv7' }],
    ['Char(21) @onCreate(nanoid())', { kind: 'generator', id: 'nanoid' }],
    ['Char(26) @onCreate(ulid())', { kind: 'generator', id: 'ulid' }],
    ['VarChar @onCreate(uuid())', { kind: 'generator', id: 'uuidv4' }],
    ['String @onCreate(ksuid())', { kind: 'generator', id: 'ksuid' }],
  ])('takes %s', async (field, onCreate) => {
    expect(await author('postgres', field)).toEqual({ ok: true, onCreate });
  });
});

describe('a generator on a SQLite column with a length', () => {
  it.each(['sql.String(5) @onCreate(uuid())', 'sql.String(3) @onCreate(nanoid())'])(
    'takes %s, as SQLite does not limit the length',
    async (field) => {
      expect(await author('sqlite', field)).toMatchObject({ ok: true });
    },
  );
});

describe('a generator call in a TypeScript contract on a Postgres column with a length', () => {
  function build(value: ReturnType<typeof field.column>) {
    return () =>
      defineContract({
        models: {
          Row: model('Row', { fields: { id: field.column(varcharColumn(36)).id(), value } }),
        },
      });
  }

  it('refuses a column too short for what the generator writes', () => {
    expect(build(field.column(charColumn(5)).onCreate(gen.uuid()))).toThrow(
      'Field "Row.value": uuid() writes 36 characters, which does not fit a column of 5 characters.',
    );
  });

  it('takes a column long enough', () => {
    expect(build(field.column(varcharColumn(26)).onCreate(gen.ulid()))).not.toThrow();
  });
});
