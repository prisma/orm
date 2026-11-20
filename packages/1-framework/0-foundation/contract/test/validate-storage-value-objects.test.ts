import { describe, expect, it } from 'vitest';
import { ContractValidationError } from '../src/contract-validation-error';
import type { StorageNamespace } from '../src/types';
import { validateContractDomain } from '../src/validate-domain';
import { validateStorageValueObjects } from '../src/validate-storage-value-objects';

const NAMESPACE = '__unbound__';
const text = { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } };

function valueObjectType(name: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: NAMESPACE,
    entityKind: 'valueObject',
    entityName: name,
  };
}

function storageWith(entries: StorageNamespace['entries']) {
  return { namespaces: { [NAMESPACE]: { id: NAMESPACE, entries } } };
}

function validating(entries: StorageNamespace['entries']) {
  return () => validateStorageValueObjects(storageWith(entries));
}

describe('validateStorageValueObjects', () => {
  it('accepts a value object whose field refers to another value object, and one that refers to itself', () => {
    expect(
      validating({
        valueObject: {
          Address: { fields: { street: text } },
          Profile: { fields: { home: { nullable: true, type: valueObjectType('Address') } } },
          TreeNode: {
            fields: { label: text, child: { nullable: true, type: valueObjectType('TreeNode') } },
          },
        },
      }),
    ).not.toThrow();
  });

  it('refuses a value object field that refers to a value object storage does not have', () => {
    expect(
      validating({
        valueObject: {
          Wrapper: { fields: { inner: { nullable: false, type: valueObjectType('Nonexistent') } } },
        },
      }),
    ).toThrow(
      'Contract storage validation failed:\n- Value object "__unbound__:Wrapper" field "inner" refers to value object "Nonexistent" in storage namespace "__unbound__", which storage.namespaces.__unbound__.entries.valueObject does not have',
    );
  });

  it('refuses a value object member whose storage value set storage does not have', () => {
    const member = (entityName: string) => ({
      ...text,
      valueSet: { plane: 'storage', entityKind: 'valueSet', namespaceId: NAMESPACE, entityName },
    });
    expect(
      validating({
        valueObject: { Tagged: { fields: { role: member('Role'), kind: member('Kind') } } },
        valueSet: { Role: { kind: 'valueSet', values: ['a'] } },
      }),
    ).toThrow(
      'Contract storage validation failed:\n- Value object "__unbound__:Tagged" field "kind" refers to value set "Kind" in storage namespace "__unbound__", which storage.namespaces.__unbound__.entries.valueSet does not have',
    );
  });

  it('refuses the old many: true on a value object field', () => {
    expect(
      validating({ valueObject: { Address: { fields: { tags: { ...text, many: true } } } } }),
    ).toThrow(/Value object "__unbound__:Address" field "tags" has invalid "many"/);
  });

  it('throws a storage validation error', () => {
    expect(
      validating({ valueObject: { Address: { fields: { tags: { ...text, many: true } } } } }),
    ).toThrow(ContractValidationError);
  });
});

describe('validateContractDomain', () => {
  it('leaves the fields of storage value objects to the storage validator', () => {
    expect(() =>
      validateContractDomain({
        roots: {},
        domain: { namespaces: { [NAMESPACE]: { models: {} } } },
        storage: storageWith({
          valueObject: {
            Wrapper: { fields: { inner: { nullable: false, type: valueObjectType('Missing') } } },
          },
        }),
      }),
    ).not.toThrow();
  });
});
