import type { JsonValue } from '@internal/contract/types';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { createDataTypeLookup, dataType, dataTypeId } from '../src/shared/data-type';
import type { DataTypeAuthoringEntry } from '../src/shared/framework-authoring';
import {
  admittedTags,
  castTypedValue,
  type DataTypeSupport,
  describeAdmittedForms,
  describeRefusal,
  entryForPlain,
  entryForTag,
  knownTags,
  readWrittenValue,
} from '../src/shared/written-value';

const unchanged = (value: JsonValue) => value;

const sqlExpression = dataType('sql/expression', {});
const text = dataType('t/text', {});
const bool = dataType('t/bool', {});
const small = dataType('t/small', {});
const big = dataType('t/big', { casts: { [small.id]: (value) => `${String(value)}n` } });
const json = dataType('t/json', {});
const jsonb = dataType('t/jsonb', { casts: { [json.id]: unchanged } });
const uuid = dataType('t/uuid', {
  casts: {
    [text.id]: (value) => {
      if (typeof value === 'string' && value.length === 36) return value;
      throw new Error(`"${String(value)}" is not a UUID.`);
    },
  },
});
const geometry = dataType('t/geometry', { casts: { [text.id]: unchanged, [json.id]: unchanged } });

const entries: Readonly<Record<string, DataTypeAuthoringEntry>> = {
  [sqlExpression.id]: {
    written: { kind: 'tag', tag: 'sql', parse: (value) => value },
    print: (value) => String(value),
    documentation: 'A SQL expression.',
  },
  [text.id]: {
    written: { kind: 'plain', syntax: 'string', parse: (value) => value },
    print: (value) => String(value),
    documentation: 'Text.',
  },
  [bool.id]: {
    written: {
      kind: 'plain',
      syntax: 'boolean',
      parse: (value) => {
        if (value === 'true' || value === 'false') return value === 'true';
        throw new Error(`"${value}" is not a boolean.`);
      },
    },
    print: (value) => String(value),
    documentation: 'A boolean.',
  },
  [big.id]: {
    written: {
      kind: 'plain',
      syntax: 'number',
      types: [small.id, big.id],
      classify: (value) => {
        if (!/^-?\d+$/.test(value)) return undefined;
        const number = Number(value);
        return { type: Math.abs(number) < 100 ? small.id : big.id, value: number };
      },
    },
    print: (value) => String(value),
    documentation: 'A number.',
  },
  [json.id]: {
    written: { kind: 'tag', tag: 'json', parse: (value) => JSON.parse(value) },
    print: (value) => JSON.stringify(value),
    documentation: 'A JSON document.',
  },
};

const support: DataTypeSupport = {
  entries,
  lookup: createDataTypeLookup([
    sqlExpression,
    text,
    bool,
    small,
    big,
    json,
    jsonb,
    uuid,
    geometry,
  ]),
};

describe('entryForTag', () => {
  it('finds the entry a tag names, with its key as a data type id', () => {
    expect(entryForTag(support, 'json')).toEqual({ key: json.id, entry: entries[json.id] });
  });

  it('finds nothing for a tag no entry names', () => {
    expect(entryForTag(support, 'pg.sql')).toBeUndefined();
  });
});

describe('entryForPlain', () => {
  it('finds the entry for each plain syntax', () => {
    expect(entryForPlain(support, 'string')).toEqual({ key: text.id, entry: entries[text.id] });
    expect(entryForPlain(support, 'boolean')).toEqual({ key: bool.id, entry: entries[bool.id] });
    expect(entryForPlain(support, 'number')).toEqual({ key: big.id, entry: entries[big.id] });
  });

  it('finds nothing when no entry reads the syntax', () => {
    expect(entryForPlain({ entries: {}, lookup: support.lookup }, 'string')).toBeUndefined();
  });
});

describe('knownTags', () => {
  it('lists every tag in the order the entries were merged', () => {
    expect(knownTags(support)).toEqual(['sql', 'json']);
  });
});

describe('readWrittenValue', () => {
  it('reads a tag through its entry', () => {
    expect(readWrittenValue(support, { kind: 'tag', tag: 'json', text: '[1]' })).toEqual(
      ok({ type: json.id, value: [1] }),
    );
  });

  it('reads a string through the plain string entry', () => {
    expect(readWrittenValue(support, { kind: 'string', text: 'a' })).toEqual(
      ok({ type: text.id, value: 'a' }),
    );
  });

  it('reads a boolean through the plain boolean entry', () => {
    expect(readWrittenValue(support, { kind: 'boolean', value: false })).toEqual(
      ok({ type: bool.id, value: false }),
    );
  });

  it('reads a number into the type its classifier picks', () => {
    expect(readWrittenValue(support, { kind: 'number', text: '7' })).toEqual(
      ok({ type: small.id, value: 7 }),
    );
    expect(readWrittenValue(support, { kind: 'number', text: '700' })).toEqual(
      ok({ type: big.id, value: 700 }),
    );
  });

  it('refuses a tag no entry names, listing the known tags', () => {
    expect(readWrittenValue(support, { kind: 'tag', tag: 'pg.sql', text: 'x' })).toEqual(
      notOk({ kind: 'unknown-tag', tag: 'pg.sql', known: ['sql', 'json'] }),
    );
  });

  it('refuses a plain syntax no entry reads', () => {
    const noEntries: DataTypeSupport = { entries: {}, lookup: support.lookup };
    expect(readWrittenValue(noEntries, { kind: 'string', text: 'a' })).toEqual(
      notOk({ kind: 'unwritable', syntax: 'string' }),
    );
    expect(readWrittenValue(noEntries, { kind: 'boolean', value: true })).toEqual(
      notOk({ kind: 'unwritable', syntax: 'boolean' }),
    );
    expect(readWrittenValue(noEntries, { kind: 'number', text: '1' })).toEqual(
      notOk({ kind: 'unwritable', syntax: 'number' }),
    );
  });

  it('refuses a number the classifier places in no type', () => {
    expect(readWrittenValue(support, { kind: 'number', text: '1.5' })).toEqual(
      notOk({ kind: 'unreadable', message: 'no data type of this target holds the number 1.5' }),
    );
  });

  it('refuses text the entry cannot parse, with the parse error message', () => {
    expect(readWrittenValue(support, { kind: 'tag', tag: 'json', text: '{' })).toEqual(
      notOk({ kind: 'unreadable', message: expect.stringContaining('JSON') }),
    );
  });
});

describe('castTypedValue', () => {
  it('takes a value of the receiving type unchanged', () => {
    expect(castTypedValue(support, text.id, { type: text.id, value: 'a' })).toEqual(
      ok({ type: text.id, value: 'a' }),
    );
  });

  it('casts a value through the cast the receiving type declares, returning the cast value', () => {
    expect(castTypedValue(support, big.id, { type: small.id, value: 7 })).toEqual(
      ok({ type: big.id, value: '7n' }),
    );
  });

  it('refuses a value the receiving type has no cast from, listing its casts', () => {
    expect(castTypedValue(support, big.id, { type: text.id, value: 'a' })).toEqual(
      notOk({ kind: 'no-cast', receivingType: big.id, valueType: text.id, casts: [small.id] }),
    );
    expect(castTypedValue(support, sqlExpression.id, { type: text.id, value: 'a' })).toEqual(
      notOk({ kind: 'no-cast', receivingType: sqlExpression.id, valueType: text.id, casts: [] }),
    );
  });

  it('refuses a value the cast throws on, with the error message', () => {
    expect(castTypedValue(support, uuid.id, { type: text.id, value: 'a' })).toEqual(
      notOk({ kind: 'unreadable', message: '"a" is not a UUID.' }),
    );
  });
});

describe('admittedTags', () => {
  it('lists the tag of the type itself', () => {
    expect(admittedTags(support, sqlExpression.id)).toEqual(['sql']);
  });

  it('lists the tags of the types it casts from', () => {
    expect(admittedTags(support, jsonb.id)).toEqual(['json']);
    expect(admittedTags(support, geometry.id)).toEqual(['json']);
  });

  it('lists nothing for a type with no tag and no tagged cast source', () => {
    expect(admittedTags(support, bool.id)).toEqual([]);
    expect(admittedTags(support, big.id)).toEqual([]);
  });

  it('lists nothing for a type the stack does not register', () => {
    expect(admittedTags(support, dataTypeId('x/missing'))).toEqual([]);
  });

  it('lists the own tag first, then the tags of its cast sources', () => {
    const geo = dataType('t/geo', { casts: { [json.id]: unchanged } });
    const withGeo: DataTypeSupport = {
      entries: {
        ...entries,
        [geo.id]: {
          written: { kind: 'tag', tag: 'geo', parse: (value) => value },
          print: (value) => String(value),
          documentation: 'A geometry.',
        },
      },
      lookup: createDataTypeLookup([json, geo]),
    };
    expect(admittedTags(withGeo, geo.id)).toEqual(['geo', 'json']);
  });
});

describe('describeAdmittedForms', () => {
  it('describes a tagged type by its tag', () => {
    expect(describeAdmittedForms(support, sqlExpression.id)).toBe('sql`...`');
  });

  it('describes a boolean type', () => {
    expect(describeAdmittedForms(support, bool.id)).toBe('true or false');
  });

  it('describes a number type the number entry lists in its types, once', () => {
    expect(describeAdmittedForms(support, small.id)).toBe('a number');
    expect(describeAdmittedForms(support, big.id)).toBe('a number');
  });

  it('describes a type that casts from a tagged type', () => {
    expect(describeAdmittedForms(support, jsonb.id)).toBe('json`...`');
  });

  it('describes a type through each of its cast sources', () => {
    expect(describeAdmittedForms(support, uuid.id)).toBe('a quoted string');
    expect(describeAdmittedForms(support, geometry.id)).toBe('a quoted string or json`...`');
  });

  it('says a type with no written form has none', () => {
    expect(describeAdmittedForms(support, dataTypeId('x/missing'))).toBe('no written form');
  });
});

describe('describeRefusal', () => {
  it('words an unknown tag with the known tags', () => {
    expect(
      describeRefusal({ kind: 'unknown-tag', tag: 'pg.sql', known: ['sql', 'json'] }, 'a number'),
    ).toEqual({
      code: 'PSL_UNKNOWN_LITERAL_TAG',
      message: 'Unknown literal tag "pg.sql". Known tags: sql, json.',
    });
  });

  it('words a syntax the target has no data type for, with the forms to write', () => {
    expect(describeRefusal({ kind: 'unwritable', syntax: 'boolean' }, 'a number')).toEqual({
      code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
      message: 'This target has no data type for a boolean value; write a number',
    });
  });

  it('words an unreadable value by its message', () => {
    expect(
      describeRefusal({ kind: 'unreadable', message: '"a" is not a UUID.' }, 'a number'),
    ).toEqual({ code: 'PSL_INVALID_LITERAL', message: '"a" is not a UUID.' });
  });

  it('words a missing cast with the forms to write', () => {
    expect(
      describeRefusal(
        { kind: 'no-cast', receivingType: big.id, valueType: text.id, casts: [small.id] },
        'a number',
      ),
    ).toEqual({
      code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
      message: 't/big has no cast from t/text; write a number',
    });
  });
});
