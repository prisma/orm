import {
  MongoSchemaCollection,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { mongoSchemaToView } from '../src/core/schema-to-view';

const branch = (properties: Record<string, unknown>, required: readonly string[]) => ({
  bsonType: 'object',
  properties,
  required,
  additionalProperties: false,
});

function validatorFieldLabels(jsonSchema: Record<string, unknown>): readonly string[] {
  const view = mongoSchemaToView(
    new MongoSchemaIR(
      [
        new MongoSchemaCollection({
          name: 'users',
          indexes: [],
          validator: new MongoSchemaValidator({
            jsonSchema,
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        }),
      ],
      { fromDatabase: false },
    ),
  );
  const collection = view.root.children?.[0];
  const validator = collection?.children?.find((child) => child.id === 'validator-users');
  return (validator?.children ?? []).map((child) => child.label);
}

describe('mongoSchemaToView', () => {
  it('shows the fields of a validator for one root model', () => {
    expect(
      validatorFieldLabels(
        branch({ _id: { bsonType: 'objectId' }, name: { bsonType: ['null', 'string'] } }, ['_id']),
      ),
    ).toEqual(['_id: objectId (required)', 'name: null,string']);
  });

  it('shows the fields of every root model of a shared collection', () => {
    expect(
      validatorFieldLabels({
        bsonType: 'object',
        anyOf: [
          branch({ _id: { bsonType: 'objectId' }, level: { bsonType: 'int' } }, ['_id', 'level']),
          branch({ _id: { bsonType: 'objectId' }, email: { bsonType: 'string' } }, ['_id']),
        ],
      }),
    ).toEqual(['_id: objectId (required)', 'level: int (required)', 'email: string']);
  });

  it('shows every BSON type a field has in the root models of a shared collection', () => {
    expect(
      validatorFieldLabels({
        bsonType: 'object',
        anyOf: [
          branch({ _id: { bsonType: 'objectId' }, value: { bsonType: 'string' } }, ['_id']),
          branch({ _id: { bsonType: 'objectId' }, value: { bsonType: ['null', 'int'] } }, ['_id']),
        ],
      }),
    ).toEqual(['_id: objectId (required)', 'value: string,null,int']);
  });
});

describe('mongoSchemaToView indexes', () => {
  it('identifies each index by its name, so two indexes on the same keys stay apart', () => {
    const keys = [{ field: 'email', direction: 1 as const }];
    const view = mongoSchemaToView(
      new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'users',
            indexes: [
              new MongoSchemaIndex({ name: 'User_email_key', keys, unique: true }),
              new MongoSchemaIndex({ name: 'User_email_idx', keys }),
            ],
          }),
        ],
        { fromDatabase: false },
      ),
    );
    expect(
      view.root.children?.[0]?.children?.map((node) => [node.id, node.meta?.['name']]),
    ).toEqual([
      ['index-users-User_email_key', 'User_email_key'],
      ['index-users-User_email_idx', 'User_email_idx'],
    ]);
  });
});
