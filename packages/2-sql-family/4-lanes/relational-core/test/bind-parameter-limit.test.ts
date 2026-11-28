import { describe, expect, it } from 'vitest';
import { bindParameterCountOf, bindParameterLimitOfTarget } from '../src/bind-parameter-limit';
import { InsertAst, ParamRef, TableSource } from '../src/exports/ast';

describe('bindParameterLimitOfTarget', () => {
  it('declares the same limit for PostgreSQL and MySQL, and none for a target whose limit is not fixed', () => {
    expect(bindParameterLimitOfTarget('postgres')).toBe(65_535);
    expect(bindParameterLimitOfTarget('mysql')).toBe(65_535);
    expect(bindParameterLimitOfTarget('sqlite')).toBeUndefined();
  });
});

describe('bindParameterCountOf', () => {
  // Three rows of one parameter of their own, and a parent key they all share: four references,
  // six occurrences.
  const parentKey = ParamRef.of(1);
  const ast = InsertAst.into(TableSource.named('post')).withRows(
    [0, 1, 2].map((i) => ({ id: ParamRef.of(i + 1), user_id: parentKey })),
  );

  it('counts a shared parameter once on PostgreSQL, which numbers a reference once', () => {
    expect(bindParameterCountOf(ast, 'postgres')).toBe(4);
  });

  it('counts a shared parameter once per occurrence on MySQL, whose driver binds a value per placeholder', () => {
    expect(bindParameterCountOf(ast, 'mysql')).toBe(6);
  });
});
