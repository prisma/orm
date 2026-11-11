import { MongoExistsExpr } from '@internal/mongo-query-ast/control';
import { RawAggregateCommand, RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { castField } from '../src/core/migrations/migration-factories';
import { CastFieldCall } from '../src/core/migrations/op-factory-call';

const PLAN_META = { target: 'mongo', storageHash: '', lane: 'mongo-raw' };

describe('castField', () => {
  it('casts a field to its new BSON type where it holds another one, skipping validation', () => {
    const toCast = { $expr: { $in: [{ $type: '$age' }, ['int']] } };

    expect(castField({ collection: 'users', field: 'age', from: ['int'], to: 'long' })).toEqual({
      id: 'field.users.age.cast(long)',
      meta: { rewrite: { kind: 'cast', collection: 'users', field: 'age', to: 'long' } },
      label: 'Cast field age in collection users from int to long',
      operationClass: 'widening',
      name: 'field.users.age.cast(long)',
      precheck: [],
      run: [
        {
          collection: 'users',
          command: new RawUpdateManyCommand(
            'users',
            toCast,
            [{ $set: { age: { $convert: { input: '$age', to: 'long' } } } }],
            { bypassDocumentValidation: true },
          ),
          meta: PLAN_META,
        },
      ],
      postcheck: [
        {
          description: 'no document in users holds age as a type it is cast from, int',
          source: {
            collection: 'users',
            command: new RawAggregateCommand('users', [{ $match: toCast }, { $limit: 1 }]),
            meta: PLAN_META,
          },
          filter: MongoExistsExpr.exists('_id'),
          expect: 'notExists',
        },
      ],
    });
  });

  it('is destructive when the cast can change or lose a value', () => {
    expect(
      [
        castField({ collection: 'users', field: 'age', from: ['string'], to: 'int' }),
        castField({ collection: 'users', field: 'age', from: ['long'], to: 'int' }),
        castField({ collection: 'users', field: 'age', from: ['int', 'string'], to: 'long' }),
        castField({ collection: 'users', field: 'age', from: ['long'], to: 'decimal' }),
      ].map((op) => op.operationClass),
    ).toEqual(['destructive', 'destructive', 'destructive', 'widening']);
  });

  it('casts each element of a list', () => {
    const op = castField({
      collection: 'users',
      field: 'scores',
      from: ['int'],
      to: 'double',
      list: true,
    });
    const command = op.run[0]?.command;

    expect(command).toBeInstanceOf(RawUpdateManyCommand);
    expect(command).toMatchObject({
      filter: { scores: { $elemMatch: { $type: ['int'] } } },
      update: [
        {
          $set: {
            scores: {
              $map: {
                input: '$scores',
                as: 'value',
                in: { $convert: { input: '$$value', to: 'double' } },
              },
            },
          },
        },
      ],
    });
  });

  it('narrows the documents to a filter, as a variant does', () => {
    const op = castField({
      collection: 'items',
      field: 'size',
      from: ['int'],
      to: 'long',
      filter: { kind: 'box' },
    });

    expect(op).toMatchObject({
      id: 'field.items.size.cast(long).where({"kind":"box"})',
      label:
        'Cast field size in collection items from int to long in documents whose kind is "box"',
    });
    expect(op.run[0]?.command).toMatchObject({
      filter: {
        $and: [{ kind: 'box' }, { $expr: { $in: [{ $type: '$size' }, ['int']] } }],
      },
    });
  });

  it('casts only values of the types it is planned from, reading number as every numeric type', () => {
    expect(
      [
        castField({ collection: 'users', field: 'age', from: ['int', 'bool'], to: 'long' }),
        castField({ collection: 'users', field: 'age', from: ['number'], to: 'long' }),
        castField({ collection: 'users', field: 'age', from: [], to: 'long' }),
      ].map((op) => op.run[0]?.command),
    ).toMatchObject([
      { filter: { $expr: { $in: [{ $type: '$age' }, ['int', 'bool']] } } },
      { filter: { $expr: { $in: [{ $type: '$age' }, ['int', 'double', 'decimal']] } } },
      { filter: { $expr: { $not: { $in: [{ $type: '$age' }, ['missing', 'null', 'long']] } } } },
    ]);
  });

  it('refuses a BSON type $convert cannot cast to', () => {
    expect(() =>
      castField({ collection: 'users', field: 'tags', from: ['string'], to: 'array' }),
    ).toThrow(
      'castField casts field "tags" in collection users to "array", which $convert cannot cast to.',
    );
  });
});

describe('CastFieldCall', () => {
  it('renders the call migration.ts writes, and lowers to castField', () => {
    const call = new CastFieldCall({
      collection: 'users',
      field: 'age',
      from: ['string'],
      to: 'int',
    });

    expect({
      source: call.renderTypeScript(),
      operationClass: call.operationClass,
      label: call.label,
      op: call.toOp(),
    }).toEqual({
      source: 'castField({ collection: "users", field: "age", from: ["string"], to: "int" })',
      operationClass: 'destructive',
      label: 'Cast field age in collection users from string to int',
      op: castField({ collection: 'users', field: 'age', from: ['string'], to: 'int' }),
    });
  });
});
