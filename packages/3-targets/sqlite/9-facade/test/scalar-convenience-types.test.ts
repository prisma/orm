import sqliteAdapter from '@internal/adapter-sqlite/control';
import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import sqlite from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const stack = createControlStack({
  family: sql,
  target: sqlite,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});

function interpret(schema: string) {
  const warnings: ContractSourceDiagnostic[] = [];
  const bound = bindPslSchema(schema, {
    sourceId: 'scalar-convenience-types.test.psl',
    context: contractSourceContextFromControlStack(stack, {
      reportWarning: (diagnostic: ContractSourceDiagnostic) => {
        warnings.push(diagnostic);
      },
    }),
  });
  const result = withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: sqlitePackRef,
      createNamespace: sqliteCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
  return { result, warnings };
}

function emit(schema: string) {
  const { result, warnings } = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure));
  return { contract: result.value, json: JSON.stringify(result.value), warnings };
}

const model = (...fields: readonly string[]) =>
  [
    'model Event {',
    '  id Int @id',
    ...fields.map((f) => `  ${f}`),
    '',
    '  @@map("event")',
    '}',
    '',
  ].join('\n');

const withColumns = (
  columns: Readonly<Record<string, { readonly codecId: string; readonly default?: unknown }>>,
) => ({
  storage: { namespaces: { __unbound__: { entries: { table: { event: { columns } } } } } },
});

const rows = [
  ['Int', 'IntegerNumber', 'sqlite/integer@1'],
  ['Int(storage: integer)', 'IntegerNumber', 'sqlite/integer@1'],
  ['BigInt', 'IntegerBigInt', 'sqlite/bigint@1'],
  ['BigInt(as: bigint, storage: integer)', 'IntegerBigInt', 'sqlite/bigint@1'],
  ['BigInt(as: number)', 'IntegerNumber', 'sqlite/integer@1'],
  ['Float', 'Real', 'sqlite/real@1'],
  ['Float(storage: real)', 'Real', 'sqlite/real@1'],
  ['Decimal', 'DecimalString', 'sqlite/decimal@1'],
  ['Decimal(storage: text)', 'DecimalString', 'sqlite/decimal@1'],
  ['String', 'Text', 'sqlite/text@1'],
  ['String(storage: text)', 'Text', 'sqlite/text@1'],
  ['Boolean', 'IntegerBoolean', 'sqlite/boolean@1'],
  ['Boolean(storage: integer)', 'IntegerBoolean', 'sqlite/boolean@1'],
  ['Bytes', 'Blob', 'sqlite/blob@1'],
  ['Bytes(storage: blob)', 'Blob', 'sqlite/blob@1'],
  ['Json', 'PlainJson', 'sqlite/json@1'],
  ['Json(storage: text)', 'PlainJson', 'sqlite/json@1'],
] as const;

describe('the SQLite scalar convenience types in PSL', () => {
  it.each(rows)('%s resolves to %s, codec %s', (written, explicit, codecId) => {
    const convenience = emit(model(`value ${written}`));
    const direct = emit(model(`value ${explicit}`));

    expect(convenience.contract).toMatchObject(withColumns({ value: { codecId } }));
    expect(convenience.json).toBe(direct.json);
    expect({ convenience: convenience.warnings, direct: direct.warnings }).toEqual({
      convenience: [],
      direct: [],
    });
  });

  it('emits the same contract.json for a schema written with the convenience types and one written with the explicit types, in every place a type is written', () => {
    const schema = (names: Readonly<Record<string, string>>) => `types {
  Count = ${names['Int']}
  Label = ${names['String']}
}

model Event {
  id      ${names['Int']} @id @default(autoincrement())
  total   ${names['BigInt']} @default(0)
  rank    ${names['BigIntNumber']}?
  ratio   ${names['Float']} @default(1.5)
  price   ${names['Decimal']} @default("12.50")
  fee     ${names['Decimal']}? @default(3)
  name    ${names['String']} @unique @default("x")
  active  ${names['Boolean']} @default(true)
  hidden  ${names['Boolean']}?
  avatar  ${names['Bytes']}?
  payload ${names['Json']}?
  count   Count
  label   Label?
  ownerId ${names['Int']}
  owner   Owner @relation(fields: [ownerId], references: [id])

  @@index([total, name])
  @@map("event")
}

model Owner {
  id     ${names['String']} @id
  events Event[]
}
`;
    const convenience = emit(
      schema({
        Int: 'Int',
        BigInt: 'BigInt',
        BigIntNumber: 'BigInt(as: number)',
        Float: 'Float',
        Decimal: 'Decimal',
        String: 'String',
        Boolean: 'Boolean',
        Bytes: 'Bytes',
        Json: 'Json',
      }),
    );
    const explicit = emit(
      schema({
        Int: 'IntegerNumber',
        BigInt: 'IntegerBigInt',
        BigIntNumber: 'IntegerNumber',
        Float: 'Real',
        Decimal: 'DecimalString',
        String: 'Text',
        Boolean: 'IntegerBoolean',
        Bytes: 'Blob',
        Json: 'PlainJson',
      }),
    );

    expect(convenience.json).toBe(explicit.json);
    expect({ convenience: convenience.warnings, explicit: explicit.warnings }).toEqual({
      convenience: [],
      explicit: [],
    });
  });

  it.each([
    ['Int(storage: text)', 'Argument \\"storage\\" of Int is text; write one of: integer.'],
    ['BigInt(as: string)', 'Argument \\"as\\" of BigInt is string; write one of: bigint, number.'],
    ['Json(storage: jsonb)', 'Argument \\"storage\\" of Json is jsonb; write one of: text.'],
    ['Boolean(storage: text)', 'Argument \\"storage\\" of Boolean is text; write one of: integer.'],
  ])('refuses %s at its argument, naming the accepted choices', (written, message) => {
    const { result } = interpret(model(`value ${written}`));
    expect(result.ok ? '' : JSON.stringify(result.failure)).toContain(message);
  });

  it('gives Decimal its own codec, sqlite/decimal@1, on a text column', () => {
    const { contract, warnings } = emit(model('price Decimal'));
    expect(warnings).toEqual([]);
    expect(contract).toMatchObject(withColumns({ price: { codecId: 'sqlite/decimal@1' } }));
  });

  it('stores a Decimal default written as text or a whole number in the form the codec writes', () => {
    const { contract } = emit(
      model('price Decimal @default("012.50")', 'fee Decimal @default(-3)'),
    );
    expect(contract).toMatchObject(
      withColumns({
        price: { codecId: 'sqlite/decimal@1', default: { kind: 'literal', value: '12.50' } },
        fee: { codecId: 'sqlite/decimal@1', default: { kind: 'literal', value: '-3' } },
      }),
    );
  });

  it('refuses a Decimal default that is not decimal text', () => {
    const { result } = interpret(model('price Decimal @default("twelve")'));
    expect(result.ok ? '' : JSON.stringify(result.failure)).toContain(
      'sqlite/decimal cannot read \\"twelve\\". Write decimal text, as in \\"12.50\\".',
    );
  });

  it('gives Boolean its own codec, sqlite/boolean@1, on an integer column, and stores a default as a boolean', () => {
    const { contract, warnings } = emit(
      model('active Boolean @default(true)', 'hidden Boolean @default(false)', 'flag Boolean?'),
    );
    expect(warnings).toEqual([]);
    expect(contract).toMatchObject(
      withColumns({
        active: {
          codecId: 'sqlite/boolean@1',
          dataType: 'sqlite/boolean',
          default: { kind: 'literal', value: true },
        },
        hidden: { codecId: 'sqlite/boolean@1', default: { kind: 'literal', value: false } },
        flag: { codecId: 'sqlite/boolean@1', nullable: true },
      }),
    );
  });

  it.each(['1', '"true"'])(
    'refuses the Boolean default %s, which is not true or false',
    (written) => {
      const { result } = interpret(model(`active Boolean @default(${written})`));
      expect(result.ok).toBe(false);
    },
  );

  it('warns that BigIntNumber is deprecated, and emits the contract IntegerNumber emits', () => {
    const deprecated = emit(
      `types {\n  Bounded = BigIntNumber\n}\n\n${model('bounded BigIntNumber', 'aliased Bounded')}`,
    );
    const replacement = emit(
      `types {\n  Bounded = IntegerNumber\n}\n\n${model('bounded IntegerNumber', 'aliased Bounded')}`,
    );
    expect(deprecated.json).toBe(replacement.json);
    expect(deprecated.contract).toMatchObject(
      withColumns({ bounded: { codecId: 'sqlite/integer@1' } }),
    );
    expect(deprecated.warnings.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_DEPRECATED_SCALAR_NAME',
        message:
          'Scalar type "BigIntNumber" is deprecated and will be removed; use "IntegerNumber".',
      },
      {
        code: 'PSL_DEPRECATED_SCALAR_NAME',
        message:
          'Scalar type "BigIntNumber" is deprecated and will be removed; use "IntegerNumber".',
      },
    ]);
  });
});

describe('the SQLite scalar convenience types in a TypeScript contract', () => {
  it('emit the contract their explicit types emit', () => {
    const convenience = defineContract({}, ({ type, field, model: m }) => ({
      models: {
        Event: m('Event', {
          fields: {
            id: field.column(type.Int()).id(),
            stored: field.column(type.Int({ storage: 'integer' })),
            total: field.column(type.BigInt()),
            rank: field.column(type.BigInt({ as: 'number' })),
            ratio: field.column(type.Float()),
            price: field.column(type.Decimal()),
            storedPrice: field.column(type.Decimal({ storage: 'text' })),
            name: field.column(type.String()),
            active: field.column(type.Boolean()).default(true),
            storedActive: field.column(type.Boolean({ storage: 'integer' })),
            avatar: field.column(type.Bytes()),
            payload: field.column(type.Json()),
            document: field.column(type.Json({ storage: 'text' })),
          },
        }).sql({ table: 'event' }),
      },
    }));
    const explicit = defineContract({}, ({ type, field, model: m }) => ({
      models: {
        Event: m('Event', {
          fields: {
            id: field.column(type.IntegerNumber()).id(),
            stored: field.column(type.IntegerNumber()),
            total: field.column(type.IntegerBigInt()),
            rank: field.column(type.IntegerNumber()),
            ratio: field.column(type.Real()),
            price: field.column(type.DecimalString()),
            storedPrice: field.column(type.DecimalString()),
            name: field.column(type.Text()),
            active: field.column(type.IntegerBoolean()).default(true),
            storedActive: field.column(type.IntegerBoolean()),
            avatar: field.column(type.Blob()),
            payload: field.column(type.PlainJson()),
            document: field.column(type.PlainJson()),
          },
        }).sql({ table: 'event' }),
      },
    }));

    expect(JSON.stringify(convenience)).toBe(JSON.stringify(explicit));
    expect(convenience).toMatchObject(
      withColumns({
        id: { codecId: 'sqlite/integer@1' },
        stored: { codecId: 'sqlite/integer@1' },
        total: { codecId: 'sqlite/bigint@1' },
        rank: { codecId: 'sqlite/integer@1' },
        ratio: { codecId: 'sqlite/real@1' },
        price: { codecId: 'sqlite/decimal@1' },
        name: { codecId: 'sqlite/text@1' },
        active: { codecId: 'sqlite/boolean@1', default: { kind: 'literal', value: true } },
        storedActive: { codecId: 'sqlite/boolean@1' },
        avatar: { codecId: 'sqlite/blob@1' },
        payload: { codecId: 'sqlite/json@1' },
        document: { codecId: 'sqlite/json@1' },
      }),
    );
  });

  it.each([
    ['Int', { storage: 'text' }, 'Argument "storage" of Int is text; write one of: integer.'],
    [
      'BigInt',
      { as: 'string' },
      'Argument "as" of BigInt is string; write one of: bigint, number.',
    ],
    ['Json', { storage: 'jsonb' }, 'Argument "storage" of Json is jsonb; write one of: text.'],
    [
      'Boolean',
      { storage: 'text' },
      'Argument "storage" of Boolean is text; write one of: integer.',
    ],
  ])('refuses %s(%o) at its argument', (name, written, message) => {
    expect(() =>
      defineContract({}, ({ type }) => {
        const helper = Reflect.get(type, name);
        if (typeof helper === 'function') helper(written);
        return { models: {} };
      }),
    ).toThrow(message);
  });
});
