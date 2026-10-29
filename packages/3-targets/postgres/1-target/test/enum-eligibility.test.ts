import { enumRefusalOf } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

describe('the Postgres codecs an enum cannot use', () => {
  it('are the native enum codec, bytea, tsquery, json, jsonb, xml and raw, each refused with its reason and what to use instead', () => {
    const refusals = Object.fromEntries(
      codecDescriptors.flatMap((descriptor) => {
        const refusal = enumRefusalOf(descriptor);
        return refusal === undefined ? [] : [[descriptor.codecId, refusal]];
      }),
    );

    expect(refusals).toEqual({
      'pg/enum@1':
        'A pg/enum codec types the column of a native enum, whose values the database enforces with an enum type of its own. Declare a native enum instead: native_enum in PSL, or nativeEnum in TypeScript.',
      'pg/bytea@1':
        'The contract stores a bytea value as base64 text, which PostgreSQL reads as the bytes of that text, so no CHECK can compare a value with the members. No enum can use a bytea codec; use a text enum instead.',
      'pg/tsquery@1':
        "PostgreSQL normalises the query text, so a member as written is not the value a query reads back: it prints a & b as 'a' & 'b'. No enum can use a tsquery codec; use a text enum instead.",
      'pg/json@1':
        'The json type has no equality operator, so no CHECK can compare a value with the members. No enum can use a json codec; use a text enum instead.',
      'pg/jsonb@1':
        'A CHECK lists a string member as SQL text, which PostgreSQL reads as the JSON text of a document rather than as a string, and a number member as a number, which PostgreSQL cannot compare with jsonb, so no CHECK can compare a value with the members. No enum can use a jsonb codec; use a text enum instead.',
      'pg/xml@1':
        'The xml type has no equality operator, so no CHECK can compare a value with the members. No enum can use an xml codec; use a text enum instead.',
      'sql/raw@1':
        'A raw column has a type Prisma does not interpret, so no member can be written as one of its values. No enum can use the raw codec; use a text enum instead.',
    });
  });
});
