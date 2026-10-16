import {
  BinaryExpr,
  CaseExpr,
  ColumnRef,
  FunctionCallExpr,
  LiteralExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { sqliteSqlRawDescriptor } from '../src/core/codecs';

describe('sql/raw@1 on SQLite', () => {
  const codec = sqliteSqlRawDescriptor.factory({ sql: 'geometry' })({ name: 'shape' });

  it('projects a BLOB as an object holding its hex text and every other value unchanged', () => {
    const expression = ColumnRef.of('places', 'shape');
    expect(
      sqliteSqlRawDescriptor.projectJson(expression, {
        codecId: 'sql/raw@1',
        typeParams: { sql: 'geometry' },
      }),
    ).toEqual(
      CaseExpr.of(
        [
          {
            condition: BinaryExpr.eq(
              FunctionCallExpr.of('typeof', [expression]),
              LiteralExpr.of('blob'),
            ),
            value: FunctionCallExpr.of('json_object', [
              LiteralExpr.of('blob'),
              FunctionCallExpr.of('hex', [expression]),
            ]),
          },
        ],
        expression,
      ),
    );
  });

  it('writes a Uint8Array as an object holding its uppercase hex text', () => {
    expect(codec.encodeJson(new Uint8Array([0x0a, 0xff]))).toEqual({ blob: '0AFF' });
    expect(codec.encodeJson(new Uint8Array([]))).toEqual({ blob: '' });
  });

  it('reads an object holding hex text back as a Uint8Array', () => {
    expect(codec.decodeJson({ blob: '0AFF' })).toEqual(new Uint8Array([0x0a, 0xff]));
    expect(codec.decodeJson({ blob: '' })).toEqual(new Uint8Array([]));
  });

  it('passes numbers, text and null through unchanged', () => {
    expect(codec.encodeJson(42)).toBe(42);
    expect(codec.encodeJson(1.5)).toBe(1.5);
    expect(codec.encodeJson('POINT(1 2)')).toBe('POINT(1 2)');
    expect(codec.decodeJson(42)).toBe(42);
    expect(codec.decodeJson(1.5)).toBe(1.5);
    expect(codec.decodeJson('POINT(1 2)')).toBe('POINT(1 2)');
    expect(codec.decodeJson(null)).toBeNull();
  });
});
