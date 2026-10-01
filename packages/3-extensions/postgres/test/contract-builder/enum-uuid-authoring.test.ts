import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { enumType as untypedEnumType } from '@internal/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { defineContract, enumType, member } from '../../src/exports/contract-builder';

const pgUuid = { codecId: 'pg/uuid@1' as const, nativeType: 'uuid' };

describe('uuid-backed enum authoring against the real Postgres pack', () => {
  it('stores lower-case members as written, in the enum, the value set and the CHECK', () => {
    const Key = enumType(
      'Key',
      pgUuid,
      member('A', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
      member('B', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    );
    const built = defineContract({ enums: { Key } }, ({ field, model }) => ({
      models: {
        Item: model('Item', {
          fields: { id: field.id.uuidv4String(), key: field.namedType(Key) },
        }),
      },
    }));
    const contract: Contract<SqlStorage> = built;

    expect({
      domainEnum: contract.domain.namespaces['public']?.enum?.['Key'],
      valueSet: contract.storage.namespaces['public']?.entries.valueSet?.['Key'],
      checks: contract.storage.namespaces['public']?.entries.table?.['Item']?.checks?.map(
        (check) => check.expression,
      ),
    }).toEqual({
      domainEnum: {
        codecId: 'pg/uuid@1',
        members: [
          { name: 'A', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          { name: 'B', value: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
        ],
      },
      valueSet: {
        kind: 'valueSet',
        values: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
      },
      checks: [
        `"key" IN ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')`,
      ],
    });
  });

  it.each([
    ['upper case', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'],
    ['braces', '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}'],
  ])('refuses a member written in %s, saying the text Postgres stores', (_spelling, written) => {
    const Key = enumType('Key', pgUuid, member('A', written));
    expect(() =>
      defineContract({ enums: { Key } }, ({ field, model }) => ({
        models: {
          Item: model('Item', {
            fields: { id: field.id.uuidv4String(), key: field.namedType(Key) },
          }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message: `enumType("Key"): member "A" is written "${written}", but the column stores "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11". Write the member as "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11".`,
      }),
    );
  });

  it('refuses a number member on pg/numeric from the untyped builder as an enum error', () => {
    const Ratio = untypedEnumType(
      'Ratio',
      { codecId: 'pg/numeric@1', nativeType: 'numeric' },
      member('Half', 1.5),
    );
    expect(() =>
      defineContract({ enums: { Ratio } }, ({ field, model }) => ({
        models: {
          Item: model('Item', {
            fields: { id: field.id.uuidv4String(), ratio: field.namedType(Ratio) },
          }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Ratio") member "Half" has a value its codec pg/numeric@1 refuses: pg/numeric@1 JSON value must be a decimal string',
      }),
    );
  });
});
