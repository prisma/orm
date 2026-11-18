import {
  findAuthoringTypeChoiceCall,
  instantiateAuthoringTypeCall,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import {
  mysqlConvenienceScalarTypes,
  mysqlExplicitScalarTypes,
} from '../src/core/type-constructors';
import mysqlTargetPack from '../src/exports/pack';

const namespace = mysqlTargetPack.authoring.type;

const convenienceRows = [
  ['Int', [], 'Int4', [], { codecId: 'mysql/int@1' }],
  ['Int', ['int'], 'Int4', [], { codecId: 'mysql/int@1' }],
  ['BigInt', [], 'Int8BigInt', [], { codecId: 'mysql/bigint@1' }],
  ['BigInt', ['bigint', 'bigint'], 'Int8BigInt', [], { codecId: 'mysql/bigint@1' }],
  ['BigInt', ['number'], 'Int8Number', [], { codecId: 'mysql/bigintnumber@1' }],
  ['BigInt', ['number', 'bigint'], 'Int8Number', [], { codecId: 'mysql/bigintnumber@1' }],
  ['Float', [], 'Float8', [], { codecId: 'mysql/double@1' }],
  ['Float', ['double'], 'Float8', [], { codecId: 'mysql/double@1' }],
  [
    'Decimal',
    [],
    'NumericString',
    [65, 30],
    { codecId: 'mysql/decimal@1', typeParams: { precision: 65, scale: 30 } },
  ],
  [
    'Decimal',
    ['decimal', 10, 2],
    'NumericString',
    [10, 2],
    { codecId: 'mysql/decimal@1', typeParams: { precision: 10, scale: 2 } },
  ],
  ['String', [], 'Varchar', [191], { codecId: 'sql/varchar@1', typeParams: { length: 191 } }],
  [
    'String',
    ['varchar', 40],
    'Varchar',
    [40],
    { codecId: 'sql/varchar@1', typeParams: { length: 40 } },
  ],
  ['String', ['text'], 'Text', [], { codecId: 'mysql/text@1' }],
  ['Boolean', [], 'Bool', [], { codecId: 'mysql/boolean@1' }],
  ['Boolean', ['tinyint'], 'Bool', [], { codecId: 'mysql/boolean@1' }],
  ['Bytes', [], 'Longblob', [], { codecId: 'mysql/longblob@1' }],
  ['Bytes', ['longblob'], 'Longblob', [], { codecId: 'mysql/longblob@1' }],
  ['Json', [], 'PlainJson', [], { codecId: 'mysql/json@1' }],
  ['Json', ['json'], 'PlainJson', [], { codecId: 'mysql/json@1' }],
] as const;

describe('the MySQL scalar convenience types', () => {
  it('are type choices, none deprecated, each with a storage option', () => {
    expect(
      Object.fromEntries(
        Object.entries(mysqlConvenienceScalarTypes).map(([name, descriptor]) => [
          name,
          [
            descriptor.kind,
            'deprecated' in descriptor,
            descriptor.args.map((argument) => argument.name),
          ],
        ]),
      ),
    ).toEqual({
      Int: ['typeChoice', false, ['storage']],
      BigInt: ['typeChoice', false, ['as', 'storage']],
      Float: ['typeChoice', false, ['storage']],
      Decimal: ['typeChoice', false, ['storage', 'precision', 'scale']],
      String: ['typeChoice', false, ['storage', 'length']],
      Boolean: ['typeChoice', false, ['storage']],
      Bytes: ['typeChoice', false, ['storage']],
      Json: ['typeChoice', false, ['storage']],
    });
  });

  it.each(convenienceRows)('%s(%j) is %s(%j)', (name, args, explicit, explicitArgs, output) => {
    expect({
      convenience: instantiateAuthoringTypeCall(namespace, name, args),
      explicit: instantiateAuthoringTypeCall(namespace, explicit, explicitArgs),
    }).toEqual({ convenience: output, explicit: output });
  });

  it('keep each bare name on the column it gave before it was a type choice', () => {
    expect({
      Int: instantiateAuthoringTypeCall(namespace, 'Int', []),
      BigInt: instantiateAuthoringTypeCall(namespace, 'BigInt', []),
      String: instantiateAuthoringTypeCall(namespace, 'String', []),
    }).toEqual({
      Int: { codecId: 'mysql/int@1' },
      BigInt: { codecId: 'mysql/bigint@1' },
      String: { codecId: 'sql/varchar@1', typeParams: { length: 191 } },
    });
  });

  it.each([
    ['Int', ['bigint']],
    ['BigInt', ['string']],
    ['BigInt', ['number', 'int']],
    ['Float', ['float']],
    ['Decimal', ['numeric']],
    ['String', ['char']],
    ['String', ['text', 40]],
    ['Boolean', ['bit']],
    ['Bytes', ['blob']],
    ['Json', ['jsonb']],
  ])('refuse %s(%j), which no row lists', (name, args) => {
    expect(() => instantiateAuthoringTypeCall(namespace, name, args)).toThrow();
  });

  it('are the eight convenience names every target declares', () => {
    expect(Object.keys(mysqlConvenienceScalarTypes)).toEqual([
      'Int',
      'BigInt',
      'Float',
      'Decimal',
      'String',
      'Boolean',
      'Bytes',
      'Json',
    ]);
  });

  it('declares Int before BigInt, as on every target', () => {
    const names = Object.keys(namespace);
    expect(names.indexOf('Int')).toBeLessThan(names.indexOf('BigInt'));
  });
});

describe('the MySQL explicit scalar types', () => {
  it('mark one explicit type inferred for each column type', () => {
    expect(
      Object.entries(mysqlExplicitScalarTypes)
        .filter(([, descriptor]) => 'inferred' in descriptor)
        .map(([name]) => name),
    ).toEqual([
      'Int4',
      'Int8BigInt',
      'Float8',
      'NumericString',
      'Varchar',
      'Text',
      'Bool',
      'Longblob',
      'PlainJson',
    ]);
  });

  it.each([
    ['Int4', [], 'Int', []],
    ['Int8BigInt', [], 'BigInt', []],
    ['Int8Number', [], 'BigInt', [{ name: 'as', value: 'number' }]],
    ['Float8', [], 'Float', []],
    ['NumericString', [65, 30], 'Decimal', []],
    [
      'NumericString',
      [10, 2],
      'Decimal',
      [
        { name: 'precision', value: 10 },
        { name: 'scale', value: 2 },
      ],
    ],
    ['Varchar', [191], 'String', []],
    ['Varchar', [40], 'String', [{ name: 'length', value: 40 }]],
    ['Text', [], 'String', [{ name: 'storage', value: 'text' }]],
    ['Bool', [], 'Boolean', []],
    ['Longblob', [], 'Bytes', []],
    ['PlainJson', [], 'Json', []],
  ])('%s(%j) is written as the convenience call %s(%j)', (explicit, args, convenience, named) => {
    expect(
      findAuthoringTypeChoiceCall({ namespace, call: { path: [explicit], args } }),
    ).toMatchObject({ path: [convenience], args: named });
  });

  it.each(Object.entries(mysqlExplicitScalarTypes))('documents %s', (_name, descriptor) => {
    expect(descriptor.documentation).toMatch(/\S.+/);
  });
});
