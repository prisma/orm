import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { valueObjectAt, valueObjectsWithCoordinates } from '../src/storage-value-objects';
import type { StorageNamespace } from '../src/types';

const address = {
  fields: { street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
} as const;

const storage = {
  namespaces: {
    public: { id: 'public', entries: { valueObject: { Address: address } } },
  },
};

describe('valueObjectAt', () => {
  it('reads the value object a reference names', () => {
    expect(
      valueObjectAt(storage, {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'valueObject',
        entityName: 'Address',
      }),
    ).toEqual(address);
  });

  it('is undefined for a name or a namespace storage does not have', () => {
    expect({
      name: valueObjectAt(storage, {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'valueObject',
        entityName: 'Missing',
      }),
      namespace: valueObjectAt(storage, {
        plane: 'storage',
        namespaceId: 'billing',
        entityKind: 'valueObject',
        entityName: 'Address',
      }),
    }).toEqual({ name: undefined, namespace: undefined });
  });
});

describe('valueObjectAt with an unusual namespace', () => {
  it('is undefined for a namespace id that names an Object.prototype property, or a namespace with no entries', () => {
    const reference = (namespaceId: string) =>
      ({
        plane: 'storage',
        namespaceId,
        entityKind: 'valueObject',
        entityName: 'Address',
      }) as const;
    expect({
      proto: valueObjectAt(storage, reference('__proto__')),
      noEntries: valueObjectAt(
        {
          namespaces: {
            bare: blindCast<StorageNamespace, 'a namespace with no entries'>({ id: 'bare' }),
          },
        },
        reference('bare'),
      ),
    }).toEqual({ proto: undefined, noEntries: undefined });
  });
});

describe('valueObjectsWithCoordinates', () => {
  it('lists each value object in every storage namespace with its coordinate', () => {
    expect(
      valueObjectsWithCoordinates({
        namespaces: {
          public: { id: 'public', entries: { valueObject: { Address: address }, table: {} } },
          billing: { id: 'billing', entries: { valueObject: { Address: address } } },
          bare: blindCast<StorageNamespace, 'a namespace with no entries'>({ id: 'bare' }),
        },
      }),
    ).toEqual([
      {
        coordinate: {
          plane: 'storage',
          namespaceId: 'public',
          entityKind: 'valueObject',
          entityName: 'Address',
        },
        valueObject: address,
      },
      {
        coordinate: {
          plane: 'storage',
          namespaceId: 'billing',
          entityKind: 'valueObject',
          entityName: 'Address',
        },
        valueObject: address,
      },
    ]);
  });
});
