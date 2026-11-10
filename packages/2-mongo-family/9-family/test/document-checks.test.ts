import { RawAggregateCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import {
  documentsFitValidator,
  relaxedDocumentsCheck,
  validatorCheckedBy,
} from '../src/core/document-checks';

function matchedValidator(check: ReturnType<typeof relaxedDocumentsCheck>): unknown {
  const command = 'command' in check.source ? check.source.command : undefined;
  if (!(command instanceof RawAggregateCommand)) throw new Error('Expected an aggregate');
  return command.pipeline[0];
}

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

describe('validatorCheckedBy', () => {
  it('reads back the validator documentsFitValidator wrote, and nothing from another source', () => {
    const validator = { $jsonSchema: { required: ['_id', 'plan'] } };

    expect([
      validatorCheckedBy(documentsFitValidator('users', validator).source),
      validatorCheckedBy({
        collection: 'users',
        command: new RawAggregateCommand('users', [{ $limit: 1 }]),
        meta: { target: 'mongo', storageHash: '', lane: 'mongo-raw' },
      }),
    ]).toEqual([validator, undefined]);
  });
});
