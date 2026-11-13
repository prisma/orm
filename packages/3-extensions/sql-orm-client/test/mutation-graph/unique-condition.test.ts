import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { not, or } from '../../src/filters';
import { pinsUniqueKey } from '../../src/mutation-graph/unique-condition';
import { countMutationWhere } from '../../src/mutation-statements';
import type { CollectionState } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { getTestContext } from '../helpers';

const { contract } = getTestContext();
const users = createCollectionFor('User').collection;
const projects = createCollectionFor('Project').collection;
const { root } = users.state.tables;
const usersColumn = (column: string) => ColumnRef.of(root.alias, column);

function pins(state: CollectionState): boolean {
  const where = countMutationWhere(contract, state.tables, state.filters, state.variantValue);
  return pinsUniqueKey(contract, state.tables.root, where);
}

function pinsWhere(where: AnyExpression | undefined): boolean {
  return pinsUniqueKey(contract, root, where);
}

describe('pinsUniqueKey', () => {
  it('holds for an equality on the primary key', () => {
    expect(pins(users.where({ id: 1 }).state)).toBe(true);
  });

  it('holds for an equality on the columns of a unique constraint', () => {
    expect(pins(users.whereUnique({ email: 'ada@example.com' }).state)).toBe(true);
  });

  it('holds for the callback form', () => {
    expect(pins(users.where((user) => user.id.eq(1)).state)).toBe(true);
  });

  it('holds for chained wheres whose equalities together cover a composite key', () => {
    expect(pins(projects.where({ tenantId: 1 }).where({ id: 2 }).state)).toBe(true);
  });

  it('holds when other conditions are combined with the key by and', () => {
    expect(pins(users.where({ name: 'Ada' }).where({ id: 1 }).state)).toBe(true);
  });

  it('holds for an equality with a literal that is not null', () => {
    expect(pinsWhere(BinaryExpr.eq(usersColumn('id'), LiteralExpr.of(1)))).toBe(true);
  });

  it('does not hold for a part of a composite key', () => {
    expect(pins(projects.where({ id: 2 }).state)).toBe(false);
  });

  it('does not hold for an equality on a column of no key', () => {
    expect(pins(users.where({ name: 'Ada' }).state)).toBe(false);
  });

  it('does not hold with no condition', () => {
    expect(pins(users.state)).toBe(false);
  });

  it('does not hold for an or', () => {
    expect(pins(users.where((user) => or(user.id.eq(1), user.id.eq(2))).state)).toBe(false);
  });

  it('does not hold for a not', () => {
    expect(pins(users.where((user) => not(user.id.eq(1))).state)).toBe(false);
  });

  it('does not hold for an in list', () => {
    expect(pins(users.where((user) => user.id.in([1])).state)).toBe(false);
  });

  it('does not hold for is null', () => {
    expect(pins(users.where((user) => user.email.isNull()).state)).toBe(false);
  });

  it('does not hold for an equality with a null literal', () => {
    expect(pinsWhere(BinaryExpr.eq(usersColumn('id'), LiteralExpr.of(null)))).toBe(false);
  });

  it('does not hold for an equality between two columns', () => {
    expect(pinsWhere(BinaryExpr.eq(usersColumn('id'), usersColumn('email')))).toBe(false);
  });

  it('does not hold for an equality on a column of another alias', () => {
    expect(pinsWhere(BinaryExpr.eq(ColumnRef.of('other', 'id'), ParamRef.of(1)))).toBe(false);
  });

  it('holds for and inside and', () => {
    expect(
      pinsWhere(
        AndExpr.of([
          AndExpr.of([BinaryExpr.eq(usersColumn('name'), ParamRef.of('Ada'))]),
          AndExpr.of([BinaryExpr.eq(usersColumn('id'), ParamRef.of(1))]),
        ]),
      ),
    ).toBe(true);
  });
});
