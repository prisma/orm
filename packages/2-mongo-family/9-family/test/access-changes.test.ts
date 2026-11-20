import { createControlStack } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { mongoFamilyDescriptor } from '../src/core/control-descriptor';
import { stubMongoTargetDescriptor } from './test-target-descriptor';

describe('MongoControlFamilyInstance accessChangesOf', () => {
  it('lists no access change, since no MongoDB operation changes who can read or write documents', () => {
    const instance = mongoFamilyDescriptor.create(
      createControlStack({ family: mongoFamilyDescriptor, target: stubMongoTargetDescriptor }),
    );

    expect(
      instance.accessChangesOf([
        {
          id: 'collection.users.drop',
          label: 'Drop collection users',
          operationClass: 'destructive',
        },
      ]),
    ).toEqual([]);
  });
});
