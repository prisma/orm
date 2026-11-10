import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from './sql-node';

export interface PrimaryKeyInput {
  readonly columns: readonly string[];
  readonly name?: string;
}

/**
 * SQL Contract IR node for a table's primary-key constraint.
 */
export class PrimaryKey extends SqlNode {
  readonly columns: readonly string[];
  declare readonly name?: string;

  constructor(input: PrimaryKeyInput) {
    super();
    this.columns = input.columns;
    if (input.name !== undefined) this.name = input.name;
    freezeNode(this);
  }

  static from(value: PrimaryKey | PrimaryKeyInput): PrimaryKey {
    return value instanceof PrimaryKey ? value : new PrimaryKey(value);
  }
}
