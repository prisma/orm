import 'temporal-polyfill/full/global';
import { describe, expect, it } from 'vitest';
import {
  defineContract,
  enumType,
  member,
  type ScalarFieldBuilder,
} from '../../src/exports/contract-builder';

type PostgresField = Parameters<NonNullable<Parameters<typeof defineContract>[1]>>[0]['field'];

function storedDefault(build: (field: PostgresField) => ScalarFieldBuilder): unknown {
  const contract = defineContract({}, ({ field, model }) => ({
    models: {
      Event: model('Event', {
        fields: { id: field.id.uuidv4String(), at: build(field) },
      }),
    },
  }));
  return contract.storage.namespaces['public']?.entries.table?.['Event']?.columns['at']?.default;
}

function fromUntypedCaller(value: unknown): never {
  return value as never;
}

describe('postgres defineContract encodes literal defaults through the column codec', () => {
  describe('field.dateTime()', () => {
    it('refuses a string, naming the model and field and carrying the codec message', () => {
      expect(() =>
        storedDefault((field) => field.dateTime().default(fromUntypedCaller('2024-01-01'))),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.DEFAULT_INVALID',
          message:
            'Field "Event.at" has a default that its codec refuses: Codec \'pg/timestamptz-temporal@1\' encodes a Temporal.Instant, but received a string.',
          meta: {
            modelName: 'Event',
            fieldName: 'at',
            codecId: 'pg/timestamptz-temporal@1',
            reason: 'codec-refused-default',
          },
          cause: expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' }),
        }),
      );
    });

    it('stores the text the codec produces for a Temporal.Instant', () => {
      expect(
        storedDefault((field) =>
          field.dateTime().default(Temporal.Instant.from('2024-01-01T00:00:00Z')),
        ),
      ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00Z' });
    });
  });

  it('stores a Date given to field.temporal.timestamptzJsDate()', () => {
    expect(
      storedDefault((field) =>
        field.temporal.timestamptzJsDate().default(new Date('2024-01-01T00:00:00Z')),
      ),
    ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00.000Z' });
  });

  it('refuses a fractional number on a bigint column', () => {
    expect(() => storedDefault((field) => field.bigint().default(fromUntypedCaller(1.5)))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: {
          modelName: 'Event',
          fieldName: 'at',
          codecId: 'pg/int8@1',
          reason: 'codec-refused-default',
        },
      }),
    );
  });

  it('says which element of a list default the codec refused', () => {
    expect(() =>
      storedDefault((field) =>
        field
          .bigint()
          .many()
          .default(fromUntypedCaller([1, 1.5])),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Event.at" has a default (element 2) that its codec refuses: pg/int8@1 number literal must be an integer within the safe integer range, got 1.5',
        meta: {
          modelName: 'Event',
          fieldName: 'at',
          codecId: 'pg/int8@1',
          reason: 'codec-refused-default',
          elementPosition: 2,
        },
      }),
    );
  });

  it('stores an enum member default in the form the enum codec produces', () => {
    const Level = enumType(
      'Level',
      { codecId: 'pg/int8@1' as const, nativeType: 'int8' },
      member('Low', 1n),
      member('High', 10n),
    );
    const contract = defineContract({ enums: { Level } }, ({ field, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.id.uuidv4String(),
            level: field.namedType(Level).default(Level.members.Low),
          },
        }),
      },
    }));
    expect(
      contract.storage.namespaces['public']?.entries.table?.['Event']?.columns['level']?.default,
    ).toEqual({ kind: 'literal', value: '1' });
  });

  it('stores an array of enum member values on an enum list field', () => {
    const Level = enumType(
      'Level',
      { codecId: 'pg/int8@1' as const, nativeType: 'int8' },
      member('Low', 1n),
      member('High', 10n),
    );
    const contract = defineContract({ enums: { Level } }, ({ field, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.id.uuidv4String(),
            levels: field.namedType(Level).many().default([Level.members.Low, Level.members.High]),
          },
        }),
      },
    }));
    expect(
      contract.storage.namespaces['public']?.entries.table?.['Event']?.columns['levels']?.default,
    ).toEqual({ kind: 'literal', value: ['1', '10'] });
  });

  it('keeps a caller-supplied codecLookup', () => {
    const contract = defineContract(
      {
        codecLookup: {
          get: (id) => ({
            id,
            encode: async (value: unknown) => value,
            decode: async (wire: unknown) => wire,
            encodeJson: () => 'encoded by the caller lookup',
            decodeJson: (json: unknown) => json,
          }),
          targetTypesFor: () => undefined,
          renderOutputTypeFor: () => undefined,
        },
      },
      ({ field, model }) => ({
        models: {
          Event: model('Event', {
            fields: {
              id: field.id.uuidv4String(),
              at: field.dateTime().default(Temporal.Instant.from('2024-01-01T00:00:00Z')),
            },
          }),
        },
      }),
    );
    expect(
      contract.storage.namespaces['public']?.entries.table?.['Event']?.columns['at']?.default,
    ).toEqual({ kind: 'literal', value: 'encoded by the caller lookup' });
  });
});
