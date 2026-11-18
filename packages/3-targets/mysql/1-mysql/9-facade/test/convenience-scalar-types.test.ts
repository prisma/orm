import mysqlAdapter from '@internal/adapter-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import mysql from '@internal/target-mysql/control';
import mysqlPackRef from '@internal/target-mysql/pack';
import { mysqlCreateNamespace } from '@internal/target-mysql/types';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const stack = createControlStack({
  family: sql,
  target: mysql,
  adapter: mysqlAdapter,
  driver: mysqlDriver,
});

function emit(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'convenience-scalar-types.test.psl',
    context: contractSourceContextFromControlStack(stack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: mysqlPackRef,
      createNamespace: mysqlCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
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

function emitted(schema: string): string {
  const result = emit(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure));
  return JSON.stringify(result.value);
}

function failure(schema: string): string {
  const result = emit(schema);
  return result.ok ? '' : JSON.stringify(result.failure);
}

const rows: readonly (readonly [
  convenience: string,
  explicit: string,
  codecId: string,
  typeParams: Readonly<Record<string, number>> | undefined,
])[] = [
  ['Int', 'Int4', 'mysql/int@1', undefined],
  ['Int(storage: int)', 'Int4', 'mysql/int@1', undefined],
  ['BigInt', 'Int8BigInt', 'mysql/bigint@1', undefined],
  ['BigInt(as: number)', 'Int8Number', 'mysql/bigintnumber@1', undefined],
  ['BigInt(as: number, storage: bigint)', 'Int8Number', 'mysql/bigintnumber@1', undefined],
  ['Float', 'Float8', 'mysql/double@1', undefined],
  ['Float(storage: double)', 'Float8', 'mysql/double@1', undefined],
  ['Decimal', 'NumericString(65, 30)', 'mysql/decimal@1', { precision: 65, scale: 30 }],
  [
    'Decimal(precision: 10, scale: 2)',
    'NumericString(10, 2)',
    'mysql/decimal@1',
    { precision: 10, scale: 2 },
  ],
  ['String', 'Varchar(191)', 'sql/varchar@1', { length: 191 }],
  ['String(length: 40)', 'Varchar(40)', 'sql/varchar@1', { length: 40 }],
  ['String(storage: text)', 'Text', 'mysql/text@1', undefined],
  ['Decimal?', 'NumericString(65, 30)?', 'mysql/decimal@1', { precision: 65, scale: 30 }],
  ['Boolean', 'Bool', 'mysql/boolean@1', undefined],
  ['Boolean(storage: tinyint)', 'Bool', 'mysql/boolean@1', undefined],
  ['Bytes', 'Longblob', 'mysql/longblob@1', undefined],
  ['Bytes(storage: longblob)', 'Longblob', 'mysql/longblob@1', undefined],
  ['Json', 'PlainJson', 'mysql/json@1', undefined],
  ['Json(storage: json)', 'PlainJson', 'mysql/json@1', undefined],
  ['Json?', 'PlainJson?', 'mysql/json@1', undefined],
];

describe('a MySQL scalar convenience type', () => {
  it.each(rows)('%s emits the contract %s emits', (convenience, explicit) => {
    expect(emitted(model(`v ${convenience}`))).toBe(emitted(model(`v ${explicit}`)));
  });

  it.each(rows)('%s is a column of %s', (convenience, _explicit, codecId, typeParams) => {
    const result = emit(model(`v ${convenience}`));
    expect(result.ok && result.value.storage.namespaces['__unbound__']).toMatchObject({
      entries: {
        table: {
          event: {
            columns: { v: { codecId, ...(typeParams === undefined ? {} : { typeParams }) } },
          },
        },
      },
    });
  });

  it('emits sql.Varchar(191) as String does, and NumericString without arguments as a bare decimal', () => {
    expect(emitted(model('v sql.Varchar(191)'))).toBe(emitted(model('v String')));
    const bare = emit(model('v NumericString'));
    expect(bare.ok && bare.value.storage.namespaces['__unbound__']).toMatchObject({
      entries: { table: { event: { columns: { v: { codecId: 'mysql/decimal@1' } } } } },
    });
  });

  it('reads a decimal default written as a number or as text, in the form the column prints it', () => {
    const result = emit(
      model(
        'price  Decimal(precision: 10, scale: 2) @default(1.5)',
        'tax    Decimal(precision: 10, scale: 2) @default("0.07")',
        'whole  Decimal @default(3)',
        'ratio  Float @default(0.25)',
        'count  BigInt(as: number) @default(7)',
      ),
    );
    expect(result.ok && result.value.storage.namespaces['__unbound__']).toMatchObject({
      entries: {
        table: {
          event: {
            columns: {
              price: { default: { kind: 'literal', value: '1.50' } },
              tax: { default: { kind: 'literal', value: '0.07' } },
              whole: { default: { kind: 'literal', value: '3.000000000000000000000000000000' } },
              ratio: { default: { kind: 'literal', value: 0.25 } },
              count: { default: { kind: 'literal', value: '7' } },
            },
          },
        },
      },
    });
    expect(failure(model('tax Decimal(precision: 10, scale: 2) @default("0.075")'))).toContain(
      'holds without rounding',
    );
  });

  it('reads a boolean, bytes and JSON default as the value its column stores', () => {
    const result = emit(
      model(
        'on    Boolean @default(true)',
        'off   Boolean @default(false)',
        'data  Bytes @default(longblob`00ff`)',
        'empty Bytes @default(longblob``)',
        'doc   Json @default(json`{"b": [1, null], "a": "x"}`)',
        'nul   Json @default(json`null`)',
      ),
    );
    expect(result.ok && result.value.storage.namespaces['__unbound__']).toMatchObject({
      entries: {
        table: {
          event: {
            columns: {
              on: { default: { kind: 'literal', value: true } },
              off: { default: { kind: 'literal', value: false } },
              data: { default: { kind: 'literal', value: '00FF' } },
              empty: { default: { kind: 'literal', value: '' } },
              doc: { default: { kind: 'literal', value: { b: [1, null], a: 'x' } } },
              nul: { default: { kind: 'literal', value: null } },
            },
          },
        },
      },
    });
  });

  it('says what to write for a Decimal with a precision of fewer than 30 digits and no scale', () => {
    expect(JSON.parse(failure(model('v Decimal(precision: 10)')))).toMatchObject({
      diagnostics: [
        {
          message: expect.stringContaining(
            'Decimal holds 30 digits after the point unless `scale` is written, which a precision of 10 cannot hold. Write `scale` too, at most the precision, as in Decimal(precision: 10, scale: 2).',
          ),
        },
      ],
    });
  });

  it.each([
    ['Boolean @default(1)', 'PSL_VALUE_TYPE_INCOMPATIBLE'],
    ['Bytes @default(longblob`0g`)', 'is not hex text'],
    ['Json @default(json`{oops`)', 'PSL_INVALID_LITERAL'],
    ['Decimal(precision: 10, scale: 2) @default("ten")', 'not a decimal number'],
    ['Decimal(precision: 66)', 'precision'],
    ['Decimal(precision: 10, scale: 11)', 'scale must be at most the precision'],
    ['Float @default("x")', 'PSL_VALUE_TYPE_INCOMPATIBLE'],
    ['Varchar', 'length'],
  ])('refuses %s', (field, message) => {
    expect(failure(model(`v ${field}`))).toContain(message);
  });

  it.each([
    ['Int(storage: bigint)', 'Argument \\"storage\\" of Int is bigint; write one of: int.'],
    ['Float(storage: float)', 'Argument \\"storage\\" of Float is float; write one of: double.'],
    ['Boolean(storage: bit)', 'Argument \\"storage\\" of Boolean is bit; write one of: tinyint.'],
    ['Bytes(storage: blob)', 'Argument \\"storage\\" of Bytes is blob; write one of: longblob.'],
    ['Json(storage: jsonb)', 'Argument \\"storage\\" of Json is jsonb; write one of: json.'],
    [
      'String(storage: char)',
      'Argument \\"storage\\" of String is char; write one of: varchar, text.',
    ],
    ['String(storage: text, length: 10)', 'does not apply to Text'],
  ])('refuses %s at the argument, naming the accepted choices', (written, message) => {
    expect(failure(model(`v ${written}`))).toContain(message);
  });
});

describe('a MySQL scalar convenience type in the TypeScript builder', () => {
  it('chooses the codec and type parameters of the explicit type it becomes', () => {
    const contract = defineContract({}, ({ type, field, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.Int()).id(),
            count: field.column(type.BigInt({ as: 'number' })),
            ratio: field.column(type.Float()),
            price: field.column(type.Decimal()),
            cents: field.column(type.Decimal({ precision: 10, scale: 2 })),
            name: field.column(type.String()),
            note: field.column(type.String({ storage: 'text' })),
            on: field.column(type.Boolean()),
            data: field.column(type.Bytes()),
            doc: field.column(type.Json()),
            explicitOn: field.column(type.Bool()),
            explicitData: field.column(type.Longblob()),
            explicitDoc: field.column(type.PlainJson()),
          },
        }).sql({ table: 'event' }),
      },
    }));
    const columns: Readonly<
      Record<string, { readonly codecId: string; readonly typeParams?: unknown }>
    > = contract.storage.namespaces['__unbound__']?.entries.table?.['event']?.columns ?? {};
    const shape = (name: string) => [columns[name]?.codecId, columns[name]?.typeParams];
    expect({
      id: shape('id'),
      count: shape('count'),
      ratio: shape('ratio'),
      price: shape('price'),
      cents: shape('cents'),
      name: shape('name'),
      note: shape('note'),
      on: shape('on'),
      data: shape('data'),
      doc: shape('doc'),
      explicitOn: shape('explicitOn'),
      explicitData: shape('explicitData'),
      explicitDoc: shape('explicitDoc'),
    }).toEqual({
      id: ['mysql/int@1', undefined],
      count: ['mysql/bigintnumber@1', undefined],
      ratio: ['mysql/double@1', undefined],
      price: ['mysql/decimal@1', { precision: 65, scale: 30 }],
      cents: ['mysql/decimal@1', { precision: 10, scale: 2 }],
      name: ['sql/varchar@1', { length: 191 }],
      note: ['mysql/text@1', undefined],
      on: ['mysql/boolean@1', undefined],
      data: ['mysql/longblob@1', undefined],
      doc: ['mysql/json@1', undefined],
      explicitOn: ['mysql/boolean@1', undefined],
      explicitData: ['mysql/longblob@1', undefined],
      explicitDoc: ['mysql/json@1', undefined],
    });
  });
});
