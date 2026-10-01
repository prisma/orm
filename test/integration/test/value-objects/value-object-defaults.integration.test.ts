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

const SCHEMA_PREFIX = '// use prisma-8\n\n';

async function loadSqlite(pslSchema: string, schemaPath = newSchemaPath()) {
  writeFileSync(schemaPath, `${SCHEMA_PREFIX}${pslSchema}`, 'utf-8');
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

function newSchemaPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'value-object-defaults-')), 'schema.prisma');
}

/** The span of the `@default(...)` attribute on the line declaring `field`, in the file the schema is written to. */
function defaultSpanOf(pslSchema: string, field: string) {
  const text = `${SCHEMA_PREFIX}${pslSchema}`;
  const lines = text.split('\n');
  const lineIndex = lines.findIndex((line) => new RegExp(`^\\s+${field}\\s`).test(line));
  const line = lines[lineIndex] ?? '';
  const startColumn = line.indexOf('@default(') + 1;
  const endColumn = line.lastIndexOf(')') + 2;
  const lineOffset = lines
    .slice(0, lineIndex)
    .reduce((sum, previous) => sum + previous.length + 1, 0);
  return {
    start: { offset: lineOffset + startColumn - 1, line: lineIndex + 1, column: startColumn },
    end: { offset: lineOffset + endColumn - 1, line: lineIndex + 1, column: endColumn },
  };
}

/** Every diagnostic loading the schema reports, whole, with the path it was written to. */
async function sqliteDiagnosticsOf(pslSchema: string) {
  const schemaPath = newSchemaPath();
  const result = await loadSqlite(pslSchema, schemaPath);
  return { schemaPath, diagnostics: result.ok ? [] : result.failure.diagnostics };
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
      id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false, many: false },
      home: {
        nativeType: 'text',
        codecId: 'sqlite/json@1',
        nullable: false,
        many: false,
        default: { kind: 'literal', value: { street: 'x' } },
      },
      homes: {
        nativeType: 'text',
        codecId: 'sqlite/json@1',
        nullable: false,
        many: false,
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
      many: false,
      default: { kind: 'literal', value },
    });
    expect(columns).toEqual({
      id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false, many: false },
      emptyA: jsonWithDefault([]),
      emptyB: jsonWithDefault([]),
      filledA: jsonWithDefault([{ street: 'x' }]),
      filledB: jsonWithDefault([{ street: 'x' }]),
    });
  });

  it('refuses a default that does not match the composite type', async () => {
    const schema = `type Address {
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
  nested  Outer     @default(json\`{"inner":{"street":"x","city":"y"}}\`)
}`;
    const { schemaPath, diagnostics } = await sqliteDiagnosticsOf(schema);
    const incompatible = (field: string, message: string) => ({
      code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
      message,
      sourceId: schemaPath,
      span: defaultSpanOf(schema, field),
    });
    expect(diagnostics).toEqual([
      incompatible(
        'objects',
        'Field "User.objects": the default of a list of value objects is a JSON array, not a JSON object',
      ),
      incompatible(
        'strings',
        'Field "User.strings": the default of a list of value objects is a JSON array, not a JSON string',
      ),
      incompatible(
        'array',
        'Field "User.array": the default of a value object is a JSON object, not a JSON array',
      ),
      incompatible(
        'numbers',
        'Field "User.numbers[0]": a value of "Address" is a JSON object, not a JSON number',
      ),
      incompatible('unknown', 'Field "User.unknown": "city" is not a member of "Address"'),
      incompatible(
        'missing',
        'Field "User.missing.street": the member is required, and the default has no value for it',
      ),
      incompatible('nested', 'Field "User.nested.inner": "city" is not a member of "Address"'),
    ]);
  });

  it('reads each member value the way its codec does: a decimal string for Decimal and BigInt, and any JSON value for Json', async () => {
    const schema = (value: string) => `type Amounts {
  price   Decimal
  big     BigInt
  payload Json
}

model User {
  id Int     @id
  a  Amounts @default(json\`${value}\`)
}`;
    const accepted = await Promise.all(
      ['"x"', '1', 'true', '{}', '[1]', 'null'].map(
        async (payload) =>
          (await sqliteDiagnosticsOf(schema(`{"price": "1.5", "big": "1", "payload": ${payload}}`)))
            .diagnostics,
      ),
    );
    const refusedSchema = schema('{"price": 1.5, "big": 1, "payload": {}}');
    const refused = await sqliteDiagnosticsOf(refusedSchema);
    const invalidLiteral = (message: string) => ({
      code: 'PSL_INVALID_DEFAULT_LITERAL',
      message,
      sourceId: refused.schemaPath,
      span: defaultSpanOf(refusedSchema, 'a'),
    });
    expect({ accepted, refused: refused.diagnostics }).toEqual({
      accepted: [[], [], [], [], [], []],
      refused: [
        invalidLiteral('Field "User.a.price": sqlite/text@1 JSON value must be a string'),
        invalidLiteral(
          'Field "User.a.big": sqlite/bigint@1 JSON value must be a decimal integer string from -9223372036854775808 to 9223372036854775807',
        ),
      ],
    });
  });

  it('takes JSON null as the default of an optional value object', async () => {
    expect(
      await sqliteUserColumns(`type Address {
  street String
}

model User {
  id   Int      @id
  home Address? @default(json\`null\`)
}`),
    ).toEqual({
      id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false, many: false },
      home: {
        nativeType: 'text',
        codecId: 'sqlite/json@1',
        nullable: true,
        many: false,
        default: { kind: 'literal', value: null },
      },
    });
  });

  it('refuses a member value the member codec does not read, with the codec message', async () => {
    const schema = `type Address {
  street String
}

model User {
  id   Int     @id
  home Address @default(json\`{"street": 1}\`)
}`;
    const { schemaPath, diagnostics } = await sqliteDiagnosticsOf(schema);
    expect(diagnostics).toEqual([
      {
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message: 'Field "User.home.street": sqlite/text@1 JSON value must be a string',
        sourceId: schemaPath,
        span: defaultSpanOf(schema, 'home'),
      },
    ]);
  });
});
