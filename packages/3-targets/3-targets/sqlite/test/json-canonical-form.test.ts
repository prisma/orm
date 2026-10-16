import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { sqliteJsonDescriptor } from '../src/core/codecs';
import { sqliteJson } from '../src/core/data-types';
import { fromContractJson, toContractJson } from './contract-json';

const codec = sqliteJsonDescriptor.factory()({ name: '<test>' });

describe('the value of sqlite/json', () => {
  it.each<readonly [JsonValue, string]>([
    [{ b: 1, a: [true, null] }, '{"a":[true,null],"b":1}'],
    [{ a: { d: 1, c: 2 } }, '{"a":{"c":2,"d":1}}'],
    ['plain', '"plain"'],
    [null, 'null'],
    [1.5, '1.5'],
  ])('is the JSON text of %j with sorted keys and no added whitespace: %s', (document, stored) => {
    expect(toContractJson(codec, document)).toBe(stored);
  });

  it('reads back as the document', () => {
    expect(fromContractJson(codec, '{"a":[true,null],"b":1}')).toEqual({ a: [true, null], b: 1 });
  });

  it('is owned by sqlite/json, which sqlite/json@1 represents', () => {
    expect(sqliteJsonDescriptor.dataType).toBe(sqliteJson.id);
  });
});
