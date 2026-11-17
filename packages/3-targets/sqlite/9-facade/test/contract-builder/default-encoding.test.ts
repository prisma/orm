import { describe, expect, it } from 'vitest';
import { defineContract, type ScalarFieldBuilder } from '../../src/exports/contract-builder';

type SqliteHelpers = Parameters<NonNullable<Parameters<typeof defineContract>[1]>>[0];

function storedDefault(build: (helpers: SqliteHelpers) => ScalarFieldBuilder): unknown {
  const contract = defineContract({}, (helpers) => {
    const { field, model, gen, type } = helpers;
    return {
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.sql.Char(36)).id().onCreate(gen.uuid()),
            at: build(helpers),
          },
        }),
      },
    };
  });
  const [namespace] = Object.values(contract.storage.namespaces);
  return namespace?.entries.table?.['Event']?.columns['at']?.default;
}

function fromUntypedCaller(value: unknown): never {
  return value as never;
}

describe('sqlite defineContract encodes literal defaults through the column codec', () => {
  it('stores the canonical form of a Date given to field.column(type.DateTime())', () => {
    expect(
      storedDefault(({ field, type }) =>
        field.column(type.DateTime()).default(new Date('2024-01-01T00:00:00Z')),
      ),
    ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00.000Z' });
  });

  it('refuses a string given to field.column(type.DateTime())', () => {
    expect(() =>
      storedDefault(({ field, type }) =>
        field.column(type.DateTime()).default(fromUntypedCaller('2024-01-01T00:00:00Z')),
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

  it.each([
    ['sql/float@1', { codecId: 'sql/float@1' }],
    ['sqlite/real@1', { codecId: 'sqlite/real@1' }],
  ] as const)(
    'refuses a NaN default on a %s column, which SQLite cannot store',
    (codecId, type) => {
      expect(() => storedDefault(({ field }) => field.column(type).default(Number.NaN))).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.DEFAULT_INVALID',
          message: `Field "Event.at" has a default that its codec refuses: ${codecId} value must be a number other than NaN, which SQLite cannot store`,
          meta: {
            modelName: 'Event',
            fieldName: 'at',
            codecId,
            reason: 'codec-refused-default',
          },
        }),
      );
    },
  );
});
