import { describe, expect, it } from 'vitest';
import { reportedSqlType } from '../src/core/reported-sql-type';

describe('reportedSqlType', () => {
  it('names the kind of each type Postgres distinguishes, and none for a base type', () => {
    const kinds = ['b', 'e', 'd', 'c', 'r', 'm', 'p'].map(
      (typtype) => reportedSqlType({ text: 't', typtype, schema: 'public', name: 't' }).kind,
    );
    expect(kinds).toEqual([
      undefined,
      'enum',
      'domain',
      'composite',
      'range',
      'multirange',
      undefined,
    ]);
  });

  it('removes the schema from the text of a base type outside pg_catalog', () => {
    expect(
      reportedSqlType({
        text: 'extensions.vector(3)',
        typtype: 'b',
        schema: 'extensions',
        name: 'vector',
      }),
    ).toEqual({ text: 'vector(3)', kind: undefined, schema: 'extensions', name: 'vector' });
  });

  it('removes a schema that format_type quotes', () => {
    const texts = [
      { text: '"My Ext".vector(3)', typtype: 'b', schema: 'My Ext', name: 'vector' },
      { text: '"a""b".vector', typtype: 'b', schema: 'a"b', name: 'vector' },
    ].map((row) => reportedSqlType(row).text);
    expect(texts).toEqual(['vector(3)', 'vector']);
  });

  it('keeps the text of a type with a kind, of a pg_catalog type, and of a type printed without its schema', () => {
    const texts = [
      { text: 'extensions.pair', typtype: 'c', schema: 'extensions', name: 'pair' },
      { text: 'pg_catalog.int4', typtype: 'b', schema: 'pg_catalog', name: 'int4' },
      { text: 'vector(3)', typtype: 'b', schema: 'public', name: 'vector' },
    ].map((row) => reportedSqlType(row).text);
    expect(texts).toEqual(['extensions.pair', 'pg_catalog.int4', 'vector(3)']);
  });
});
