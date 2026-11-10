import type { DiffableNode, SchemaNodeRef } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { isArrayEqual } from '@internal/utils/array-equal';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { nameOf, normalizeIndexOptionValue, type SqlObjectNaming } from '../naming';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import type { SqlAnnotations } from './sql-column-ir';
import { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './sql-schema-ir-node';

/**
 * An index's element structure — exactly one of a column tuple or an opaque
 * expression, unrepresentable-otherwise at the type level. No discriminant
 * is stored (the node keeps flat readonly accessors); the constructor's xor
 * throw stays as the backstop for introspection rows and JSON-derived
 * inputs that bypass this union.
 */
export type SqlIndexElements =
  | {
      /** Column-tuple elements. */
      readonly columns: readonly string[];
      readonly expression?: never;
    }
  | {
      readonly columns?: never;
      /**
       * Opaque SQL: the entire element list between the parens of CREATE
       * INDEX — one string, never parsed.
       */
      readonly expression: string;
    };

export type SqlIndexIRInput = SqlIndexElements & {
  /** The node's identity. Read back off a built node with `namingOf`. */
  readonly naming: SqlObjectNaming;
  /** Opaque SQL: partial-index predicate (WHERE body, without the keyword). */
  readonly where: string | undefined;
  readonly unique: boolean;
  readonly type: string | undefined;
  readonly options: Record<string, unknown> | undefined;
  readonly annotations: SqlAnnotations | undefined;
  /**
   * The index's own column nodes, as root-anchored chains. The derivation
   * stamps them so an index is dropped before the columns it is built on
   * (Postgres auto-drops the index when a covered column goes). An expression
   * index stamps chains to every column of its table — a deterministic
   * over-approximation, since the opaque expression is never parsed. Never
   * compared by `isEqualTo`.
   */
  readonly dependsOn: readonly SchemaNodeRef[] | undefined;
  /**
   * Whether the index is partial (has a row predicate). Required: every
   * producer must assert partiality explicitly, because a partial unique
   * index does not guarantee at-most-one row per key and so cannot back a
   * 1:1 relation — "unknown" must not silently default to "total". Never
   * compared by `isEqualTo` and never serialized.
   */
  readonly partial: boolean;
};

/**
 * Schema IR node for a secondary index as observed by introspection.
 * Unlike the Contract IR `Index`, the Schema IR carries an explicit
 * `unique` field — introspection sees the underlying index regardless
 * of whether the user expressed it as `@@index` or `@@unique`, and the
 * verifier needs to distinguish them when comparing to the Contract.
 *
 * Implements `DiffableNode` so an index is directly a table's diff-tree
 * child. Indexes are name-identified: every index — contract-derived or
 * introspected — carries its full physical name, and `id` is that name.
 * Names are catalog-unique per schema, so two indexes legitimately sharing
 * one column tuple (a unique index beside a redundant plain index) are two
 * distinct siblings, and expression indexes need no column tuple at all.
 *
 * `isEqualTo` is selected by the receiver (the differ always calls
 * `expected.isEqualTo(actual)`) and delegates to {@link contentEquals} —
 * the single node-owned content relation: both modes compare `unique`
 * strict, `type` and option values through the named normalization seams,
 * and `columns` ordered-strict when both sides carry them; an exact-named
 * receiver (`prefix === undefined`) additionally byte-compares
 * `expression`/`where` (both sides are reprints in the supported flow —
 * normalizing would only mask real drift); a wire-named receiver never
 * compares bodies (the wire-name hash already commits to them).
 *
 * `expression`, `where`, and `unique` are genuine SQL-family attributes —
 * functional and partial indexes are standard SQL that any SQL target may
 * introspect, so the family node must represent them; a target declining
 * to author them is a capability decision, not target-specificity.
 */
export class SqlIndexIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.index;

  readonly name: string;
  readonly unique: boolean;
  declare readonly prefix?: string;
  declare readonly columns?: readonly string[];
  declare readonly expression?: string;
  declare readonly where?: string;
  declare readonly type?: string;
  declare readonly options?: Record<string, unknown>;
  declare readonly annotations?: SqlAnnotations;
  /** See {@link SqlIndexIRInput.dependsOn}. Non-enumerable so it stays out of JSON and structural equality, matching `SqlColumnIR.codecRef`. */
  declare readonly dependsOn?: readonly SchemaNodeRef[];
  /** See {@link SqlIndexIRInput.partial}. Non-enumerable so it stays out of JSON and structural equality, matching `dependsOn`. */
  declare readonly partial: boolean;

  constructor(input: SqlIndexIRInput) {
    super();
    const name = nameOf(input.naming);
    if ((input.columns === undefined) === (input.expression === undefined)) {
      throw new InternalError(
        `SqlIndexIR "${name}": exactly one of columns or expression must be set.`,
      );
    }
    this.name = name;
    this.unique = input.unique;
    if (input.naming.kind === 'wire') this.prefix = input.naming.prefix;
    if (input.columns !== undefined) this.columns = input.columns;
    if (input.expression !== undefined) this.expression = input.expression;
    if (input.where !== undefined) this.where = input.where;
    const normalizedType = normalizeIndexType(input.type);
    if (normalizedType !== undefined) this.type = normalizedType;
    if (input.options !== undefined) this.options = input.options;
    if (input.annotations !== undefined) this.annotations = input.annotations;
    defineNonEnumerable(this, 'dependsOn', input.dependsOn);
    defineNonEnumerable(this, 'partial', input.partial);
    freezeNode(this);
  }

  get id(): string {
    return `index:${this.name}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  static from(value: SqlIndexIR | SqlIndexIRInput): SqlIndexIR {
    return value instanceof SqlIndexIR ? value : new SqlIndexIR(value);
  }

  static is(node: SqlSchemaIRNode): node is SqlIndexIR {
    return node.nodeKind === RelationalSchemaNodeKind.index;
  }

  /**
   * Mode-selected structural equality — see the class doc. Delegates to the
   * single node-owned relation: `columns` compare ordered-strict when both
   * sides carry them; an exact receiver (`prefix === undefined`)
   * byte-compares `expression ?? ''` and `where ?? ''`; a wire-named receiver
   * never compares bodies (the wire-name hash already commits to them).
   */
  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode'
    >(other);
    assertNode(node, 'SqlIndexIR', SqlIndexIR.is);
    return this.contentEquals(node, {
      columnPresence: 'when-both-defined',
      bodies: this.prefix !== undefined ? 'ignored' : 'verbatim',
    });
  }

  /**
   * The single index content-equality relation — every comparer (the differ
   * via {@link isEqualTo}, the planner's rename content-pairing) calls this
   * with its mode-appropriate strictness rather than growing a parallel
   * relation:
   *
   * - `columnPresence: 'when-both-defined'` (the differ's rule) compares
   *   the tuples ordered-strict only when both sides carry them — a paired
   *   node's identity already agreed, so a column node meeting an
   *   expression node skips the tuple.
   * - `columnPresence: 'matching'` (the rename-pairing rule) additionally
   *   requires presence to agree: a column index never pairs an expression
   *   index.
   * - `bodies: 'verbatim'` byte-compares `expression ?? ''` / `where ?? ''`
   *   (absent ≡ empty, no normalization — both sides are reprints in the
   *   supported flow); `bodies: 'ignored'` skips them (wire identity —
   *   the wire-name hash commits to the content).
   *
   * `unique` compares strictly; `type` and option VALUES compare through
   * the named normalization seams below.
   */
  contentEquals(
    other: SqlIndexIR,
    strictness: {
      readonly columnPresence: 'when-both-defined' | 'matching';
      readonly bodies: 'verbatim' | 'ignored';
    },
  ): boolean {
    const columnsEqual =
      strictness.columnPresence === 'matching'
        ? (this.columns === undefined) === (other.columns === undefined) &&
          (this.columns === undefined || isArrayEqual(this.columns, other.columns ?? []))
        : this.columns === undefined ||
          other.columns === undefined ||
          isArrayEqual(this.columns, other.columns);
    const structurallyEqual =
      this.unique === other.unique &&
      normalizeIndexType(this.type) === normalizeIndexType(other.type) &&
      indexOptionsEqual(this.options, other.options) &&
      columnsEqual;
    if (!structurallyEqual) return false;
    if (strictness.bodies === 'ignored') return true;
    return (
      (this.expression ?? '') === (other.expression ?? '') &&
      (this.where ?? '') === (other.where ?? '')
    );
  }
}

/**
 * The btree-default normalization seam: the default access method (`btree`
 * in every supported SQL target) normalizes to absent. Applied at
 * construction — every derivation path (contract tree, introspection, flat
 * family tree) builds through the class, so both compare sides are
 * symmetric by definition — and again inside
 * {@link SqlIndexIR.contentEquals} so the relation holds for any input.
 * The contract JSON and the wire-name content hash keep the authored
 * spelling: `@@index([a], type: "btree")` and `@@index([a])` are distinct
 * wire names — but content-equal after normalization, so a spelling change
 * between them converges as a rename via the planner's content
 * pairing (the hashes differ, so hash pairing never pairs them).
 */
function normalizeIndexType(type: string | undefined): string | undefined {
  return type === 'btree' ? undefined : type;
}

/**
 * Option-bag equality: same key set, values compared through
 * {@link normalizeIndexOptionValue} — Postgres introspection returns
 * reloptions values as catalog-reprint strings (`'70'`, `'on'`) while
 * contract option leaves are typed (number, boolean, string).
 */
function indexOptionsEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  const aKeys = a ? Object.keys(a).sort() : [];
  const bKeys = b ? Object.keys(b).sort() : [];
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
  }
  if (aKeys.length === 0) return true;
  for (const key of aKeys) {
    if (normalizeIndexOptionValue(a?.[key]) !== normalizeIndexOptionValue(b?.[key])) {
      return false;
    }
  }
  return true;
}
