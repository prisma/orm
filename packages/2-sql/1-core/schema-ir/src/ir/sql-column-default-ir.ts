import type { ColumnDefault, JsonValue } from '@internal/contract/types';
import type { CodecRef, DataTypeValue } from '@internal/framework-components/codec';
import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { blindCast } from '@internal/utils/casts';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { type SqlDefaultValue, sqlDefaultValuesEqual } from './sql-default-value';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './sql-schema-ir-node';

export interface SqlColumnDefaultIRInput {
  /** Structured default: the contract's, or what introspection read from the database. */
  readonly resolved?: ColumnDefault;
  /** Raw database default expression, when known (introspected side). */
  readonly raw?: string;
  /** See {@link import('./sql-column-ir').SqlColumnIRInput.authoredDefault}. */
  readonly authored?: ColumnDefault;
  /** See {@link import('./sql-column-ir').SqlColumnIRInput.defaultValue}. */
  readonly value?: SqlDefaultValue;
  /** See {@link import('./sql-column-ir').SqlColumnIRInput.defaultUnreadable}. */
  readonly unreadable?: string;
  /** See {@link import('./sql-column-ir').SqlColumnIRInput.defaultExpressionValue}. */
  readonly expressionValue?: SqlDefaultValue;
  /**
   * The owning column's array-ness, threaded through so the planner's
   * set-default op-builder can render an array-literal default (e.g.
   * `ARRAY[...]`) the same way the pre-`plan(start, end)` op-path did. See
   * {@link import('./sql-column-ir').SqlColumnIRInput.many}.
   */
  readonly many?: boolean;
  /**
   * The owning column's codec identity, threaded through so the set-default op-builder renders a
   * list default's cast to the column type the way the column's DDL writes it. See
   * {@link import('./sql-column-ir').SqlColumnIRInput.codecRef}.
   */
  readonly codecRef?: CodecRef;
  /** See {@link import('./sql-column-ir').SqlColumnIRInput.codecBaseNativeType}. */
  readonly codecBaseNativeType?: string;
}

/**
 * Schema-diff node for a column's default value. The default is the one
 * column attribute with an extra/missing/drift lifecycle of its own, so it
 * is a child node of the column rather than a compared attribute: an
 * undeclared live default surfaces as `not-expected`, a declared default the
 * database lacks as `not-found`, and a divergent value as `not-equal` — the
 * three reasons cover the legacy `extra_default` / `default_missing` /
 * `default_mismatch` vocabulary with no attribute inspection.
 *
 * `id` is a fixed sentinel — a column has at most one default. Built
 * transiently by `SqlColumnIR.children()` from the column's own fields;
 * never constructed by derivation or introspection directly.
 */
export class SqlColumnDefaultIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.columnDefault;

  declare readonly resolved?: ColumnDefault;
  declare readonly raw?: string;
  /** See {@link SqlColumnDefaultIRInput.authored}. Non-enumerable, same reason as {@link many}. */
  declare readonly authored?: ColumnDefault;
  /** See {@link SqlColumnDefaultIRInput.value}. Non-enumerable, same reason as {@link many}. */
  declare readonly value?: SqlDefaultValue;
  /** See {@link SqlColumnDefaultIRInput.unreadable}. Non-enumerable, same reason as {@link many}. */
  declare readonly unreadable?: string;
  /** See {@link SqlColumnDefaultIRInput.expressionValue}. Non-enumerable, same reason as {@link many}. */
  declare readonly expressionValue?: SqlDefaultValue;
  /** See {@link SqlColumnDefaultIRInput.many}. Non-enumerable so it stays out of JSON and structural equality. */
  declare readonly many?: boolean;
  /** See {@link SqlColumnDefaultIRInput.codecRef}. Non-enumerable, same reason as {@link many}. */
  declare readonly codecRef?: CodecRef;
  /** See {@link SqlColumnDefaultIRInput.codecBaseNativeType}. Non-enumerable, same reason as {@link many}. */
  declare readonly codecBaseNativeType?: string;

  constructor(input: SqlColumnDefaultIRInput) {
    super();
    if (input.resolved !== undefined) this.resolved = input.resolved;
    if (input.raw !== undefined) this.raw = input.raw;
    defineNonEnumerable(this, 'authored', input.authored);
    defineNonEnumerable(this, 'value', input.value);
    defineNonEnumerable(this, 'unreadable', input.unreadable);
    defineNonEnumerable(this, 'expressionValue', input.expressionValue);
    defineNonEnumerable(this, 'many', input.many);
    defineNonEnumerable(this, 'codecRef', input.codecRef);
    defineNonEnumerable(this, 'codecBaseNativeType', input.codecBaseNativeType);
    freezeNode(this);
  }

  get id(): string {
    return 'default';
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  static is(node: SqlSchemaIRNode): node is SqlColumnDefaultIR {
    return node.nodeKind === RelationalSchemaNodeKind.columnDefault;
  }

  /**
   * Compares with `this` as the expected side. Two literals compare as values of the column's type
   * when both sides hold one, and as canonical JSON otherwise; a `Date` the column's codec could not
   * read into a value equals nothing. Two expressions compare as text, with
   * case and whitespace ignored outside quotes. An expected expression that writes a literal, read by
   * the column's codec during introspection, matches a reported literal when the two values are
   * equal; when the codec could not read one of them, it compares with the reported text. A resolved
   * side against a raw-only side is a mismatch; two raw-only nodes compare their text.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'SqlColumnDefaultIR', SqlColumnDefaultIR.is);
    const expected = this.resolved;
    const actual = node.resolved;
    if (expected?.kind === 'function' && actual === undefined) {
      return node.raw !== undefined && sameExpression(expected.expression, node.raw);
    }
    if (expected === undefined || actual === undefined) {
      return expected === actual && this.raw === node.raw;
    }
    if (expected.kind === 'function') {
      if (actual.kind === 'function') {
        return sameExpression(expected.expression, actual.expression);
      }
      if (node.value !== undefined && node.expressionValue !== undefined) {
        return sqlDefaultValuesEqual(node.expressionValue, node.value);
      }
      return node.raw !== undefined && sameExpression(expected.expression, node.raw);
    }
    if (actual.kind !== 'literal') return false;
    if (this.value !== undefined && node.value !== undefined) {
      return sqlDefaultValuesEqual(this.value, node.value);
    }
    if (expected.value instanceof Date || actual.value instanceof Date) return false;
    return canonicalStringify(expected.value) === canonicalStringify(actual.value);
  }

  /** Why the column's codec could not read the default the database reports, when it could not; otherwise the value each side holds. */
  explainMismatch(actual: DiffableNode | undefined): string | undefined {
    if (!(actual instanceof SqlColumnDefaultIR)) return undefined;
    if (actual.unreadable !== undefined) return actual.unreadable;
    return `The contract holds ${describeDefault(this)}, and the database holds ${describeDefault(actual)}.`;
  }
}

/** A default as a person reads it: a literal as JSON, the value its type read when there is one, an expression as its text, and the text the database reports beside a value read from it. */
function describeDefault(node: SqlColumnDefaultIR): string {
  const resolved = node.resolved;
  if (resolved === undefined) return node.raw ?? 'no default';
  if (resolved.kind === 'function') return resolved.expression;
  const shown = JSON.stringify(
    node.value === undefined ? resolved.value : jsonOfDefaultValue(node.value),
  );
  return node.raw === undefined || node.raw === shown ? shown : `${shown} (${node.raw})`;
}

function isDefaultList(value: SqlDefaultValue): value is readonly (DataTypeValue | null)[] {
  return Array.isArray(value);
}

function jsonOfDefaultValue(value: SqlDefaultValue): JsonValue {
  return isDefaultList(value)
    ? value.map((element) => (element === null ? null : element.value))
    : value.value;
}

function sameExpression(a: string, b: string): boolean {
  return comparableExpression(a) === comparableExpression(b);
}

/** The expression with case and whitespace dropped outside quotes; a quoted literal or identifier keeps both, since they change what it means. */
function comparableExpression(expression: string): string {
  let result = '';
  let quote: string | undefined;
  for (const char of expression) {
    if (quote !== undefined) {
      result += char;
      if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') {
      quote = char;
      result += char;
    } else if (!/\s/.test(char)) {
      result += char.toLowerCase();
    }
  }
  return result;
}
