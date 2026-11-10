import { describe, expect, it } from 'vitest';
import { castField, checkDocuments, fillField } from '../src/core/migrations/migration-factories';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';
import { CheckDocumentsCall } from '../src/core/migrations/op-factory-call';

describe('what the new factories write about their operation', () => {
  it('describes a cast, a fill and a document check in the operation, which ops.json keeps', () => {
    const ops = [
      castField({ collection: 'users', field: 'age', from: ['string'], to: 'int' }),
      fillField({ collection: 'users', field: 'plan', value: { $literal: '' } }),
      checkDocuments({ collection: 'users', rewrittenFields: ['age', 'plan'] }),
    ];

    expect({
      meta: ops.map((op) => op.meta),
      checkDocuments: { precheck: ops[2]?.precheck, execute: Reflect.get(ops[2] ?? {}, 'execute') },
      roundTrip: deserializeMongoOps(JSON.parse(serializeMongoOps(ops))).map((op) => op.meta),
    }).toEqual({
      meta: [
        { rewrite: { kind: 'cast', collection: 'users', field: 'age', to: 'int' } },
        { rewrite: { kind: 'fill', collection: 'users', field: 'plan' } },
        {
          checkDocuments: {
            collection: 'users',
            rewrittenFields: ['age', 'plan'],
            renamedFields: {},
          },
        },
      ],
      checkDocuments: { precheck: [], execute: [] },
      roundTrip: [
        { rewrite: { kind: 'cast', collection: 'users', field: 'age', to: 'int' } },
        { rewrite: { kind: 'fill', collection: 'users', field: 'plan' } },
        {
          checkDocuments: {
            collection: 'users',
            rewrittenFields: ['age', 'plan'],
            renamedFields: {},
          },
        },
      ],
    });
  });
});

describe('CheckDocumentsCall', () => {
  it('renders the call migration.ts writes, and lowers to checkDocuments', () => {
    const options = { collection: 'users', rewrittenFields: ['plan'] };
    const call = new CheckDocumentsCall(options);

    expect({
      source: call
        .renderTypeScript()
        .replace(/\s+/g, '')
        .replace(/,(?=[\]}])/g, ''),
      op: call.toOp(),
    }).toEqual({
      source: 'checkDocuments({collection:"users",rewrittenFields:["plan"]})',
      op: checkDocuments(options),
    });
  });
});
