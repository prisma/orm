import { fieldRewriteOf, formatMongoOperations } from '@internal/family-mongo/control';
import { MongoExistsExpr } from '@internal/mongo-query-ast/control';
import { RawAggregateCommand, RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { fillField } from '../src/core/migrations/migration-factories';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';
import { FillFieldCall } from '../src/core/migrations/op-factory-call';

const RAW_META = { target: 'mongo', storageHash: '', lane: 'mongo-raw' };

describe('fillField', () => {
  it('sets the field where it is missing or null, skipping validation, and checks none is left', () => {
    expect(fillField({ collection: 'users', field: 'age', value: { $toLong: 0 } })).toEqual({
      id: 'field.users.age.fill',
      label: 'Fill field age in collection users where it is missing or null',
      operationClass: 'widening',
      name: 'field.users.age.fill',
      precheck: [],
      run: [
        {
          collection: 'users',
          command: new RawUpdateManyCommand(
            'users',
            { age: null },
            [{ $set: { age: { $toLong: 0 } } }],
            { bypassDocumentValidation: true },
          ),
          meta: RAW_META,
        },
      ],
      postcheck: [
        {
          description: 'no document in users has age missing or null',
          source: {
            collection: 'users',
            command: new RawAggregateCommand('users', [{ $match: { age: null } }, { $limit: 1 }]),
            meta: RAW_META,
          },
          filter: MongoExistsExpr.exists('_id'),
          expect: 'notExists',
        },
      ],
    });
  });

  it("fills only a variant's documents when given its filter", () => {
    const op = fillField({
      collection: 'tasks',
      field: 'severity',
      value: 0,
      filter: { type: 'bug' },
    });

    expect({ id: op.id, label: op.label, filter: op.run[0]?.command }).toMatchObject({
      id: 'field.tasks.severity.fill.where({"type":"bug"})',
      label:
        'Fill field severity in collection tasks where it is missing or null in documents whose type is "bug"',
      filter: { filter: { $and: [{ type: 'bug' }, { severity: null }] } },
    });
  });

  it('round-trips through ops.json, reads as a field rewrite, and previews as its updateMany', () => {
    const op = fillField({ collection: 'users', field: 'plan', value: { $literal: '' } });

    expect({
      roundTrip: deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]),
      field: fieldRewriteOf(op)?.field,
      preview: formatMongoOperations([op]),
    }).toEqual({
      roundTrip: [op],
      field: 'plan',
      preview: [
        'db.getCollection("users").updateMany({"plan":null}, [{"$set":{"plan":{"$literal":""}}}], { bypassDocumentValidation: true })',
      ],
    });
  });
});

describe('FillFieldCall', () => {
  it('renders the call migration.ts writes, and lowers to fillField', () => {
    const call = new FillFieldCall({
      collection: 'users',
      field: 'age',
      value: { $toLong: 0 },
      filter: { type: 'bug' },
    });

    expect({
      source: call
        .renderTypeScript()
        .replace(/\s+/g, '')
        .replace(/,(?=[\]}])/g, ''),
      operationClass: call.operationClass,
      op: call.toOp(),
    }).toEqual({
      source: 'fillField({collection:"users",field:"age",value:{$toLong:0},filter:{type:"bug"}})',
      operationClass: 'widening',
      op: fillField({
        collection: 'users',
        field: 'age',
        value: { $toLong: 0 },
        filter: { type: 'bug' },
      }),
    });
  });
});
