import { RawAggregateCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import {
  castField,
  checkDocuments,
  fillField,
  relaxedDocumentsCheck,
} from '../src/core/migrations/migration-factories';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';
import { CheckDocumentsCall } from '../src/core/migrations/op-factory-call';

function matchedValidator(check: ReturnType<typeof relaxedDocumentsCheck>): unknown {
  const command = 'command' in check.source ? check.source.command : undefined;
  if (!(command instanceof RawAggregateCommand)) throw new Error('Expected an aggregate');
  return command.pipeline[0];
}

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

describe('relaxedDocumentsCheck', () => {
  it('matches the documents the validator rejects once the rewritten fields are optional and take any value', () => {
    const check = relaxedDocumentsCheck(
      { collection: 'users', rewrittenFields: ['plan', 'nickname'], renamedFields: {} },
      {
        bsonType: 'object',
        required: ['_id', 'email', 'plan'],
        properties: { _id: { bsonType: 'objectId' }, email: { bsonType: 'string' } },
        additionalProperties: false,
      },
    );

    expect({ description: check.description, match: matchedValidator(check) }).toEqual({
      description: 'every document in users fits the new validator',
      match: {
        $match: {
          $nor: [
            {
              $jsonSchema: {
                bsonType: 'object',
                required: ['_id', 'email'],
                properties: {
                  _id: { bsonType: 'objectId' },
                  email: { bsonType: 'string' },
                  plan: {},
                  nickname: {},
                },
                additionalProperties: false,
              },
            },
          ],
        },
      },
    });
  });

  it('relaxes each root model and variant branch', () => {
    const branch = {
      required: ['type', 'severity'],
      properties: { type: { enum: ['bug'] }, severity: { bsonType: 'int' } },
      additionalProperties: false,
    };
    const check = relaxedDocumentsCheck(
      { collection: 'tasks', rewrittenFields: ['severity'], renamedFields: {} },
      { bsonType: 'object', anyOf: [{ oneOf: [branch] }] },
    );

    expect(matchedValidator(check)).toEqual({
      $match: {
        $nor: [
          {
            $jsonSchema: {
              bsonType: 'object',
              anyOf: [
                {
                  oneOf: [
                    {
                      required: ['type'],
                      properties: { type: { enum: ['bug'] }, severity: {} },
                      additionalProperties: false,
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    });
  });
});

describe('relaxedDocumentsCheck with a renamed field', () => {
  it("allows the old name with the new name's schema, and drops a required list left empty", () => {
    const check = relaxedDocumentsCheck(
      { collection: 'tasks', rewrittenFields: [], renamedFields: { type: 'kind' } },
      {
        bsonType: 'object',
        required: ['_id', 'kind'],
        oneOf: [
          {
            properties: { kind: { enum: ['bug'] } },
            required: ['kind'],
            additionalProperties: false,
          },
        ],
      },
    );

    expect(matchedValidator(check)).toEqual({
      $match: {
        $nor: [
          {
            $jsonSchema: {
              bsonType: 'object',
              required: ['_id'],
              oneOf: [
                {
                  properties: { kind: { enum: ['bug'] }, type: { enum: ['bug'] } },
                  additionalProperties: false,
                },
              ],
            },
          },
        ],
      },
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
