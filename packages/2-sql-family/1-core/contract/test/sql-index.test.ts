import { namingOf, parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { Index, type IndexInput } from '../src/ir/sql-index';

function input(partial: {
  readonly name: string;
  readonly prefix?: string;
  readonly columns?: readonly string[];
  readonly expression?: string;
  readonly where?: string;
  readonly unique: boolean;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
}): IndexInput {
  const carried = {
    naming: parseNaming(partial.name, partial.prefix),
    where: partial.where,
    unique: partial.unique,
    type: partial.type,
    options: partial.options,
  };
  return partial.expression !== undefined
    ? { ...carried, expression: partial.expression }
    : { ...carried, columns: partial.columns ?? [] };
}

describe('Index', () => {
  it('constructs a wire-named column index (prefix + wire name)', () => {
    const idx = new Index(
      input({
        name: 'users_email_idx_ab12cd34',
        prefix: 'users_email_idx',
        columns: ['email'],
        unique: false,
      }),
    );
    expect(idx).toEqual({
      name: 'users_email_idx_ab12cd34',
      prefix: 'users_email_idx',
      columns: ['email'],
      unique: false,
    });
  });

  it('constructs an exact column index (no prefix)', () => {
    const idx = new Index(input({ name: 'users_email_key', columns: ['email'], unique: false }));
    expect(idx).toEqual({ name: 'users_email_key', columns: ['email'], unique: false });
  });

  it('constructs an exact expression index with a where predicate', () => {
    const idx = new Index(
      input({
        name: 'users_email_eq',
        expression: 'lower(email)',
        where: 'deleted_at IS NULL',
        unique: true,
        type: 'btree',
      }),
    );
    expect(idx).toEqual({
      name: 'users_email_eq',
      expression: 'lower(email)',
      where: 'deleted_at IS NULL',
      unique: true,
      type: 'btree',
    });
  });

  it('carries type and options through unchanged', () => {
    const idx = new Index(
      input({
        name: 'users_email_key',
        columns: ['email'],
        unique: false,
        type: 'hash',
        options: { fillfactor: 70 },
      }),
    );
    expect(idx.type).toBe('hash');
    expect(idx.options).toEqual({ fillfactor: 70 });
  });

  it('hands the naming it was built with back', () => {
    const wireNamed = new Index(
      input({
        name: 'users_email_idx_ab12cd34',
        prefix: 'users_email_idx',
        columns: ['email'],
        unique: false,
      }),
    );
    expect(namingOf(wireNamed.name, wireNamed.prefix)).toEqual({
      kind: 'wire',
      prefix: 'users_email_idx',
      hash: 'ab12cd34',
    });

    const exact = new Index(input({ name: 'users_email_key', columns: ['email'], unique: false }));
    expect(namingOf(exact.name, exact.prefix)).toEqual({ kind: 'exact', name: 'users_email_key' });
  });

  describe('columns xor expression (runtime backstop behind the input union)', () => {
    it('rejects both columns and expression', () => {
      expect(
        () =>
          new Index({
            naming: { kind: 'exact', name: 'users_email_eq' },
            columns: ['email'],
            expression: 'lower(email)',
            where: undefined,
            unique: false,
            type: undefined,
            options: undefined,
          } as never),
      ).toThrow(/exactly one of columns or expression/);
    });

    it('rejects neither columns nor expression', () => {
      expect(
        () =>
          new Index({
            naming: { kind: 'exact', name: 'users_email_eq' },
            where: undefined,
            unique: false,
            type: undefined,
            options: undefined,
          } as never),
      ).toThrow(/exactly one of columns or expression/);
    });
  });

  describe('name is always the full physical name', () => {
    it('rejects an empty name', () => {
      expect(
        () =>
          new Index({
            naming: { kind: 'exact', name: '' },
            columns: ['email'],
            where: undefined,
            unique: false,
            type: undefined,
            options: undefined,
          }),
      ).toThrow(/full physical name/);
    });
  });
});
