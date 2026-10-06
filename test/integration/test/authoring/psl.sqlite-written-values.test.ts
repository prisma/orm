import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import type { Contract } from '@internal/contract/types';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import sqlite, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { findStorageColumn } from '../scalar-lists/psl-list-authoring';

/** The backtick fencing a tagged literal, as an escape so no quoted string in this file holds one. */
const BACKTICK = '`';
const json = (body: string): string => `json${BACKTICK}${body}${BACKTICK}`;

const stack = createControlStack({ family: sql, target: sqlite, adapter: sqliteAdapter });

async function author(fields: string, blocks = '') {
  const schemaPath = join(mkdtempSync(join(tmpdir(), 'psl-sqlite-written-')), 'schema.prisma');
  writeFileSync(
    schemaPath,
    `// use prisma-8\n\n${blocks}model Row {\n  id Int @id\n${fields}\n}\n`,
    'utf-8',
  );
  return prismaContract(schemaPath, {
    target: sqlitePackRef,
    createNamespace: sqliteCreateNamespace,
  }).source.load({
    composedExtensions: [],
    composedExtensionContracts: new Map(),
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypeLookup: stack.dataTypeLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [schemaPath],
    capabilities: stack.capabilities,
  });
}

async function storedColumn(field: string) {
  const result = await author(`  value ${field}`);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const column = findStorageColumn(result.value as Contract<SqlStorage>, 'value');
  return {
    dataType: column?.['dataType'],
    codecId: column?.['codecId'],
    default: column?.['default'],
  };
}

async function storedDefault(field: string) {
  const { codecId, default: columnDefault } = await storedColumn(field);
  return { codecId, default: columnDefault };
}

async function diagnostics(field: string) {
  const result = await author(`  value ${field}`);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.failure.diagnostics;
}

describe('written values on SQLite', () => {
  it.each([
    [
      'a json literal on a Json column, as its JSON text with keys sorted',
      `Json @default(${json('{ "b": 1, "a": [true, null] }')})`,
      'sqlite/json@1',
      '{"a":[true,null],"b":1}',
    ],
    [
      'a json literal on a String column, whose value is text',
      `String @default(${json('{"a":1}')})`,
      'sqlite/text@1',
      '{"a":1}',
    ],
    [
      'a whole number on an Int column, as digit text',
      'Int @default(-42)',
      'sqlite/integer@1',
      '-42',
    ],
    [
      'a 64-bit number on a BigInt column, as digit text',
      'BigInt @default(9223372036854775807)',
      'sqlite/bigint@1',
      '9223372036854775807',
    ],
    ['a number with a fraction on a Float column', 'Float @default(1.5)', 'sqlite/real@1', 1.5],
    [
      'a whole number on a Float column, through the cast from integer',
      'Float @default(2)',
      'sqlite/real@1',
      2,
    ],
    [
      'an instant on a DateTime column, as the canonical text its codec declares',
      'DateTime @default("2020-01-02T03:04:05.000Z")',
      'sqlite/datetime@1',
      '2020-01-02T03:04:05Z',
    ],
  ])('stores %s', async (_name, field, codecId, value) => {
    expect(await storedDefault(field)).toEqual({ codecId, default: { kind: 'literal', value } });
  });

  it.each([
    ['Json', 'sqlite/text'],
    ['String', 'sqlite/text'],
    ['DateTime', 'sqlite/text'],
    ['Int', 'sqlite/integer'],
    ['BigInt', 'sqlite/integer'],
    ['Float', 'sqlite/real'],
    ['Bytes', 'sqlite/blob'],
  ])('stores a %s column as %s', async (scalar, dataType) => {
    expect((await storedColumn(`${scalar}?`)).dataType).toBe(dataType);
  });

  it('refuses a plain string on a Json column, because the codec cannot read it as JSON', async () => {
    expect(await diagnostics('Json @default("hello")')).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message: expect.stringContaining('sqlite/json@1 contract value must be the JSON text'),
      }),
    ]);
  });

  it('refuses a number with a fraction on an Int column, which casts from no real', async () => {
    expect(await diagnostics('Int @default(1.5)')).toEqual([
      expect.objectContaining({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message:
          'Field "Row.value": sqlite/integer has no cast from sqlite/real; it casts from nothing',
      }),
    ]);
  });

  it('refuses a whole number past 64 bits, which no SQLite type holds', async () => {
    expect(await diagnostics('BigInt @default(9223372036854775808)')).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_LITERAL',
        message: expect.stringContaining('no data type of this target holds the number'),
      }),
    ]);
  });

  it('refuses a whole number past the safe range on an Int column, which reads a number', async () => {
    expect(await diagnostics('Int @default(9007199254740993)')).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message: expect.stringContaining(
          'sqlite/integer@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
        ),
      }),
    ]);
  });
});

describe('enum members on SQLite', () => {
  it.each(['sqlite/integer@1', 'sql/int@1'])(
    'reads a whole-number member of an enum typed by %s as a written number is read, and stores digit text',
    async (codecId) => {
      const result = await author(
        '  priority Priority @default(High)',
        `enum Priority {\n  @@type("${codecId}")\n  Low = 1\n  High = 2\n}\n\n`,
      );
      if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
      const contract = JSON.parse(JSON.stringify(result.value));
      const namespaceId = Object.keys(contract.domain.namespaces)[0] ?? '';
      expect({
        members: contract.domain.namespaces[namespaceId].enum.Priority.members,
        values: contract.storage.namespaces[namespaceId].entries.valueSet.Priority.values,
        default: findStorageColumn(result.value as Contract<SqlStorage>, 'priority')?.['default'],
      }).toEqual({
        members: [
          { name: 'Low', value: '1' },
          { name: 'High', value: '2' },
        ],
        values: ['1', '2'],
        default: { kind: 'literal', value: '2' },
      });
    },
  );

  async function storedEnumValues(codecId: string, member: string) {
    const result = await author(
      '  priority Priority',
      `enum Priority {\n  @@type("${codecId}")\n  ${member}\n}\n\n`,
    );
    if (!result.ok) {
      return {
        diagnostics: result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
      };
    }
    const { storage } = result.value as Contract<SqlStorage>;
    return {
      values: Object.values(storage.namespaces).flatMap(
        (namespace) => namespace.entries.valueSet?.['Priority']?.values ?? [],
      ),
    };
  }

  it('stores a 64-bit member of a sqlite/bigint@1 enum with every digit', async () => {
    expect(await storedEnumValues('sqlite/bigint@1', 'Low = 9223372036854775807')).toEqual({
      values: ['9223372036854775807'],
    });
  });

  it.each([
    ['sqlite/bigint@1', '"9223372036854775807"', '9223372036854775807'],
    ['sqlite/bigintnumber@1', '"42"', '42'],
  ])(
    'accepts a %s member written as the string %s, read by the codec',
    async (codecId, written, stored) => {
      expect(await storedEnumValues(codecId, `Low = ${written}`)).toEqual({ values: [stored] });
    },
  );

  it.each([
    [`'"low"'`, '"low"'],
    [`'{"b": 2, "a": 1}'`, '{"a":1,"b":2}'],
    ['"1"', '1'],
  ])(
    'accepts a sqlite/json@1 member written as a string of JSON text, %s, and stores the text the upgrade script writes',
    async (written, stored) => {
      expect(await storedEnumValues('sqlite/json@1', `Low = ${written}`)).toEqual({
        values: [stored],
      });
    },
  );

  it('refuses a sqlite/json@1 member written as a number, which no cast takes to text', async () => {
    expect((await storedEnumValues('sqlite/json@1', 'Low = 1')).diagnostics).toContainEqual({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message:
        'enum "Priority" member "Low": sqlite/text has no cast from sqlite/integer; it casts from nothing',
    });
  });
});
