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

async function sqliteUserColumns(pslSchema: string) {
  const schemaPath = join(mkdtempSync(join(tmpdir(), 'value-object-defaults-')), 'schema.prisma');
  writeFileSync(schemaPath, `// use prisma-8\n\n${pslSchema}`, 'utf-8');
  const result = await prismaContract(schemaPath, {
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
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const storage = result.value.storage as SqlStorage;
  return Object.values(storage.namespaces)[0]?.entries.table?.['User']?.columns;
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
});
