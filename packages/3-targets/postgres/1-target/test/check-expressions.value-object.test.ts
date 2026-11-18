import type {
  ResolvedColumnValueObject,
  ResolvedValueObject,
  ResolvedValueObjectField,
  ResolvedValueObjectFieldType,
} from '@internal/sql-contract/check-expressions';
import type { JsonType } from '@internal/sql-contract/codec-json-type';
import { describe, expect, it } from 'vitest';
import { postgresRenderCheckExpressions } from '../src/core/check-expressions';

function scalar(
  jsonType: JsonType,
  values: readonly (string | number)[] | undefined = undefined,
): ResolvedValueObjectFieldType {
  return { kind: 'scalar', jsonType, values };
}

function member(
  type: ResolvedValueObjectFieldType,
  options: Partial<Pick<ResolvedValueObjectField, 'nullable' | 'many'>> = {},
): ResolvedValueObjectField {
  return { nullable: false, many: false, ...options, type };
}

function holding(valueObject: ResolvedValueObject): ResolvedValueObjectFieldType {
  return { kind: 'valueObject', valueObject };
}

function render(
  valueObject: ResolvedValueObject,
  column: Partial<Pick<ResolvedColumnValueObject, 'nullable' | 'many'>> = {},
): readonly { readonly kind: string; readonly expression: string }[] {
  return postgresRenderCheckExpressions({
    tableName: 'user',
    columnName: 'address',
    many: false,
    memberValues: undefined,
    valueObject: { nullable: false, many: false, ...column, valueObject },
  }).map(({ kind, expression }) => ({ kind, expression }));
}

const street = member(scalar('string'));
const flat: ResolvedValueObject = { fields: { street } };

const isObject = '$.type() == "object"';
const hasStreet = 'exists($.keyvalue() ? (@.key == "street" && (@.value.type() == "string")))';
const onlyStreet = '!exists($.keyvalue() ? (@.key != "street"))';

describe('postgresRenderCheckExpressions for a column that holds a value object', () => {
  it('requires an object with each required member, of its JSON type, and no other key', () => {
    expect(render(flat)).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && ${hasStreet} && ${onlyStreet}') IS TRUE`,
      },
    ]);
  });

  it('accepts SQL NULL and JSON null in a nullable column', () => {
    expect(render(flat, { nullable: true })).toEqual([
      {
        kind: 'shape',
        expression: `"address" IS NULL OR jsonb_path_match("address", 'strict $.type() == "null" || (${isObject} && ${hasStreet} && ${onlyStreet})') IS TRUE`,
      },
    ]);
  });

  it('lets a nullable member be absent or JSON null', () => {
    const zip = member(scalar('number'), { nullable: true });
    expect(render({ fields: { zip } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && !exists($.keyvalue() ? (@.key == "zip" && !(@.value.type() == "null" || (@.value.type() == "number")))) && !exists($.keyvalue() ? (@.key != "zip"))') IS TRUE`,
      },
    ]);
  });

  it('checks list members and their element nullability', () => {
    const tags = member(scalar('string'), { many: { elementNullable: false } });
    const flags = member(scalar('boolean'), { many: { elementNullable: true } });
    expect(render({ fields: { tags, flags } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && exists($.keyvalue() ? (@.key == "flags" && (@.value.type() == "array" && !exists(@.value[*] ? (!(@.type() == "null" || (@.type() == "boolean"))))))) && exists($.keyvalue() ? (@.key == "tags" && (@.value.type() == "array" && !exists(@.value[*] ? (!((@.type() == "string"))))))) && !exists($.keyvalue() ? (@.key != "flags" && @.key != "tags"))') IS TRUE`,
      },
    ]);
  });

  it('restricts an enum member to its value set', () => {
    const kind = member(scalar('string', ['home', "o'brien"]));
    expect(render({ fields: { kind } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && exists($.keyvalue() ? (@.key == "kind" && (@.value.type() == "string" && (@.value == "home" || @.value == "o''brien")))) && !exists($.keyvalue() ? (@.key != "kind"))') IS TRUE`,
      },
    ]);
  });

  it('restricts a numeric enum member to its value set', () => {
    const rank = member(scalar('number', [1, -2]));
    expect(render({ fields: { rank } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && exists($.keyvalue() ? (@.key == "rank" && (@.value.type() == "number" && (@.value == 1 || @.value == -2)))) && !exists($.keyvalue() ? (@.key != "rank"))') IS TRUE`,
      },
    ]);
  });

  it('inlines a nested value object and a list of them', () => {
    const geo = member(holding(flat));
    const stops = member(holding(flat), { many: { elementNullable: false } });
    const nestedAt = (path: string) =>
      `${path}.type() == "object" && exists(${path}.keyvalue() ? (@.key == "street" && (@.value.type() == "string"))) && !exists(${path}.keyvalue() ? (@.key != "street"))`;
    expect(render({ fields: { geo, stops } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && exists($.keyvalue() ? (@.key == "geo" && (${nestedAt('@.value')}))) && exists($.keyvalue() ? (@.key == "stops" && (@.value.type() == "array" && !exists(@.value[*] ? (!((${nestedAt('@')}))))))) && !exists($.keyvalue() ? (@.key != "geo" && @.key != "stops"))') IS TRUE`,
      },
    ]);
  });

  it('accepts any object where a value object refers back into itself', () => {
    const children = member({ kind: 'anyObject' }, { many: { elementNullable: false } });
    expect(render({ fields: { children } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && exists($.keyvalue() ? (@.key == "children" && (@.value.type() == "array" && !exists(@.value[*] ? (!((@.type() == "object"))))))) && !exists($.keyvalue() ? (@.key != "children"))') IS TRUE`,
      },
    ]);
  });

  it('checks a list column as an array of the value object', () => {
    expect(render(flat, { many: { elementNullable: false } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict $.type() == "array" && !exists($[*] ? (!((@.type() == "object" && exists(@.keyvalue() ? (@.key == "street" && (@.value.type() == "string"))) && !exists(@.keyvalue() ? (@.key != "street"))))))') IS TRUE`,
      },
    ]);
  });

  it('requires an object or array member to be of its JSON type, and lets a member of any JSON type hold any value, JSON null included', () => {
    const bytes = member(scalar('object'));
    const data = member(scalar('any'));
    const notes = member(scalar('any'), { nullable: true });
    const tags = member(scalar('array'));
    const blobs = member(scalar('object'), { many: { elementNullable: false } });
    expect(render({ fields: { blobs, bytes, data, notes, tags } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && exists($.keyvalue() ? (@.key == "blobs" && (@.value.type() == "array" && !exists(@.value[*] ? (!((@.type() == "object"))))))) && exists($.keyvalue() ? (@.key == "bytes" && (@.value.type() == "object"))) && exists($.keyvalue() ? (@.key == "data")) && exists($.keyvalue() ? (@.key == "tags" && (@.value.type() == "array"))) && !exists($.keyvalue() ? (@.key != "blobs" && @.key != "bytes" && @.key != "data" && @.key != "notes" && @.key != "tags"))') IS TRUE`,
      },
    ]);
  });

  it('requires a member written as a JSON string to be a string', () => {
    const amount = member(scalar('string'));
    expect(render({ fields: { amount } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && exists($.keyvalue() ? (@.key == "amount" && (@.value.type() == "string"))) && !exists($.keyvalue() ? (@.key != "amount"))') IS TRUE`,
      },
    ]);
  });

  it('writes member names as jsonpath strings', () => {
    const quoted = member(scalar('string'));
    expect(render({ fields: { 'say "hi"': quoted } })).toEqual([
      {
        kind: 'shape',
        expression: `jsonb_path_match("address", 'strict ${isObject} && exists($.keyvalue() ? (@.key == "say \\"hi\\"" && (@.value.type() == "string"))) && !exists($.keyvalue() ? (@.key != "say \\"hi\\""))') IS TRUE`,
      },
    ]);
  });
});
