import 'temporal-polyfill/full/global';
import type { AnyCodecDescriptor, Codec } from '@internal/framework-components/codec';
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

  it('stores the canonical form of a Date given to field.temporal.timestamptzJsDate()', () => {
    expect(
      storedDefault((field) =>
        field.temporal.timestamptzJsDate().default(new Date('2024-01-01T00:00:00Z')),
      ),
    ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00Z' });
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

  it('stores a uuid default in the form PostgreSQL writes', () => {
    expect(
      storedDefault((field) =>
        field.uuidNative().default('{A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11}'),
      ),
    ).toEqual({ kind: 'literal', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });
  });

  it('refuses an enum member its codec refuses, naming the enum, the member and the codec', () => {
    const Code = enumType(
      'Code',
      { codecId: 'pg/char@1' as const, nativeType: 'character' },
      member('Short', 'a'),
      member('Long', 'abc'),
    );
    expect(() =>
      defineContract({ enums: { Code } }, ({ field, model }) => ({
        models: {
          Event: model('Event', {
            fields: { id: field.id.uuidv4String(), code: field.namedType(Code) },
          }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Code") member "Long" has a value its codec pg/char@1 refuses: pg/char@1 JSON value must be a string of at most 1 character before any trailing spaces',
        fix: 'Give the member a value the codec takes, or type the enum with a codec that takes it.',
        meta: {
          enumName: 'Code',
          member: 'Long',
          codecId: 'pg/char@1',
          reason: 'codec-refused-member',
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
    const callerCodec = (id: string): Codec => ({
      id,
      encode: async (value: unknown) => value,
      decode: async (wire: unknown) => wire,
      encodeJson: () => 'encoded by the caller lookup',
      decodeJson: (json: unknown) => json,
    });
    const contract = defineContract(
      {
        codecLookup: {
          get: callerCodec,
          descriptorFor: (id) =>
            ({
              codecId: id,
              paramsSchema: undefined,
              factory: () => () => callerCodec(id),
            }) as unknown as AnyCodecDescriptor,
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
