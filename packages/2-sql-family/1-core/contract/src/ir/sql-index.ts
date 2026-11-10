import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { freezeNode } from '@internal/framework-components/ir';
import { nameOf, type SqlObjectNaming } from '@internal/sql-schema-ir/naming';
import { SqlNode } from './sql-node';

/**
 * An index's element structure — exactly one of a column tuple or an opaque
 * expression, made unrepresentable-otherwise at the type level. No
 * discriminant is stored: the JSON shape stays flat (`columns` or
 * `expression`, never both), and the runtime xor guard in the constructor
 * remains as the backstop for JSON loads that bypass this input type.
 */
export type IndexElements =
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

/**
 * Construction input for {@link Index}. Internal seam (built by lowering and
 * FK materialization, not by end users), so every non-element key is
 * required and absence is stated explicitly as `undefined` — matching the
 * `SqlIndexIRInput` convention.
 */
export type IndexInput = IndexElements & {
  /** The index's identity. Read back off a built node with `namingOf`. */
  readonly naming: SqlObjectNaming;
  /** Opaque SQL: partial-index predicate (WHERE body, without the keyword). */
  readonly where: string | undefined;
  /** Rendered as CREATE UNIQUE INDEX. */
  readonly unique: boolean;
  readonly type: string | undefined;
  readonly options: Record<string, unknown> | undefined;
};

/**
 * SQL Contract IR node for a table-level secondary index, name-identified:
 * `name` is the full physical name; a present `prefix` marks the index as
 * wire-named (`name` is `formatWireName(prefix, <8hex>)`), an absent `prefix`
 * marks it exact (the name is adopted verbatim).
 *
 * `expression`, `where`, and `unique` are genuine SQL-family attributes —
 * functional and partial indexes are standard SQL supported natively by
 * Postgres and SQLite alike, and the family IR must be able to represent
 * anything any SQL target can introspect. A target declining to AUTHOR them
 * (SQLite's rejection at namespace construction) is a capability decision,
 * not evidence of target-specificity.
 *
 * Note that this class shadows the global TypeScript `Index` lib type
 * at the family-shared name; consumer files that need both should
 * alias one (e.g.
 * `import { Index as SqlIndexNode } from '@internal/sql-contract/types'`).
 */
export class Index extends SqlNode {
  readonly name: string;
  readonly unique: boolean;
  /** Derived from the wire naming arm — presence is the naming-mode discriminator in the flat JSON. */
  declare readonly prefix?: string;
  declare readonly columns?: readonly string[];
  declare readonly expression?: string;
  declare readonly where?: string;
  declare readonly type?: string;
  declare readonly options?: Record<string, unknown>;

  constructor(input: IndexInput) {
    super();
    const name = nameOf(input.naming);
    if (name.length === 0) {
      throw new ContractValidationError(
        'Index: every index carries a full physical name; an expression index must be explicitly named (a default name cannot be derived from an expression).',
        'storage',
      );
    }
    if ((input.columns === undefined) === (input.expression === undefined)) {
      throw new ContractValidationError(
        `Index "${name}": exactly one of columns or expression must be set.`,
        'storage',
      );
    }
    this.name = name;
    this.unique = input.unique;
    if (input.naming.kind === 'wire') this.prefix = input.naming.prefix;
    if (input.columns !== undefined) this.columns = input.columns;
    if (input.expression !== undefined) this.expression = input.expression;
    if (input.where !== undefined) this.where = input.where;
    if (input.type !== undefined) this.type = input.type;
    if (input.options !== undefined) this.options = input.options;
    freezeNode(this);
  }

  static from(value: Index | IndexInput): Index {
    return value instanceof Index ? value : new Index(value);
  }
}
