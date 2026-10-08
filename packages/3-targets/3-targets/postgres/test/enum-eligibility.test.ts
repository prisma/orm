import { enumRefusalOf } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

describe('the Postgres codecs an enum cannot use', () => {
  it('are the string timestamps, bytea, tsquery and json, each refused with its reason and what to use instead', () => {
    const refusals = Object.fromEntries(
      codecDescriptors.flatMap((descriptor) => {
        const refusal = enumRefusalOf(descriptor);
        return refusal === undefined ? [] : [[descriptor.codecId, refusal]];
      }),
    );

    expect(refusals).toEqual({
      'pg/timestamp-string@1':
        'A query reads each value as the text PostgreSQL prints, such as "2024-01-02 03:04:05", while the contract stores it in ISO 8601, such as "2024-01-02T03:04:05", so no value read back equals a member. Use pg/timestamp-temporal@1, whose members are Temporal values.',
      'pg/timestamptz-string@1':
        'A query reads each value as the text PostgreSQL prints in the session\'s time zone, such as "2024-01-02 03:04:05+00", while the contract stores it in ISO 8601, such as "2024-01-02T03:04:05Z", so no value read back equals a member. Use pg/timestamptz-temporal@1, whose members are Temporal values.',
      'pg/bytea@1':
        'The contract stores a bytea value as base64 text, which PostgreSQL reads as the bytes of that text, so no CHECK can compare a value with the members. No enum can use a bytea codec; use a text enum instead.',
      'pg/tsquery@1':
        "PostgreSQL normalises the query text, so a member as written is not the value a query reads back: it prints a & b as 'a' & 'b'. No enum can use a tsquery codec; use a text enum instead.",
      'pg/json@1':
        'The json type has no equality operator, so no CHECK can compare a value with the members. Use pg/jsonb@1, whose type has one.',
    });
  });
});
