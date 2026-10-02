import type { JsonValue } from '@internal/contract/types';
import { dataType } from '@internal/framework-components/codec';
import { InternalError } from '@internal/utils/internal-error';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { isSqlDataType, sqlDataType } from '../src/sql-data-type';
import { enumType, int4, numeric } from './sql-data-type-fixtures';

const precisionParams = type({ 'precision?': 'number.integer >= 0' });

describe('sqlDataType', () => {
  it('declares a data type with its SQL facts', () => {
    expect(int4).toMatchObject({ id: 't/int4', casts: {} });
    expect(int4.sql.texts).toEqual([
      { text: 'int4', written: true },
      { text: 'integer', catalog: true },
      { text: 'int' },
    ]);
    expect(int4.sql.claimsKind).toBeUndefined();
    expect(int4.sql.render).toBeUndefined();
    expect(int4.sql.fromReported).toBeUndefined();
  });

  it('refuses a parameter schema that is not an object schema, naming the data type', () => {
    expect(() => sqlDataType('t/scalar-params', { params: type('string') as never })).toThrow(
      InternalError,
    );
    expect(() => sqlDataType('t/scalar-params', { params: type('string') as never })).toThrow(
      /t\/scalar-params/,
    );
  });

  it.each([
    ['a union of objects', type({ length: 'number' }).or({ scale: 'number' })],
    ['a piped object', type({ length: 'number' }).pipe((params) => params)],
  ] as const)('refuses %s as a parameter schema, naming the data type', (_, params) => {
    expect(() => sqlDataType('t/unreadable-params', { params: params as never })).toThrow(
      expect.objectContaining({
        name: 'InternalError',
        message: expect.stringMatching(/t\/unreadable-params/),
      }),
    );
  });

  it('normalizes with the identity unless a normal form is declared', () => {
    expect(int4.sql.normalize({})).toEqual({});
    expect(numeric.sql.normalize({ precision: 10 })).toEqual({ precision: 10, scale: 0 });
  });

  it('keeps the casts, list cast and parameter schema of the framework declaration', () => {
    const params = type({ 'length?': 'number.integer >= 1' });
    const declared = sqlDataType('t/varchar', {
      params,
      casts: { [int4.id]: (value) => String(value) },
      listCast: { of: [int4.id], cast: (elements) => [...elements] },
      texts: [{ text: 'varchar', written: true, catalog: true }],
    });
    expect(declared.params).toBe(params);
    expect(declared.casts[int4.id]?.(1)).toBe('1');
    expect(declared.listCast?.of).toEqual(['t/int4']);
  });

  it('keeps every field of the framework declaration', () => {
    const casts = { [int4.id]: (value: JsonValue) => value };
    const toCanonicalForm = (value: JsonValue) => value;
    const declared = sqlDataType('t/kept', {
      casts,
      toCanonicalForm,
      texts: [{ text: 'kept', written: true, catalog: true }],
    });
    expect(Object.fromEntries(Object.entries(declared).filter(([key]) => key !== 'sql'))).toEqual(
      dataType('t/kept', { casts, toCanonicalForm }),
    );
  });

  it('validates its id like every data type', () => {
    expect(() => sqlDataType('t/int4@1', {})).toThrow(/is not a data type id/);
  });

  describe('rule 1: a text is lower case, single-spaced, literal characters and placeholders', () => {
    it.each([
      ['an upper-case letter', 'Integer'],
      ['two spaces in a row', 'double  precision'],
      ['a leading space', ' int4'],
      ['a trailing space', 'int4 '],
      ['a tab', 'double\tprecision'],
      ['a character outside the literal set', 'int4[]'],
      ['a double quote', '"char"'],
      ['an unclosed placeholder', 'numeric({precision'],
      ['an empty placeholder', 'numeric({})'],
      ['an empty text', ''],
    ])('refuses %s', (_why, text) => {
      expect(() => sqlDataType('t/bad', { params: precisionParams, texts: [{ text }] })).toThrow(
        InternalError,
      );
      expect(() => sqlDataType('t/bad', { params: precisionParams, texts: [{ text }] })).toThrow(
        /t\/bad/,
      );
    });

    it('refuses a placeholder that names no parameter', () => {
      expect(() =>
        sqlDataType('t/bad', { params: precisionParams, texts: [{ text: 'numeric({scale})' }] }),
      ).toThrow(/scale/);
    });

    it('refuses a placeholder on a type without parameters', () => {
      expect(() => sqlDataType('t/bad', { texts: [{ text: 'numeric({precision})' }] })).toThrow(
        InternalError,
      );
    });

    it('accepts brackets, commas, spaces and placeholders in one text', () => {
      const declared = sqlDataType('t/ok', {
        params: precisionParams,
        texts: [{ text: 'time({precision}) with time zone', catalog: true }],
      });
      expect(declared.sql.texts).toHaveLength(1);
    });
  });

  describe('rule 2: one written and one catalog text per placeholder set', () => {
    it('refuses two written texts with the same placeholders', () => {
      expect(() =>
        sqlDataType('t/bad', {
          texts: [
            { text: 'int4', written: true },
            { text: 'integer', written: true },
          ],
        }),
      ).toThrow(InternalError);
    });

    it('refuses two catalog texts with the same placeholders', () => {
      expect(() =>
        sqlDataType('t/bad', {
          params: precisionParams,
          texts: [
            { text: 'time({precision})', catalog: true },
            { text: 'time({precision}) without time zone', catalog: true },
          ],
        }),
      ).toThrow(/t\/bad/);
    });

    it('allows one text to be both written and catalog', () => {
      expect(
        sqlDataType('t/ok', { texts: [{ text: 'text', written: true, catalog: true }] }).sql.texts,
      ).toHaveLength(1);
    });

    it('allows several texts that only claim to share a placeholder set', () => {
      expect(
        sqlDataType('t/ok', {
          texts: [{ text: 'int4', written: true }, { text: 'int' }, { text: 'integer' }],
        }).sql.texts,
      ).toHaveLength(3);
    });

    it('counts placeholder sets by name, not by position', () => {
      expect(() =>
        sqlDataType('t/bad', {
          params: type({ 'a?': 'number', 'b?': 'number' }),
          texts: [
            { text: 'x({a},{b})', written: true },
            { text: 'y({b},{a})', written: true },
          ],
        }),
      ).toThrow(InternalError);
    });
  });

  describe('rule 3: display differs from text in letter case only', () => {
    it('refuses a display that differs in more than case', () => {
      expect(() =>
        sqlDataType('t/bad', {
          texts: [{ text: 'geometry', written: true, display: 'Geometry ' }],
        }),
      ).toThrow(InternalError);
    });

    it('refuses a display that writes a placeholder differently', () => {
      expect(() =>
        sqlDataType('t/bad', {
          params: type({ 'srid?': 'number' }),
          texts: [
            {
              text: 'geometry(geometry,{srid})',
              written: true,
              display: 'geometry(Geometry,{SRID})',
            },
          ],
        }),
      ).toThrow(/t\/bad.*SRID/);
    });

    it('allows a display that differs in case only', () => {
      const declared = sqlDataType('t/ok', {
        params: type({ srid: 'number' }),
        texts: [
          {
            text: 'geometry(geometry,{srid})',
            written: true,
            display: 'geometry(Geometry,{srid})',
          },
        ],
      });
      expect(declared.sql.texts[0]?.display).toBe('geometry(Geometry,{srid})');
    });
  });

  describe('rule 4: render and fromReported go with claimsKind, which excludes texts', () => {
    it('refuses render without claimsKind', () => {
      expect(() => sqlDataType('t/bad', { render: () => 'x' })).toThrow(InternalError);
    });

    it('refuses fromReported without claimsKind', () => {
      expect(() => sqlDataType('t/bad', { fromReported: () => ({}) })).toThrow(/t\/bad/);
    });

    it('refuses texts next to claimsKind', () => {
      expect(() => sqlDataType('t/bad', { claimsKind: 'enum', texts: [{ text: 'enum' }] })).toThrow(
        InternalError,
      );
    });

    it('allows a kind claim with render and fromReported', () => {
      expect(enumType.sql.claimsKind).toBe('enum');
      expect(enumType.sql.render?.({ typeName: 'app.status' })).toBe('"app"."status"');
      expect(
        enumType.sql.fromReported?.({
          text: 'status',
          kind: 'enum',
          schema: 'public',
          name: 'status',
        }),
      ).toEqual({ typeName: 'status' });
    });
  });

  describe('rule 6: every normal form has a written text', () => {
    const lengthParams = type({ 'length?': 'number.integer >= 1' });
    const lengthOneWhenBare = (params: { readonly length?: number }) =>
      params.length === undefined ? { ...params, length: 1 } : params;

    it('refuses a normal form whose parameters only a catalog text takes, naming them', () => {
      expect(() =>
        sqlDataType('t/bad', {
          params: lengthParams,
          texts: [
            { text: 'bit', written: true },
            { text: 'bit({length})', catalog: true },
          ],
          normalize: lengthOneWhenBare,
        }),
      ).toThrow(/t\/bad.*\[length\]/);
    });

    it('accepts a normal form that a written text takes', () => {
      const declared = sqlDataType('t/ok', {
        params: lengthParams,
        texts: [
          { text: 'bit', written: true },
          { text: 'bit({length})', written: true, catalog: true },
        ],
        normalize: lengthOneWhenBare,
      });
      expect(declared.sql.normalize({})).toEqual({ length: 1 });
    });

    it('exempts a type that is never written', () => {
      expect(sqlDataType('t/never-written', { texts: [{ text: 'anyarray' }] }).sql.texts).toEqual([
        { text: 'anyarray' },
      ]);
    });
  });
});

describe('isSqlDataType', () => {
  it('recognises a SQL data type', () => {
    expect(isSqlDataType(int4)).toBe(true);
  });

  it('does not claim a plain data type', () => {
    expect(isSqlDataType(dataType('t/plain', {}))).toBe(false);
  });
});
