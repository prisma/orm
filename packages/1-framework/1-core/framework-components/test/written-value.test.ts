import type { JsonValue } from '@internal/contract/types';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { createDataTypeLookup, dataType, dataTypeId } from '../src/shared/data-type';
import type { DataTypeAuthoringEntry } from '../src/shared/framework-authoring';
import {
  admittedForms,
  admittedTags,
  castTypedValue,
  type DataTypeSupport,
  describeAdmittedForms,
  describeExpected,
  describeRefusal,
  describeRefusedValueType,
  entryForPlain,
  entryForTag,
  exactRewrite,
  knownTags,
  readWrittenValue,
  tagForm,
  type WrittenForm,
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

const NUMBER: WrittenForm = { kind: 'number', phrase: 'a number' };
const QUOTED_STRING: WrittenForm = { kind: 'string', phrase: 'a quoted string' };
const SQL: WrittenForm = { kind: 'tag', tag: 'sql', phrase: 'sql`...`' };
const JSON_FORM: WrittenForm = { kind: 'tag', tag: 'json', phrase: 'json`...`' };

describe('admittedForms', () => {
  it('lists each form a position admits once, with its kind and phrase', () => {
    expect(admittedForms(support, [geometry.id])).toEqual([QUOTED_STRING, JSON_FORM]);
    expect(admittedForms(support, [big.id])).toEqual([NUMBER]);
    expect(admittedForms(support, [bool.id])).toEqual([
      { kind: 'boolean', phrase: 'true or false' },
    ]);
  });

  it('lists each form once across several receiving types', () => {
    expect(admittedForms(support, [small.id, big.id, jsonb.id])).toEqual([NUMBER, JSON_FORM]);
  });

  it('lists nothing for a type nothing writes', () => {
    expect(admittedForms(support, [dataTypeId('x/missing')])).toEqual([]);
  });
});

describe('tagForm', () => {
  it('is the form of a tag', () => {
    expect(tagForm('sql')).toEqual(SQL);
  });
});

describe('describeExpected', () => {
  it('leads with the forms to write, joined with or', () => {
    expect(describeExpected([NUMBER])).toBe('Expected a number');
    expect(describeExpected([QUOTED_STRING, JSON_FORM])).toBe(
      'Expected a quoted string or json`...`',
    );
  });
});

describe('describeRefusedValueType', () => {
  it('words a value of another form by the forms to write', () => {
    expect(
      describeRefusedValueType({ receivingType: big.id, valueType: text.id }, support, {
        forms: [NUMBER],
        rewrite: undefined,
      }),
    ).toBe('Expected a number');
  });

  it('names both types when the value has a form the position admits', () => {
    expect(
      describeRefusedValueType({ receivingType: small.id, valueType: big.id }, support, {
        forms: [NUMBER],
        rewrite: undefined,
      }),
    ).toBe('Expected a number that t/small can hold; got t/big');
  });

  it('compares the kind of form, not its phrase', () => {
    expect(
      describeRefusedValueType({ receivingType: small.id, valueType: big.id }, support, {
        forms: [{ kind: 'number', phrase: 'a whole number' }],
        rewrite: undefined,
      }),
    ).toBe('Expected a whole number that t/small can hold; got t/big');
  });

  it('tells two tags apart', () => {
    expect(
      describeRefusedValueType({ receivingType: sqlExpression.id, valueType: json.id }, support, {
        forms: [SQL],
        rewrite: undefined,
      }),
    ).toBe('Expected sql`...`');
  });
});

describe('exactRewrite', () => {
  it('rewrites a quoted string as a literal of the first tag the receiving type admits', () => {
    expect(exactRewrite(support, sqlExpression.id, { kind: 'string', text: 'now()' })).toBe(
      'sql`now()`',
    );
    expect(exactRewrite(support, jsonb.id, { kind: 'string', text: '{}' })).toBe('json`{}`');
  });

  it('offers nothing for a value that is not a quoted string', () => {
    expect(exactRewrite(support, sqlExpression.id, { kind: 'number', text: '8' })).toBeUndefined();
    expect(
      exactRewrite(support, sqlExpression.id, { kind: 'boolean', value: true }),
    ).toBeUndefined();
  });

  it('offers nothing for a receiving type without a tag', () => {
    expect(exactRewrite(support, big.id, { kind: 'string', text: '8' })).toBeUndefined();
  });

  it('offers nothing when the printed literal would not read back as the same text', () => {
    expect(
      exactRewrite(support, sqlExpression.id, { kind: 'string', text: '  now()' }),
    ).toBeUndefined();
  });

  it('offers nothing when the receiving type would refuse the rewrite too', () => {
    expect(exactRewrite(support, jsonb.id, { kind: 'string', text: 'plan' })).toBeUndefined();
  });
});

describe('describeRefusal', () => {
  const forms = (...admitted: WrittenForm[]) => ({ forms: admitted, rewrite: undefined });

  it('words an unknown tag with the known tags', () => {
    expect(
      describeRefusal(
        { kind: 'unknown-tag', tag: 'pg.sql', known: ['sql', 'json'] },
        support,
        forms(NUMBER),
      ),
    ).toEqual({
      code: 'PSL_UNKNOWN_LITERAL_TAG',
      message: 'Unknown literal tag "pg.sql". Known tags: sql, json.',
    });
  });

  it('words a syntax the target has no data type for, leading with the forms to write', () => {
    expect(
      describeRefusal({ kind: 'unwritable', syntax: 'boolean' }, support, forms(NUMBER)),
    ).toEqual({
      code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
      message: 'Expected a number; this target has no data type for a boolean value',
    });
  });

  it('words an unreadable value by its message', () => {
    expect(
      describeRefusal(
        { kind: 'unreadable', message: '"a" is not a UUID.' },
        support,
        forms(NUMBER),
      ),
    ).toEqual({ code: 'PSL_INVALID_LITERAL', message: '"a" is not a UUID.' });
  });

  it('words a value of another form by the forms to write', () => {
    expect(
      describeRefusal(
        { kind: 'no-cast', receivingType: big.id, valueType: text.id, casts: [small.id] },
        support,
        forms(NUMBER),
      ),
    ).toEqual({ code: 'PSL_VALUE_TYPE_INCOMPATIBLE', message: 'Expected a number' });
  });

  it('joins several forms with or', () => {
    expect(
      describeRefusal(
        { kind: 'no-cast', receivingType: geometry.id, valueType: bool.id, casts: [] },
        support,
        forms(QUOTED_STRING, JSON_FORM),
      ),
    ).toEqual({
      code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
      message: 'Expected a quoted string or json`...`',
    });
  });

  it('adds the exact rewrite when there is one', () => {
    expect(
      describeRefusal(
        { kind: 'no-cast', receivingType: sqlExpression.id, valueType: text.id, casts: [] },
        support,
        { forms: [SQL], rewrite: 'sql`(archived_at IS NULL)`' },
      ),
    ).toEqual({
      code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
      message: 'Expected sql`...`; write sql`(archived_at IS NULL)`',
    });
  });

  it('names both types when the value has a form the position admits', () => {
    expect(
      describeRefusal(
        { kind: 'no-cast', receivingType: small.id, valueType: big.id, casts: [] },
        support,
        forms(NUMBER),
      ),
    ).toEqual({
      code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
      message: 'Expected a number that t/small can hold; got t/big',
    });
  });
});
