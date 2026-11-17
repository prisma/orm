import { createControlStack, hasOperationPreview } from '@internal/framework-components/control';
import {
  CreateIndexCommand,
  DropIndexCommand,
  type MongoMigrationPlanOperation,
} from '@internal/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { mongoFamilyDescriptor } from '../src/core/control-descriptor';
import { stubMongoTargetDescriptor } from './test-target-descriptor';

function instantiate() {
  return mongoFamilyDescriptor.create(
    createControlStack({ family: mongoFamilyDescriptor, target: stubMongoTargetDescriptor }),
  );
}

describe('MongoControlFamilyInstance OperationPreviewCapable', () => {
  it('hasOperationPreview is true', () => {
    expect(hasOperationPreview(instantiate())).toBe(true);
  });

  it('createIndex command produces a single mongodb-shell statement', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'index.users.create(email:1)',
      label: 'Create index',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create index',
          command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
            unique: true,
            name: 'email_1',
          }),
        },
      ],
      postcheck: [],
    };
    const preview = instantiate().toOperationPreview([op]);
    expect(preview.statements).toEqual([
      {
        text: 'db.getCollection("users").createIndex({ "email": 1 }, { unique: true, name: "email_1" })',
        language: 'mongodb-shell',
      },
    ]);
  });

  it('dropIndex command produces a single mongodb-shell statement', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'index.users.drop(email_1)',
      label: 'Drop index',
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          description: 'drop index',
          command: new DropIndexCommand('users', 'email_1'),
        },
      ],
      postcheck: [],
    };
    const preview = instantiate().toOperationPreview([op]);
    expect(preview.statements).toEqual([
      { text: 'db.getCollection("users").dropIndex("email_1")', language: 'mongodb-shell' },
    ]);
  });

  it('returns an empty preview for an empty operations list', () => {
    expect(instantiate().toOperationPreview([])).toEqual({ statements: [] });
  });
});
