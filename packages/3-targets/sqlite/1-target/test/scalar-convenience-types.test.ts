import {
  findAuthoringTypeChoiceCall,
  instantiateAuthoringTypeCall,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import {
  sqliteConvenienceScalarTypes,
  sqliteExplicitScalarTypes,
} from '../src/core/type-constructors';
import sqliteTargetPack from '../src/exports/pack';

const namespace = sqliteTargetPack.authoring.type;

const explicitTypes = [
  ['IntegerNumber', 'sqlite/integer@1', 'stored as SQLite integer'],
  ['IntegerBigInt', 'sqlite/bigint@1', 'stored as SQLite integer'],
  ['Real', 'sqlite/real@1', 'stored as SQLite real'],
  ['Text', 'sqlite/text@1', 'stored as SQLite text'],
  ['Blob', 'sqlite/blob@1', 'stored as SQLite blob'],
  ['PlainJson', 'sqlite/json@1', 'stored as SQLite text'],
] as const;

const convenienceRows = [
  ['Int', [], 'IntegerNumber', 'sqlite/integer@1'],
  ['Int', ['integer'], 'IntegerNumber', 'sqlite/integer@1'],
  ['BigInt', [], 'IntegerBigInt', 'sqlite/bigint@1'],
  ['BigInt', ['bigint', 'integer'], 'IntegerBigInt', 'sqlite/bigint@1'],
  ['BigInt', ['number'], 'IntegerNumber', 'sqlite/integer@1'],
  ['BigInt', ['number', 'integer'], 'IntegerNumber', 'sqlite/integer@1'],
  ['Float', [], 'Real', 'sqlite/real@1'],
  ['Float', ['real'], 'Real', 'sqlite/real@1'],
  ['String', [], 'Text', 'sqlite/text@1'],
  ['String', ['text'], 'Text', 'sqlite/text@1'],
  ['Bytes', [], 'Blob', 'sqlite/blob@1'],
  ['Bytes', ['blob'], 'Blob', 'sqlite/blob@1'],
  ['Json', [], 'PlainJson', 'sqlite/json@1'],
  ['Json', ['text'], 'PlainJson', 'sqlite/json@1'],
] as const;

describe('the SQLite explicit scalar types', () => {
  it.each(explicitTypes)('%s is a type constructor on %s', (name, codecId, storedAs) => {
    expect(sqliteExplicitScalarTypes[name]).toEqual({
      kind: 'typeConstructor',
      documentation: expect.stringContaining(storedAs),
      output: { codecId },
    });
  });

  it('are contributed by the target, so PSL and type.* see them', () => {
    expect(namespace).toMatchObject(sqliteExplicitScalarTypes);
  });
});

describe('the SQLite scalar convenience types', () => {
  it('are type choices, none deprecated, each with a storage option', () => {
    expect(
      Object.fromEntries(
        Object.entries(sqliteConvenienceScalarTypes).map(([name, descriptor]) => [
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
      String: ['typeChoice', false, ['storage']],
      Bytes: ['typeChoice', false, ['storage']],
      Json: ['typeChoice', false, ['storage']],
    });
  });

  it.each(convenienceRows)('%s(%j) is %s, on %s', (name, args, explicit, codecId) => {
    expect({
      convenience: instantiateAuthoringTypeCall(namespace, name, args),
      explicit: instantiateAuthoringTypeCall(namespace, explicit, []),
    }).toEqual({ convenience: { codecId }, explicit: { codecId } });
  });

  it.each([
    ['Int', ['text']],
    ['BigInt', ['string']],
    ['BigInt', ['number', 'text']],
    ['Float', ['integer']],
    ['String', ['blob']],
    ['Bytes', ['text']],
    ['Json', ['blob']],
  ])('refuse %s(%j), which no row lists', (name, args) => {
    expect(() => instantiateAuthoringTypeCall(namespace, name, args)).toThrow();
  });

  it('declares Int before BigInt, so IntegerNumber is written Int and not BigInt(as: number)', () => {
    const names = Object.keys(namespace);
    expect(names.indexOf('Int')).toBeLessThan(names.indexOf('BigInt'));
    expect(
      findAuthoringTypeChoiceCall({ namespace, call: { path: ['IntegerNumber'], args: [] } }),
    ).toEqual({ path: ['Int'], args: [], becomes: { path: ['IntegerNumber'], args: [] } });
  });

  it.each([
    ['IntegerNumber', 'Int'],
    ['IntegerBigInt', 'BigInt'],
    ['Real', 'Float'],
    ['Text', 'String'],
    ['Blob', 'Bytes'],
    ['PlainJson', 'Json'],
  ])('write %s as the convenience call %s()', (explicit, convenience) => {
    expect(
      findAuthoringTypeChoiceCall({ namespace, call: { path: [explicit], args: [] } }),
    ).toEqual({ path: [convenience], args: [], becomes: { path: [explicit], args: [] } });
  });
});
