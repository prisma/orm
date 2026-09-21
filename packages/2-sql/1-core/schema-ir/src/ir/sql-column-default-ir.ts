import type { ColumnDefault } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { resolvedDefaultsEqual } from './resolved-default-equality';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './sql-schema-ir-node';

export interface SqlColumnDefaultIRInput {
  /** Structured resolved default (contract-declared or normalizer-parsed). */
  readonly resolved?: ColumnDefault;
  /** Raw database default expression, when known (introspected side). */
  readonly raw?: string;
  /** See {@link import('./sql-column-ir').SqlColumnIRInput.authoredDefault}. */
  readonly authored?: ColumnDefault;
  /**
   * Native-type context for temporal literal normalization — the owning
   * column's resolved native type.
   */
  readonly nativeTypeContext?: string;
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
  /** See {@link import('./sql-column-ir').SqlColumnIRInput.codecNamedType}. */
  readonly codecNamedType?: boolean;
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
  declare readonly nativeTypeContext?: string;
  /** See {@link SqlColumnDefaultIRInput.many}. Non-enumerable so it stays out of JSON and structural equality. */
  declare readonly many?: boolean;
  /** See {@link SqlColumnDefaultIRInput.codecRef}. Non-enumerable, same reason as {@link many}. */
  declare readonly codecRef?: CodecRef;
  /** See {@link SqlColumnDefaultIRInput.codecBaseNativeType}. Non-enumerable, same reason as {@link many}. */
  declare readonly codecBaseNativeType?: string;
  /** See {@link SqlColumnDefaultIRInput.codecNamedType}. Non-enumerable, same reason as {@link many}. */
  declare readonly codecNamedType?: boolean;

  constructor(input: SqlColumnDefaultIRInput) {
    super();
    if (input.resolved !== undefined) this.resolved = input.resolved;
    if (input.raw !== undefined) this.raw = input.raw;
    if (input.nativeTypeContext !== undefined) this.nativeTypeContext = input.nativeTypeContext;
    defineNonEnumerable(this, 'authored', input.authored);
    defineNonEnumerable(this, 'many', input.many);
    defineNonEnumerable(this, 'codecRef', input.codecRef);
    defineNonEnumerable(this, 'codecBaseNativeType', input.codecBaseNativeType);
    defineNonEnumerable(this, 'codecNamedType', input.codecNamedType);
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
   * Structured comparison with `this` as the expected side: both sides
   * resolved compare per the relational walk's `columnDefaultsEqual`
   * semantics; a declared expected default against an unparseable actual
   * (raw present, no resolved parse) is a mismatch; two raw-only nodes fall
   * back to raw string equality.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'SqlColumnDefaultIR', SqlColumnDefaultIR.is);
    if (this.resolved !== undefined && node.resolved !== undefined) {
      return resolvedDefaultsEqual(
        this.resolved,
        node.resolved,
        node.nativeTypeContext ?? this.nativeTypeContext,
      );
    }
    if (this.resolved !== undefined || node.resolved !== undefined) {
      return false;
    }
    return this.raw === node.raw;
  }
}
