import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  type ColumnRef,
  FunctionCallExpr,
  LiteralExpr,
  NotExpr,
  NullCheckExpr,
  RawExpr,
} from '@internal/sql-relational-core/ast';

const booleanResult = { codecId: 'pg/bool@1', nullable: false } as const;

function arrayPredicate(left: ColumnRef, operator: '&&' | '@>', right: ColumnRef): RawExpr {
  return new RawExpr({
    parts: [left, ` ${operator} `, right],
    returns: booleanResult,
  });
}

function nonEmpty(list: ColumnRef): AnyExpression {
  return BinaryExpr.gt(FunctionCallExpr.of('cardinality', [list]), LiteralExpr.of(0));
}

function withReferencedListOperand(
  list: ColumnRef,
  predicate: AnyExpression,
  negated: boolean,
): AnyExpression {
  return AndExpr.of([nonEmpty(list), negated ? new NotExpr(predicate) : predicate]);
}

function referencedScalarListMembership(
  scalar: ColumnRef,
  list: ColumnRef,
  negated: boolean,
): AnyExpression {
  const membership = BinaryExpr.eq(scalar, FunctionCallExpr.of('ANY', [list]));
  return AndExpr.of([
    NullCheckExpr.isNotNull(scalar),
    negated ? new NotExpr(membership) : membership,
  ]);
}

export function referencedScalarInList(
  scalar: ColumnRef,
  list: ColumnRef,
  negated = false,
): AnyExpression {
  return referencedScalarListMembership(scalar, list, negated);
}

export function referencedListHasScalar(
  list: ColumnRef,
  scalar: ColumnRef,
  negated = false,
): AnyExpression {
  return referencedScalarListMembership(scalar, list, negated);
}

export function referencedListHasSome(
  list: ColumnRef,
  values: ColumnRef,
  negated = false,
): AnyExpression {
  return withReferencedListOperand(values, arrayPredicate(list, '&&', values), negated);
}

export function referencedListHasEvery(
  list: ColumnRef,
  values: ColumnRef,
  negated = false,
): AnyExpression {
  return withReferencedListOperand(values, arrayPredicate(list, '@>', values), negated);
}

export function commonMixedRows() {
  return [
    {
      id: 1,
      string: 'a',
      string2: ['a'],
      int: 1,
      int2: [1],
      bInt: 1n,
      bInt2: [1n],
      float: 1.5,
      float2: [1.5],
      bytes: Uint8Array.from([1, 2, 3]),
      bytes2: [Uint8Array.from([1, 2, 3])],
      bool: false,
      bool2: [false],
      dt: Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
      dt2: [Temporal.Instant.from('1900-10-10T01:10:10.001Z')],
    },
    {
      id: 2,
      string: 'a',
      string2: ['b'],
      int: 1,
      int2: [2],
      bInt: 1n,
      bInt2: [2n],
      float: 1.5,
      float2: [2.4],
      bytes: Uint8Array.from([1, 2, 3]),
      bytes2: [Uint8Array.from([1, 2, 3, 4])],
      bool: false,
      bool2: [true],
      dt: Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
      dt2: [Temporal.Instant.from('1901-10-10T01:10:10.001Z')],
    },
    {
      id: 3,
      string2: [],
      int2: [],
      bInt2: [],
      float2: [],
      bytes2: [],
      bool2: [],
      dt2: [],
    },
  ];
}

export function commonListRows() {
  return [
    {
      id: 1,
      string: 'a',
      string_list: ['a', 'b'],
      string_list2: ['a', 'b'],
      int: 1,
      int_list: [1, 2],
      int_list2: [1, 2],
      bInt: 1n,
      bInt_list: [1n, 2n],
      bInt_list2: [1n, 2n],
      float: 1.5,
      float_list: [1.5, 2.4],
      float_list2: [1.5, 2.4],
      bytes: Uint8Array.from([1, 2, 3]),
      bytes_list: [Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3, 4])],
      bytes_list2: [Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3, 4])],
      bool: true,
      bool_list: [false, true],
      bool_list2: [false, true],
      dt: Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
      dt_list: [
        Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
        Temporal.Instant.from('1901-10-10T01:10:10.001Z'),
      ],
      dt_list2: [
        Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
        Temporal.Instant.from('1901-10-10T01:10:10.001Z'),
      ],
    },
    {
      id: 2,
      string: 'd',
      string_list: ['a', 'b'],
      string_list2: ['b', 'c'],
      int: 4,
      int_list: [1, 2],
      int_list2: [2, 3],
      bInt: 4n,
      bInt_list: [1n, 2n],
      bInt_list2: [2n, 3n],
      float: 1.2,
      float_list: [1.5, 2.4],
      float_list2: [2.4, 3.7],
      bytes: Uint8Array.from([1, 2, 4]),
      bytes_list: [Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3, 4])],
      bytes_list2: [Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([1, 2, 3, 4, 5])],
      bool: false,
      bool_list: [false, true],
      bool_list2: [true, true],
      dt: Temporal.Instant.from('1990-10-10T01:10:10.001Z'),
      dt_list: [
        Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
        Temporal.Instant.from('1901-10-10T01:10:10.001Z'),
      ],
      dt_list2: [
        Temporal.Instant.from('1901-10-10T01:10:10.001Z'),
        Temporal.Instant.from('1901-11-10T01:10:10.001Z'),
      ],
    },
    {
      id: 3,
      string_list: [],
      string_list2: [],
      int_list: [],
      int_list2: [],
      bInt_list: [],
      bInt_list2: [],
      float_list: [],
      float_list2: [],
      bytes_list: [],
      bytes_list2: [],
      bool_list: [],
      bool_list2: [],
      dt_list: [],
      dt_list2: [],
    },
  ];
}
