import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

const NEEDS_PARAMS = new Set(['pg/enum@1']);

const parameterless = codecDescriptors.filter((d) => !NEEDS_PARAMS.has(d.codecId));
const source = ColumnRef.of('t', 'c');

describe('every shipped codec represents a Postgres data type', () => {
  it('ships no duplicate codec id', () => {
    const ids = codecDescriptors.map((d) => d.codecId);
    expect(ids).toHaveLength(new Set(ids).size);
  });
});

describe('every shipped codec projects a scalar read and lifts an array read', () => {
  it.each(parameterless.map((d) => [d.codecId, d] as const))('%s', (id, d) => {
    const scalar = d.projectJson(source, { codecId: id });
    const lifted = d.projectJson(source, { codecId: id, many: true });

    expect(scalar).toBeDefined();
    expect(lifted).not.toBe(scalar);
  });

  it('passes an identity-projected column through untouched', () => {
    const text = codecDescriptors.find((d) => d.codecId === 'pg/text@1');
    expect(text?.projectJson(source, { codecId: 'pg/text@1' })).toBe(source);
  });

  it.each(['sql/char@1', 'pg/char@1'])(
    'projects a %s column as text, which drops the padding a flat read drops',
    (codecId) => {
      const char = codecDescriptors.find((d) => d.codecId === codecId);
      expect(char?.projectJson(source, { codecId, typeParams: { length: 3 } })).toEqual(
        CastExpr.as(source, 'text'),
      );
    },
  );

  it.each(['pg/bytea@1', 'pg/interval@1', 'pg/json@1', 'pg/jsonb@1', 'pg/text-array@1'])(
    'projects a %s column as the text PostgreSQL prints, which fromWire reads as it reads a row',
    (codecId) => {
      const descriptor = codecDescriptors.find((d) => d.codecId === codecId);
      expect(descriptor?.projectJson(source, { codecId })).toEqual(CastExpr.as(source, 'text'));
    },
  );
});
