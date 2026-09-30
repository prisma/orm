import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '../../src/ast/sql-codec-helpers';
import {
  sqlCharColumn,
  sqlCharDescriptor,
  sqlFloatColumn,
  sqlFloatDescriptor,
  sqlIntColumn,
  sqlIntDescriptor,
  sqlTextColumn,
  sqlTextDescriptor,
  sqlVarcharColumn,
  sqlVarcharDescriptor,
} from '../../src/ast/sql-codecs';

const instanceCtx = { name: '<test>' };
const callCtx = {};

describe('sql-codecs', () => {
  describe('sql/text@1', () => {
    const codec = sqlTextDescriptor.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(SQL_TEXT_CODEC_ID);
    });

    it('encodes and decodes string values', async () => {
      expect(await codec.encode('hello', callCtx)).toBe('hello');
      expect(await codec.decode('hello', callCtx)).toBe('hello');
    });

    it('round-trips through JSON identity', () => {
      expect(codec.encodeJson('hello')).toBe('hello');
      expect(codec.decodeJson('hello')).toBe('hello');
    });
  });

  describe('sql/int@1', () => {
    const codec = sqlIntDescriptor.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(SQL_INT_CODEC_ID);
    });

    it('encodes and decodes number values', async () => {
      expect(await codec.encode(42, callCtx)).toBe(42);
      expect(await codec.decode(42, callCtx)).toBe(42);
    });

    it('round-trips through JSON identity', () => {
      expect(codec.encodeJson(42)).toBe(42);
      expect(codec.decodeJson(42)).toBe(42);
    });
  });

  describe('sql/float@1', () => {
    const codec = sqlFloatDescriptor.factory()(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(SQL_FLOAT_CODEC_ID);
    });

    it('encodes and decodes number values', async () => {
      expect(await codec.encode(3.14, callCtx)).toBe(3.14);
      expect(await codec.decode(3.14, callCtx)).toBe(3.14);
    });

    it('round-trips through JSON identity', () => {
      expect(codec.encodeJson(3.14)).toBe(3.14);
      expect(codec.decodeJson(3.14)).toBe(3.14);
    });

    // A database can hold a non-finite float and spells it as a JSON string —
    // PostgreSQL emits `"NaN"` and `"Infinity"` — which JSON has no number for.
    // The codec's application type is `number`, so it rejects rather than hand
    // back a string wearing that type.
    it('writes a non-finite value as the text PostgreSQL writes for it', () => {
      expect(
        [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((value) =>
          codec.encodeJson(value),
        ),
      ).toEqual(['NaN', 'Infinity', '-Infinity']);
    });

    it('reads the strings a database uses for non-finite floats', () => {
      expect(['NaN', 'Infinity'].map((json) => codec.decodeJson(json))).toEqual([
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]);
    });

    it('rejects a JSON value that is not a number', () => {
      expect(() => codec.decodeJson(true)).toThrow(/sql\/float@1/);
      expect(() => codec.decodeJson(null)).toThrow(/sql\/float@1/);
    });
  });

  describe('sql/char@1', () => {
    const codec = sqlCharDescriptor.factory({ length: 8 })(instanceCtx);

    it('id proxies through the descriptor (independent of params)', () => {
      expect(codec.id).toBe(SQL_CHAR_CODEC_ID);
    });

    it('encodes string values verbatim', async () => {
      expect(await codec.encode('user_001', callCtx)).toBe('user_001');
    });

    it('trims trailing spaces on decode, and only spaces, the padding a character column adds', async () => {
      expect(
        await Promise.all(
          ['user_001                            ', 'user_001', 'a\t  ', 'a\n', ' a'].map((wire) =>
            codec.decode(wire, callCtx),
          ),
        ),
      ).toEqual(['user_001', 'user_001', 'a\t', 'a\n', ' a']);
    });

    it('trims a value with a long interior run of spaces in time linear in its length', async () => {
      const wire = `${' '.repeat(50_000)}x${' '.repeat(49_999)}`;
      const started = performance.now();
      const decoded = await codec.decode(wire, callCtx);
      expect({ decoded, withinBound: performance.now() - started < timeouts.default }).toEqual({
        decoded: `${' '.repeat(50_000)}x`,
        withinBound: true,
      });
    });

    it('round-trips through JSON identity, keeping trailing spaces, as a default is written', () => {
      expect(codec.encodeJson('user_001')).toBe('user_001');
      expect(['user_001', 'a  ', 'a\t'].map((json) => codec.decodeJson(json))).toEqual([
        'user_001',
        'a  ',
        'a\t',
      ]);
    });

    it('renderOutputType returns Char<length>', () => {
      expect(sqlCharDescriptor.renderOutputType?.({ length: 36 })).toBe('Char<36>');
    });

    it('renderOutputType returns undefined when length absent', () => {
      expect(sqlCharDescriptor.renderOutputType?.({})).toBeUndefined();
    });
  });

  describe('sql/varchar@1', () => {
    const codec = sqlVarcharDescriptor.factory({ length: 255 })(instanceCtx);

    it('id proxies through the descriptor', () => {
      expect(codec.id).toBe(SQL_VARCHAR_CODEC_ID);
    });

    it('encodes and decodes string values verbatim', async () => {
      expect(await codec.encode('hello', callCtx)).toBe('hello');
      expect(await codec.decode('hello', callCtx)).toBe('hello');
    });

    it('round-trips through JSON identity', () => {
      expect(codec.encodeJson('hello')).toBe('hello');
      expect(codec.decodeJson('hello')).toBe('hello');
    });

    it('renderOutputType returns Varchar<length>', () => {
      expect(sqlVarcharDescriptor.renderOutputType?.({ length: 255 })).toBe('Varchar<255>');
    });

    it('renderOutputType returns undefined when length absent', () => {
      expect(sqlVarcharDescriptor.renderOutputType?.({})).toBeUndefined();
    });
  });

  describe('column helpers', () => {
    it('sqlTextColumn produces a ColumnSpec with text nativeType and no typeParams', () => {
      const spec = sqlTextColumn();
      expect(spec.codecId).toBe(SQL_TEXT_CODEC_ID);
      expect(spec.nativeType).toBe('text');
      expect(spec.typeParams).toBeUndefined();
    });

    it('sqlIntColumn produces a ColumnSpec with int nativeType', () => {
      const spec = sqlIntColumn();
      expect(spec.codecId).toBe(SQL_INT_CODEC_ID);
      expect(spec.nativeType).toBe('int');
    });

    it('sqlFloatColumn produces a ColumnSpec with float nativeType', () => {
      const spec = sqlFloatColumn();
      expect(spec.codecId).toBe(SQL_FLOAT_CODEC_ID);
      expect(spec.nativeType).toBe('float');
    });

    it('sqlCharColumn defaults typeParams to {} when invoked without arguments', () => {
      const spec = sqlCharColumn();
      expect(spec.codecId).toBe(SQL_CHAR_CODEC_ID);
      expect(spec.nativeType).toBe('char');
      expect(spec.typeParams).toEqual({});
    });

    it('sqlCharColumn carries the explicit length param', () => {
      const spec = sqlCharColumn({ length: 16 });
      expect(spec.typeParams).toEqual({ length: 16 });
    });

    it('sqlVarcharColumn defaults typeParams to {} when invoked without arguments', () => {
      const spec = sqlVarcharColumn();
      expect(spec.typeParams).toEqual({});
    });

    it('sqlVarcharColumn carries the explicit length param', () => {
      const spec = sqlVarcharColumn({ length: 64 });
      expect(spec.typeParams).toEqual({ length: 64 });
    });
  });

  describe('descriptor metadata', () => {
    it('codec ids match the SQL_*_CODEC_ID constants', () => {
      expect(sqlTextDescriptor.codecId).toBe(SQL_TEXT_CODEC_ID);
      expect(sqlIntDescriptor.codecId).toBe(SQL_INT_CODEC_ID);
      expect(sqlFloatDescriptor.codecId).toBe(SQL_FLOAT_CODEC_ID);
      expect(sqlCharDescriptor.codecId).toBe(SQL_CHAR_CODEC_ID);
      expect(sqlVarcharDescriptor.codecId).toBe(SQL_VARCHAR_CODEC_ID);
    });

    it('exposes traits and targetTypes for each codec', () => {
      expect(sqlTextDescriptor.traits).toEqual(['equality', 'order', 'textual']);
      expect(sqlTextDescriptor.targetTypes).toEqual(['text']);

      expect(sqlIntDescriptor.traits).toEqual(['equality', 'order', 'numeric']);
      expect(sqlIntDescriptor.targetTypes).toEqual(['int']);

      expect(sqlFloatDescriptor.traits).toEqual(['equality', 'order', 'numeric']);
      expect(sqlFloatDescriptor.targetTypes).toEqual(['float']);

      expect(sqlCharDescriptor.targetTypes).toEqual(['char']);
      expect(sqlVarcharDescriptor.targetTypes).toEqual(['varchar']);
    });
  });
});
