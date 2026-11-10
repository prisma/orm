import type { MongoMigrationPlanOperation } from '@internal/mongo-query-ast/control';
import { CollModCommand } from '@internal/mongo-query-ast/control';
import { RawAggregateCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { relaxedDocumentsCheck, resolveDocumentChecks } from '../src/core/document-checks';

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

describe('resolveDocumentChecks', () => {
  const check: MongoMigrationPlanOperation = {
    id: 'collection.users.checkDocuments',
    label: 'Check that the documents in users can fit the new validator',
    operationClass: 'widening',
    meta: { checkDocuments: { collection: 'users', rewrittenFields: ['plan'], renamedFields: {} } },
    precheck: [],
    execute: [],
    postcheck: [],
  };
  const validatorChange = (collection: string): MongoMigrationPlanOperation => ({
    id: `validator.${collection}.update`,
    label: `Update validator on ${collection}`,
    operationClass: 'widening',
    precheck: [],
    execute: [
      {
        description: `modify ${collection}`,
        command: new CollModCommand(collection, {
          validator: { $jsonSchema: { bsonType: 'object', required: ['_id', 'plan'] } },
        }),
      },
    ],
    postcheck: [],
  });

  it('writes the check against the validator change of its collection, skipping other collections and operations still pending', () => {
    const pending = Promise.resolve(validatorChange('users'));
    const [resolved, ...rest] = resolveDocumentChecks([
      check,
      pending,
      validatorChange('orders'),
      validatorChange('users'),
    ]);

    expect({
      precheck: resolved instanceof Promise ? undefined : resolved?.precheck.length,
      rest: rest.length,
      pendingKept: rest[0] === pending,
    }).toEqual({ precheck: 1, rest: 3, pendingKept: true });
  });

  it('refuses a check with no validator change of its collection after it, saying what to do', () => {
    expect(() => resolveDocumentChecks([validatorChange('users'), check])).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_OPERATION_ENTRY',
        fix: 'Remove the checkDocuments(...) call, or restore the validator change of collection users after it in migration.ts, then run the file with node.',
      }),
    );
  });
});
