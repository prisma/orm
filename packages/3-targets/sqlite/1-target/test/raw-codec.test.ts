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

  it('projects a BLOB as an array holding its hex text, as a blob column does, and every other value unchanged', () => {
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
            value: FunctionCallExpr.of('json_array', [FunctionCallExpr.of('hex', [expression])]),
          },
        ],
        expression,
      ),
    );
  });

  it('reads the array of hex text an include carries as a Uint8Array', async () => {
    expect([await codec.fromWire(['0AFF'], {}), await codec.fromWire([''], {})]).toEqual([
      new Uint8Array([0x0a, 0xff]),
      new Uint8Array([]),
    ]);
  });

  it('refuses an array that is not one BLOB hex text', async () => {
    await expect(codec.fromWire(['0aff'], {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
    });
    await expect(codec.fromWire(['0A', '0B'], {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
    });
  });

  it('passes bytes, numbers, text and null through unchanged', async () => {
    const bytes = new Uint8Array([1, 2]);
    expect(
      await Promise.all(
        [bytes, 42, 1.5, 'POINT(1 2)', null].map((wire) => codec.fromWire(wire, {})),
      ),
    ).toEqual([bytes, 42, 1.5, 'POINT(1 2)', null]);
    expect(await codec.toWire(bytes, {})).toBe(bytes);
  });
});
