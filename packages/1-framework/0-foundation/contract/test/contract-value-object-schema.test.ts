import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  ContractFieldTypeSchema,
  ContractValueObjectSchema,
} from '../src/contract-value-object-schema';

const text = { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false };
const addressReference = {
  kind: 'valueObject',
  plane: 'storage',
  namespaceId: 'public',
  entityKind: 'valueObject',
  entityName: 'Address',
};

describe('ContractValueObjectSchema', () => {
  it('accepts scalar, value object and union members, lists, dictionaries and value sets', () => {
    const valueObject = {
      fields: {
        street: text,
        home: { type: addressReference, nullable: true, many: { elementNullable: false } },
        either: {
          type: { kind: 'union', members: [text.type, addressReference] },
          nullable: false,
        },
        tags: { ...text, dict: true },
        kind: {
          ...text,
          valueSet: {
            plane: 'storage',
            namespaceId: 'public',
            entityKind: 'valueSet',
            entityName: 'Kind',
          },
        },
      },
    };
    expect(ContractValueObjectSchema(valueObject)).toEqual(valueObject);
  });

  it.each([
    ['a member without nullable', { street: { type: text.type } }],
    ['a member with dict false', { street: { ...text, dict: false } }],
    ['a member with an unknown key', { street: { ...text, column: 'street' } }],
    [
      'a member that names its value object the old way',
      { home: { ...text, type: { kind: 'valueObject', name: 'Address' } } },
    ],
    [
      'a member value set in the domain plane',
      {
        kind: {
          ...text,
          valueSet: {
            plane: 'domain',
            namespaceId: 'public',
            entityKind: 'enum',
            entityName: 'Kind',
          },
        },
      },
    ],
  ])('refuses %s', (_case, fields) => {
    expect(ContractValueObjectSchema({ fields })).toBeInstanceOf(type.errors);
  });
});

describe('ContractFieldTypeSchema', () => {
  it('accepts a scalar, a value object reference and a union of those', () => {
    const union = { kind: 'union', members: [text.type, addressReference] };
    expect(
      [text.type, addressReference, union].map((fieldType) => ContractFieldTypeSchema(fieldType)),
    ).toEqual([text.type, addressReference, union]);
  });

  it('refuses a union inside a union', () => {
    expect(
      ContractFieldTypeSchema({
        kind: 'union',
        members: [text.type, { kind: 'union', members: [text.type] }],
      }),
    ).toBeInstanceOf(type.errors);
  });
});
