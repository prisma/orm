import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import sqlite, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const sqliteStack = createControlStack({ family: sql, target: sqlite, adapter: sqliteAdapter });

async function loadSqlite(pslSchema: string) {
  const schemaPath = join(mkdtempSync(join(tmpdir(), 'value-object-defaults-')), 'schema.prisma');
  writeFileSync(schemaPath, `// use prisma-8\n\n${pslSchema}`, 'utf-8');
  return prismaContract(schemaPath, {
    target: sqlitePackRef,
    createNamespace: sqliteCreateNamespace,
  }).source.load({
    composedExtensions: [],
    composedExtensionContracts: new Map(),
    authoringContributions: sqliteStack.authoringContributions,
    codecLookup: sqliteStack.codecLookup,
    dataTypeLookup: sqliteStack.dataTypeLookup,
    controlMutationDefaults: sqliteStack.controlMutationDefaults,
    resolvedInputs: [schemaPath],
    capabilities: sqliteStack.capabilities,
  });
}

async function sqliteUserColumns(pslSchema: string) {
  const result = await loadSqlite(pslSchema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const storage = result.value.storage as SqlStorage;
  return Object.values(storage.namespaces)[0]?.entries.table?.['User']?.columns;
}

async function sqliteDiagnostics(pslSchema: string) {
  const result = await loadSqlite(pslSchema);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

describe('value-object defaults on the SQLite stack', () => {
  it('encodes a literal default on a value object and on a list of value objects through the sqlite/json@1 codec of their one column', async () => {
    const columns = await sqliteUserColumns(`type Address {
  street String
}

model User {
  id    Int       @id
  home  Address   @default(json\`{"street":"x"}\`)
  homes Address[] @default(json\`[{"street":"y"}]\`)
}`);

    expect(columns).toEqual({
      id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
      home: {
        nativeType: 'text',
        codecId: 'sqlite/json@1',
        nullable: false,
        default: { kind: 'literal', value: { street: 'x' } },
      },
      homes: {
        nativeType: 'text',
        codecId: 'sqlite/json@1',
        nullable: false,
        default: { kind: 'literal', value: [{ street: 'y' }] },
      },
    });
  });
  it('reads a list literal and a JSON literal as the same default of the one column of a list of value objects', async () => {
    const columns = await sqliteUserColumns(`type Address {
  street String
}

model User {
  id      Int       @id
  emptyA  Address[] @default([])
  emptyB  Address[] @default(json\`[]\`)
  filledA Address[] @default([json\`{"street":"x"}\`])
  filledB Address[] @default(json\`[{"street":"x"}]\`)
}`);

    const jsonWithDefault = (value: unknown) => ({
      nativeType: 'text',
      codecId: 'sqlite/json@1',
      nullable: false,
      default: { kind: 'literal', value },
    });
    expect(columns).toEqual({
      id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
      emptyA: jsonWithDefault([]),
      emptyB: jsonWithDefault([]),
      filledA: jsonWithDefault([{ street: 'x' }]),
      filledB: jsonWithDefault([{ street: 'x' }]),
    });
  });

  it('refuses a default that does not match the composite type', async () => {
    const incompatible = (message: string) => ({ code: 'PSL_DEFAULT_TYPE_INCOMPATIBLE', message });
    expect(
      await sqliteDiagnostics(`type Address {
  street String
  zip    String?
}

type Outer {
  inner Address
}

model User {
  id      Int       @id
  objects Address[] @default(json\`{"street":"x"}\`)
  strings Address[] @default(json\`"x"\`)
  array   Address   @default(json\`[1]\`)
  numbers Address[] @default([json\`1\`])
  unknown Address   @default(json\`{"street":"x","city":"y"}\`)
  missing Address   @default(json\`{"zip":"1"}\`)
  nested  Outer     @default(json\`{"inner":{"street":1}}\`)
}`),
    ).toEqual([
      incompatible(
        'Field "User.objects": the default of a list of value objects is a JSON array, not a JSON object',
      ),
      incompatible(
        'Field "User.strings": the default of a list of value objects is a JSON array, not a JSON string',
      ),
      incompatible(
        'Field "User.array": the default of a value object is a JSON object, not a JSON array',
      ),
      incompatible(
        'Field "User.numbers[0]": a value of "Address" is a JSON object, not a JSON number',
      ),
      incompatible('Field "User.unknown": "city" is not a member of "Address"'),
      incompatible(
        'Field "User.missing.street": the member is required, and the default has no value for it',
      ),
      incompatible(
        'Field "User.nested.inner.street": sqlite/text has no cast from sqlite/integer; it casts from nothing',
      ),
    ]);
  });
});
