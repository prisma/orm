import { describe, expect, it } from 'vitest';
import { defineContract, enumType, member } from '../../src/exports/contract-builder';

const pgInt = { codecId: 'pg/int4@1' as const, nativeType: 'int4' };
const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' };

describe('int-backed enum authoring against the real Postgres pack', () => {
  it('emits numeric membership checks for scalar and array enum columns', () => {
    const Level = enumType('Level', pgInt, member('Low', 1), member('High', 10));
    const contract = defineContract({ enums: { Level } }, ({ field, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.id.uuidv4String(),
            level: field.namedType(Level),
            levels: field.namedType(Level).many(),
          },
        }),
      },
    }));
    expect(contract.storage.namespaces['public']?.entries.table?.['Event']).toMatchObject({
      checks: expect.arrayContaining([
        expect.objectContaining({ expression: '"level" IN (1, 10)' }),
        expect.objectContaining({ expression: '"levels"::numeric[] <@ ARRAY[1, 10]::numeric[]' }),
        expect.objectContaining({ expression: 'array_position("levels", NULL) IS NULL' }),
      ]),
    });
  });

  it('accepts a text-backed enum on the same shape', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
    expect(() =>
      defineContract({ enums: { Role } }, ({ field, model }) => ({
        models: {
          Event: model('Event', {
            fields: { id: field.id.uuidv4String(), role: field.namedType(Role) },
          }),
        },
      })),
    ).not.toThrow();
  });
});
