import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from './sql-node';

export interface UniqueConstraintInput {
  readonly columns: readonly string[];
  readonly name?: string;
}

/**
 * SQL Contract IR node for a table-level unique constraint.
 */
export class UniqueConstraint extends SqlNode {
  readonly columns: readonly string[];
  declare readonly name?: string;

  constructor(input: UniqueConstraintInput) {
    super();
    this.columns = input.columns;
    if (input.name !== undefined) this.name = input.name;
    freezeNode(this);
  }

  static from(value: UniqueConstraint | UniqueConstraintInput): UniqueConstraint {
    return value instanceof UniqueConstraint ? value : new UniqueConstraint(value);
  }
}
