import type { ColumnDefault } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { SqlColumnDefaultIR } from './sql-column-default-ir';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './sql-schema-ir-node';

/**
 * Namespaced annotations for extensibility. Each namespace
 * (e.g. `pg`, `pgvector`) owns its annotations subtree.
 */
export type SqlAnnotations = {
  readonly [namespace: string]: unknown;
};

export interface SqlColumnIRInput {
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  /** Raw database default expression (e.g. `'hello'::text`, `nextval('seq')`). */
  readonly default?: string;
  readonly annotations?: SqlAnnotations;
  /** True when the column is a native array (e.g. `text[]`, `int4[]`). The `nativeType` carries the element type only (e.g. `text`, `int4`). */
  readonly many?: boolean;
  /**
   * Fully resolved native type, comparable across the two diff sides:
   * the contract-derived side stamps the codec-expanded type (typeRef
   * resolved, parameterized types expanded, `[]` appended for arrays);
   * the introspected side stamps the target-normalized type with the same
   * `[]` convention. Stamped at construction by derivation/introspection;
   * absent on raw hand-built nodes.
   */
  readonly resolvedNativeType?: string;
  /**
   * Structured default, comparable across the two diff sides: the
   * contract-derived side stamps the contract's `ColumnDefault`; the
   * introspected side stamps the target default-normalizer's parse of the
   * raw expression. Absent when the column declares no default, or when
   * the introspected raw default could not be parsed.
   */
  readonly resolvedDefault?: ColumnDefault;
  /**
   * The column's resolved codec reference — the identity the migration
   * planner's op-builders resolve DDL type rendering against at plan time
   * (parameterized type expansion, e.g. `character` + `{ length: 36 }` →
   * `character(36)`), calling the same codec hooks the pre-`plan(start,
   * end)` op-path called. Carried the same way the query AST carries
   * `CodecRef` (TML-2456) and the migration DDL renderer (TML-2918).
   * Stamped on the EXPECTED (contract-derived) column at derivation,
   * post-`typeRef` resolution (the referenced storage type's own
   * codec/params, not the column's `typeRef` pointer). Absent on
   * introspected/hand-built nodes — the actual side never renders DDL —
   * and never compared by `isEqualTo`.
   */
  readonly codecRef?: CodecRef;
  /**
   * The column's resolved BASE native type: pre-parameter-expansion,
   * pre-array-suffix (e.g. `character`, not `character(36)` or
   * `character[]`). Distinct from {@link resolvedNativeType} (the EXPANDED
   * comparison value) — DDL rendering re-expands a parameterized type at
   * plan time from this base, so it must not already carry the expansion.
   * Stamped alongside {@link codecRef}.
   */
  readonly codecBaseNativeType?: string;
  /**
   * True when the contract column declared its type via a named
   * `storage.types` reference (`typeRef`) rather than inline fields — the
   * migration planner quotes the base native type as an identifier in this
   * case (e.g. a native enum's type name), matching the pre-`plan(start,
   * end)` rendering exactly.
   */
  readonly codecNamedType?: boolean;
}

/**
 * Schema IR node for a single column on a table, as observed by
 * introspection. Unlike the Contract IR `StorageColumn`, this carries
 * the column's `name` (Schema IR columns are returned as arrays from
 * introspection queries; the parent table re-keys them into a record
 * for downstream consumers).
 *
 * Implements `DiffableNode` so a column is directly a table's diff-tree
 * child: `id` is the column name (unique among a table's columns); `isEqualTo`
 * compares this column's own attributes only — never children, since a
 * column is a leaf. When both sides carry `resolvedNativeType` (stamped at
 * derivation/introspection), the comparison uses the resolved values —
 * resolved native type, nullability, and structured default equality per
 * the relational walk's `columnDefaultsEqual` semantics, with `this` as the
 * expected side. Otherwise it falls back to comparing raw fields.
 */
export class SqlColumnIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.column;

  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  declare readonly default?: string;
  declare readonly annotations?: SqlAnnotations;
  /** True when the column is a native array (e.g. `text[]`, `int4[]`). The `nativeType` carries the element type only (e.g. `text`, `int4`). */
  declare readonly many?: boolean;
  declare readonly resolvedNativeType?: string;
  declare readonly resolvedDefault?: ColumnDefault;
  /** See {@link SqlColumnIRInput.codecRef}. Non-enumerable so it stays out of JSON and structural equality. */
  declare readonly codecRef?: CodecRef;
  /** See {@link SqlColumnIRInput.codecBaseNativeType}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly codecBaseNativeType?: string;
  /** See {@link SqlColumnIRInput.codecNamedType}. Non-enumerable, same reason as {@link codecRef}. */
  declare readonly codecNamedType?: boolean;

  constructor(input: SqlColumnIRInput) {
    super();
    this.name = input.name;
    this.nativeType = input.nativeType;
    this.nullable = input.nullable;
    if (input.default !== undefined) this.default = input.default;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    if (input.many !== undefined) this.many = input.many;
    if (input.resolvedNativeType !== undefined) this.resolvedNativeType = input.resolvedNativeType;
    if (input.resolvedDefault !== undefined) this.resolvedDefault = input.resolvedDefault;
    defineNonEnumerable(this, 'codecRef', input.codecRef);
    defineNonEnumerable(this, 'codecBaseNativeType', input.codecBaseNativeType);
    defineNonEnumerable(this, 'codecNamedType', input.codecNamedType);
    freezeNode(this);
  }

  get id(): string {
    return `column:${this.name}`;
  }

  /**
   * The column's default, when declared/present, is the column's one child
   * node — it has an extra/missing/drift lifecycle of its own, so the differ
   * recurses to it rather than `isEqualTo` comparing it. Built transiently
   * from this column's own fields.
   */
  children(): readonly DiffableNode[] {
    if (this.resolvedDefault === undefined && this.default === undefined) {
      return [];
    }
    return [
      new SqlColumnDefaultIR({
        ...ifDefined('resolved', this.resolvedDefault),
        ...ifDefined('raw', this.default),
        ...ifDefined('nativeTypeContext', this.resolvedNativeType),
        // Contract-derived and introspected columns both set `this.many`
        // directly (with `nativeType` as the bare element type; array-ness
        // never rides on a `[]` suffix). `codecRef.many` is a fallback for
        // hand-built nodes that carry a codec ref without the column-level
        // flag. Either source works for the default node's array-literal
        // rendering.
        ...ifDefined('many', this.many ?? this.codecRef?.many),
        ...ifDefined('codecRef', this.codecRef),
        ...ifDefined('codecBaseNativeType', this.codecBaseNativeType),
        ...ifDefined('codecNamedType', this.codecNamedType),
      }),
    ];
  }

  static is(node: SqlSchemaIRNode): node is SqlColumnIR {
    return node.nodeKind === RelationalSchemaNodeKind.column;
  }

  /**
   * Compares the column's own attributes only — the default lives on the
   * child node. When both sides carry `resolvedNativeType`, the resolved
   * value governs (array-ness rides on its `[]` suffix); otherwise raw
   * fields compare.
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'SqlColumnIR', SqlColumnIR.is);
    if (this.resolvedNativeType !== undefined && node.resolvedNativeType !== undefined) {
      return this.resolvedNativeType === node.resolvedNativeType && this.nullable === node.nullable;
    }
    return (
      this.nativeType === node.nativeType &&
      this.nullable === node.nullable &&
      Boolean(this.many) === Boolean(node.many)
    );
  }
}
