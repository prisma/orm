import { describe, expect, it } from 'vitest';
import { defineContract, type ScalarFieldBuilder } from '../../src/exports/contract-builder';

type SqliteField = Parameters<NonNullable<Parameters<typeof defineContract>[1]>>[0]['field'];

function storedDefault(build: (field: SqliteField) => ScalarFieldBuilder): unknown {
  const contract = defineContract({}, ({ field, model }) => ({
    models: {
      Event: model('Event', {
        fields: { id: field.id.uuidv4String(), at: build(field) },
      }),
    },
  }));
  const [namespace] = Object.values(contract.storage.namespaces);
  return namespace?.entries.table?.['Event']?.columns['at']?.default;
}

function fromUntypedCaller(value: unknown): never {
  return value as never;
}

describe('sqlite defineContract encodes literal defaults through the column codec', () => {
  it('stores the canonical form of a Date given to field.temporal.datetime()', () => {
    expect(
      storedDefault((field) => field.temporal.datetime().default(new Date('2024-01-01T00:00:00Z'))),
    ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00Z' });
  });

  it('refuses a string given to field.temporal.datetime()', () => {
    expect(() =>
      storedDefault((field) =>
        field.temporal.datetime().default(fromUntypedCaller('2024-01-01T00:00:00Z')),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: {
          modelName: 'Event',
          fieldName: 'at',
          codecId: 'sqlite/datetime@1',
          reason: 'codec-refused-default',
        },
      }),
    );
  });
});
