import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { freezeNode } from '@internal/framework-components/ir';
import { nameOf, type SqlObjectNaming } from '@internal/sql-schema-ir/naming';
import { SqlNode } from './sql-node';

/**
 * Construction input for {@link CheckConstraint}. Internal seam (built by
 * authoring and by contract-JSON hydration, not by end users).
 */
export interface CheckConstraintInput {
  /** The constraint's identity. Read back off a built node with `namingOf`. */
  readonly naming: SqlObjectNaming;
  /** Opaque SQL: the predicate body, without the surrounding `CHECK (…)`. */
  readonly expression: string;
}

/**
 * SQL Contract IR node for a table-level check constraint, name-identified:
 * `name` is the full physical name; a present `prefix` marks the constraint as
 * wire-named (`name` is `formatWireName(prefix, <8hex>)` over the expression's
 * content hash), an absent `prefix` marks it exact (the name is adopted
 * verbatim). This is the convention indexes and RLS policies already use — see
 * ADR 234, "Content-addressed wire names for Postgres-normalized objects".
 *
 * The predicate is opaque: one SQL string, never parsed and never rendered
 * from structured parts. A database reprints predicates in its own normalized
 * form, so a wire-named check is compared by name — the hash already commits
 * to the expression the contract declared.
 */
export class CheckConstraint extends SqlNode {
  readonly name: string;
  /** Derived from the wire naming arm — presence is the naming-mode discriminator in the flat JSON. */
  declare readonly prefix?: string;
  readonly expression: string;

  constructor(input: CheckConstraintInput) {
    super();
    const name = nameOf(input.naming);
    if (name.length === 0) {
      throw new ContractValidationError(
        'CheckConstraint: every check constraint carries a full physical name.',
        'storage',
      );
    }
    this.name = name;
    if (input.naming.kind === 'wire') this.prefix = input.naming.prefix;
    this.expression = input.expression;
    freezeNode(this);
  }

  /**
   * Normalizes either shape into an instance: an existing `CheckConstraint`
   * passes through, canonical input is constructed. Callers that accept
   * "instance or input" go through this, so the constructor keeps one
   * canonical shape instead of widening to a union.
   */
  static from(value: CheckConstraint | CheckConstraintInput): CheckConstraint {
    return value instanceof CheckConstraint ? value : new CheckConstraint(value);
  }
}
