import { RawAggregateCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { checkDocuments } from '../src/core/migrations/migration-factories';
import { CheckDocumentsCall } from '../src/core/migrations/op-factory-call';

function matchedValidator(op: ReturnType<typeof checkDocuments>): unknown {
  const [check] = op.precheck;
  const command = check?.source && 'command' in check.source ? check.source.command : undefined;
  if (!(command instanceof RawAggregateCommand)) throw new Error('Expected an aggregate');
  return command.pipeline[0];
}

describe('checkDocuments', () => {
  it('matches the documents the validator rejects once the rewritten fields are optional and take any value', () => {
    const op = checkDocuments({
      collection: 'users',
      validator: {
        bsonType: 'object',
        required: ['_id', 'email', 'plan'],
        properties: { _id: { bsonType: 'objectId' }, email: { bsonType: 'string' } },
        additionalProperties: false,
      },
      rewrittenFields: ['plan', 'nickname'],
    });

    expect({
      id: op.id,
      label: op.label,
      execute: op.execute,
      match: matchedValidator(op),
    }).toEqual({
      id: 'collection.users.checkDocuments',
      label: 'Check that the documents in users can fit the new validator',
      execute: [],
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
    const op = checkDocuments({
      collection: 'tasks',
      validator: { bsonType: 'object', anyOf: [{ oneOf: [branch] }] },
      rewrittenFields: ['severity'],
    });

    expect(matchedValidator(op)).toEqual({
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

describe('checkDocuments with a renamed field', () => {
  it("allows the old name with the new name's schema, and drops a required list left empty", () => {
    const op = checkDocuments({
      collection: 'tasks',
      validator: {
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
      rewrittenFields: [],
      renamedFields: { type: 'kind' },
    });

    expect(matchedValidator(op)).toEqual({
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
    const options = {
      collection: 'users',
      validator: { required: ['plan'] },
      rewrittenFields: ['plan'],
    };
    const call = new CheckDocumentsCall(options);

    expect({
      source: call
        .renderTypeScript()
        .replace(/\s+/g, '')
        .replace(/,(?=[\]}])/g, ''),
      op: call.toOp(),
    }).toEqual({
      source:
        'checkDocuments({collection:"users",validator:{required:["plan"]},rewrittenFields:["plan"]})',
      op: checkDocuments(options),
    });
  });
});
