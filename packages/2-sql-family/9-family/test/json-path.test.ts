import { describe, expect, it } from 'vitest';
import { jsonPathText, keyPathOf, parseJsonPath } from '../src/core/migrations/json-path';

describe('parseJsonPath', () => {
  it.each([
    ['$', []],
    ['$.lat', [{ kind: 'member', name: 'lat' }]],
    ['$[*].lat', [{ kind: 'wildcard' }, { kind: 'member', name: 'lat' }]],
    [
      '$.point.lat',
      [
        { kind: 'member', name: 'point' },
        { kind: 'member', name: 'lat' },
      ],
    ],
    [
      '$.history[*].point.lat',
      [
        { kind: 'member', name: 'history' },
        { kind: 'wildcard' },
        { kind: 'member', name: 'point' },
        { kind: 'member', name: 'lat' },
      ],
    ],
    ["$['first name']", [{ kind: 'member', name: 'first name' }]],
    ['$["it\'s"]', [{ kind: 'member', name: "it's" }]],
    ["$['it\\'s\\u0041']", [{ kind: 'member', name: "it'sA" }]],
    ['$[ * ][ "a" ]', [{ kind: 'wildcard' }, { kind: 'member', name: 'a' }]],
    ['$._x9', [{ kind: 'member', name: '_x9' }]],
  ])('reads %s', (text, steps) => {
    expect(parseJsonPath(text).assertOk()).toEqual({ text, steps });
  });

  it.each([
    'lat',
    '',
    '$..lat',
    '$.*',
    '$[0]',
    '$[-1]',
    '$[0:2]',
    '$[?@.lat]',
    "$['a','b']",
    '$.9lat',
    '$.',
    '$[*',
    "$['a]",
    "$['\\x']",
    '$.lat ',
    '@.lat',
  ])('refuses %j', (text) => {
    expect(parseJsonPath(text).assertNotOk()).toBe(
      `path ${JSON.stringify(text)} is not a JSONPath of member names (.name or ['name']) and list wildcards ([*]) from $`,
    );
  });
});

describe('keyPathOf', () => {
  it('splits a path at its last member, and refuses a path that ends at a wildcard or at $', () => {
    expect(
      ['$.a[*].b', '$.a[*]', '$'].map((text) => keyPathOf(parseJsonPath(text).assertOk())),
    ).toEqual([
      {
        path: parseJsonPath('$.a[*].b').assertOk(),
        objects: [{ kind: 'member', name: 'a' }, { kind: 'wildcard' }],
        key: 'b',
      },
      undefined,
      undefined,
    ]);
  });
});

describe('jsonPathText', () => {
  it('writes identifiers in shorthand and other names in brackets', () => {
    expect(jsonPathText(parseJsonPath(`$.a['first name'][*]["it's"]._x`).assertOk().steps)).toBe(
      `$.a["first name"][*]["it's"]._x`,
    );
  });
});
