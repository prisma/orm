import { describe, expect, it } from 'vitest';
import { defineContract, enumType, member } from '../../src/exports/contract-builder';

const pgNumeric = { codecId: 'pg/numeric@1' as const, nativeType: 'numeric' };
const pgInet = { codecId: 'pg/inet@1' as const, nativeType: 'inet' };
const pgTimestampString = { codecId: 'pg/timestamp-string@1' as const, nativeType: 'timestamp' };
const pgJson = { codecId: 'pg/json@1' as const, nativeType: 'json' };
const pgBytea = { codecId: 'pg/bytea@1' as const, nativeType: 'bytea' };
const pgTsquery = { codecId: 'pg/tsquery@1' as const, nativeType: 'tsquery' };
const pgTimestamptzString = {
  codecId: 'pg/timestamptz-string@1' as const,
  nativeType: 'timestamptz',
};

type EnumHandle = ReturnType<typeof enumType>;

function contractWithEnum(handle: EnumHandle) {
  return defineContract({ enums: { [handle.enumName]: handle } }, ({ field, model }) => ({
    models: {
      Item: model('Item', {
        fields: { id: field.id.uuidv4String(), value: field.namedType(handle) },
      }),
    },
  }));
}

function storedDefaults(): Record<string, unknown> {
  const contract = defineContract({}, ({ field, model }) => ({
    models: {
      Item: model('Item', {
        fields: {
          id: field.id.uuidv4String(),
          ratio: field.column(pgNumeric).default('01.5'),
          zero: field.column(pgNumeric).default('-0'),
          host: field.column(pgInet).default('10.0.0.1/32'),
          mapped: field.column(pgInet).default('::FFFF:10.0.0.1'),
        },
      }),
    },
  }));
  const columns = contract.storage.namespaces['public']?.entries.table?.['Item']?.columns;
  return {
    ratio: columns?.ratio?.default,
    zero: columns?.zero?.default,
    host: columns?.host?.default,
    mapped: columns?.mapped?.default,
  };
}

describe('values in a Postgres contract are the text Postgres returns', () => {
  it('stores numeric and inet defaults as Postgres prints them', () => {
    expect(storedDefaults()).toEqual({
      ratio: { kind: 'literal', value: '1.5' },
      zero: { kind: 'literal', value: '0' },
      host: { kind: 'literal', value: '10.0.0.1' },
      mapped: { kind: 'literal', value: '::ffff:10.0.0.1' },
    });
  });

  it.each([
    [
      'a numeric with a leading zero',
      enumType('Ratio', pgNumeric, member('A', '01.5')),
      '01.5',
      '1.5',
    ],
    ['a numeric negative zero', enumType('Ratio', pgNumeric, member('A', '-0')), '-0', '0'],
    [
      'an inet host with /32',
      enumType('Host', pgInet, member('A', '10.0.0.1/32')),
      '10.0.0.1/32',
      '10.0.0.1',
    ],
    [
      'an upper-case IPv4-mapped inet',
      enumType('Host', pgInet, member('A', '::FFFF:10.0.0.1')),
      '::FFFF:10.0.0.1',
      '::ffff:10.0.0.1',
    ],
  ])(
    'refuses %s enum member, saying the text Postgres returns',
    (_case, handle, written, printed) => {
      expect(() => contractWithEnum(handle)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ENUM_INVALID',
          message: `enumType("${handle.enumName}"): member "A" is written "${written}", but the column stores "${printed}". Write the member as "${printed}".`,
        }),
      );
    },
  );

  it('refuses an inet enum member that is not an address', () => {
    expect(() => contractWithEnum(enumType('Host', pgInet, member('A', 'not an address')))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Host") member "A" has a value its codec pg/inet@1 refuses: pg/inet@1 JSON value must be an IP address as PostgreSQL writes it',
      }),
    );
  });

  it.each([
    [
      'pg/timestamp-string@1',
      enumType('Stamp', pgTimestampString, member('A', '2024-01-02T03:04:05')),
      'A query reads each value as the text PostgreSQL prints, such as "2024-01-02 03:04:05", while the contract stores it in ISO 8601, such as "2024-01-02T03:04:05", so no value read back equals a member. Use pg/timestamp-temporal@1, whose members are Temporal values.',
    ],
    [
      'pg/timestamptz-string@1',
      enumType('Stamp', pgTimestamptzString, member('A', '2024-01-02T03:04:05Z')),
      `A query reads each value as the text PostgreSQL prints in the session's time zone, such as "2024-01-02 03:04:05+00", while the contract stores it in ISO 8601, such as "2024-01-02T03:04:05Z", so no value read back equals a member. Use pg/timestamptz-temporal@1, whose members are Temporal values.`,
    ],
    [
      'pg/json@1',
      enumType('Stamp', pgJson, member('A', 'low')),
      'The json type has no equality operator, so no CHECK can compare a value with the members. Use pg/jsonb@1, whose type has one.',
    ],
    [
      'pg/bytea@1',
      enumType('Stamp', pgBytea, member('A', new Uint8Array([1, 2]))),
      'The contract stores a bytea value as base64 text, which PostgreSQL reads as the bytes of that text, so no CHECK can compare a value with the members. No enum can use a bytea codec; use a text enum instead.',
    ],
    [
      'pg/tsquery@1',
      enumType('Stamp', pgTsquery, member('A', 'a & b' as never)),
      "PostgreSQL normalises the query text, so a member as written is not the value a query reads back: it prints a & b as 'a' & 'b'. No enum can use a tsquery codec; use a text enum instead.",
    ],
  ])('refuses an enum over %s, saying why', (codecId, handle, reason) => {
    expect(() => contractWithEnum(handle)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message: `enumType("Stamp"): an enum cannot use the codec ${codecId}. ${reason}`,
        fix: 'Type the enum with another codec.',
        meta: { enumName: 'Stamp', codecId, reason: 'codec-not-for-enums' },
      }),
    );
  });
});
