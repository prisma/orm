import { describe, expect, it } from 'vitest';
import { field, model } from '../src/contract-builder';
import { sql } from '../src/sql-default-literal';
import { columnDescriptor } from './helpers/column-descriptor';
import { defineTestContract } from './helpers/define-test-contract';
import { unboundTables } from './unbound-tables';

const textColumn = columnDescriptor('sql/text@1');

function loweredDefault(builder: ReturnType<typeof field.column>) {
  const contract = defineTestContract({
    models: { T: model('T', { fields: { id: builder.id() } }) },
  });
  return unboundTables(contract.storage)['T']?.columns['id']?.default;
}

describe('sql template tag', () => {
  it('returns a function default with the body verbatim', () => {
    expect(sql`gen_random_uuid()`).toEqual({ kind: 'function', expression: 'gen_random_uuid()' });
  });

  it('canonicalizes a multi-line body: blank edge lines dropped, common indent removed', () => {
    expect(sql`
      (now()
        + '00:03:00'::interval)
    `).toEqual({ kind: 'function', expression: "(now()\n  + '00:03:00'::interval)" });
  });

  it('is accepted by .default() and lowers to the column default', () => {
    expect(loweredDefault(field.column(textColumn).default(sql`gen_random_uuid()`))).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });

  it('lowers an empty body', () => {
    expect(sql``).toEqual({ kind: 'function', expression: '' });
  });

  it('throws CONTRACT.DEFAULT_SQL_INTERPOLATION when values are interpolated at runtime', () => {
    const tag = sql as (strings: TemplateStringsArray, ...values: readonly unknown[]) => unknown;
    expect(() => tag`a ${1} b`).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_SQL_INTERPOLATION',
        message: 'sql`...` does not support interpolation; write the SQL as one literal.',
      }),
    );
  });

  it('passes a body containing a dollar-brace sequence through verbatim: only JavaScript interpolation is refused', () => {
    // A literal `${x}` in source is JavaScript interpolation, so the raw text is handed in directly.
    const raw = 'a $' + '{x} b';
    const strings = Object.assign([raw], { raw: [raw] }) as unknown as TemplateStringsArray;
    expect(sql(strings)).toEqual({ kind: 'function', expression: raw });
  });

  it('reads the raw text: JavaScript escapes are not interpreted', () => {
    expect(sql`'\d+'`).toEqual({ kind: 'function', expression: "'\\d+'" });
    expect(sql`E'\n'`).toEqual({ kind: 'function', expression: "E'\\n'" });
    expect(sql`'C:\users'`).toEqual({ kind: 'function', expression: "'C:\\users'" });
  });

  it('resolves exactly the two backtick escapes PSL resolves', () => {
    expect(sql`\``).toEqual({ kind: 'function', expression: '`' });
    expect(sql`\$1`).toEqual({ kind: 'function', expression: '\\$1' });
    expect(sql`a\\b`).toEqual({ kind: 'function', expression: 'a\\b' });
  });

  it('refuses sql`now()` with CONTRACT.DEFAULT_INVALID, naming the form to write', () => {
    expect(() => sql`now()`).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Write .default(now()) instead of sql`now()`; now() is a Prisma default function, not raw SQL.',
      }),
    );
  });

  it('refuses sql`autoincrement()` with CONTRACT.DEFAULT_INVALID, naming the form to write', () => {
    expect(() => sql` autoincrement() `).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Write .default(autoincrement()) instead of sql`autoincrement()`; autoincrement() is a Prisma default function, not raw SQL.',
      }),
    );
  });

  it('passes NOW(), gen_random_uuid() and uuid() through verbatim', () => {
    expect([sql`NOW()`, sql`gen_random_uuid()`, sql`uuid()`]).toEqual([
      { kind: 'function', expression: 'NOW()' },
      { kind: 'function', expression: 'gen_random_uuid()' },
      { kind: 'function', expression: 'uuid()' },
    ]);
  });

  it('rejects a body the SQL check refuses with CONTRACT.DEFAULT_INVALID', () => {
    expect(() => sql`x; drop table t`).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
      }),
    );
  });
});
