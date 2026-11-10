import type { ControlPolicy } from '@internal/contract/types';
import { freezeNode } from '@internal/framework-components/ir';
import { InternalError } from '@internal/utils/internal-error';
import { CheckConstraint, type CheckConstraintInput } from './check-constraint';
import { ForeignKey, type ForeignKeyInput } from './foreign-key';
import { PrimaryKey, type PrimaryKeyInput } from './primary-key';
import { Index, type IndexInput } from './sql-index';
import { SqlNode } from './sql-node';
import { StorageColumn, type StorageColumnInput } from './storage-column';
import { UniqueConstraint, type UniqueConstraintInput } from './unique-constraint';

export interface StorageTableInput {
  readonly columns: Record<string, StorageColumn | StorageColumnInput>;
  readonly primaryKey?: PrimaryKey | PrimaryKeyInput;
  readonly uniques: ReadonlyArray<UniqueConstraint | UniqueConstraintInput>;
  readonly indexes: ReadonlyArray<Index | IndexInput>;
  readonly foreignKeys: ReadonlyArray<ForeignKey | ForeignKeyInput>;
  readonly control?: ControlPolicy;
  readonly checks?: ReadonlyArray<CheckConstraint | CheckConstraintInput>;
}

/**
 * SQL Contract IR node for a single table entry in a namespace's
 * `tables` map.
 *
 * The constructor normalises nested IR-class fields (columns, primary
 * key, uniques, indexes, foreign keys) into the appropriate class
 * instances so downstream walks see a uniform AST regardless of whether
 * the input was a JSON literal or an already-constructed class.
 *
 * The table's `name` is not on the class — tables are keyed by name in
 * the parent namespace's `tables: Record<string, StorageTable>` map.
 */
export class StorageTable extends SqlNode {
  readonly columns: Readonly<Record<string, StorageColumn>>;
  readonly uniques: ReadonlyArray<UniqueConstraint>;
  readonly indexes: ReadonlyArray<Index>;
  readonly foreignKeys: ReadonlyArray<ForeignKey>;
  declare readonly primaryKey?: PrimaryKey;
  declare readonly control?: ControlPolicy;
  declare readonly checks?: ReadonlyArray<CheckConstraint>;

  constructor(input: StorageTableInput) {
    super();
    this.columns = Object.freeze(
      Object.fromEntries(
        Object.entries(input.columns).map(([name, col]) => [name, StorageColumn.from(col)]),
      ),
    );
    if (input.primaryKey !== undefined) {
      this.primaryKey = PrimaryKey.from(input.primaryKey);
    }
    this.uniques = Object.freeze(input.uniques.map(UniqueConstraint.from));
    this.indexes = Object.freeze(input.indexes.map(Index.from));
    this.foreignKeys = Object.freeze(input.foreignKeys.map(ForeignKey.from));
    if (input.control !== undefined) this.control = input.control;
    if (input.checks !== undefined && input.checks.length > 0) {
      this.checks = Object.freeze(input.checks.map(CheckConstraint.from));
    }
    freezeNode(this);
  }

  /**
   * Runtime guard that a namespace `table` entry is really a `StorageTable`.
   * The compiler already types the entry as `StorageTable`, but a
   * freshly-deserialized contract may carry plain JSON at that slot until
   * hydration; this duck-types the structural shape. Accepts `undefined` so
   * optional-chained entry lookups pass straight through.
   */
  static is(value: StorageTable | undefined): value is StorageTable {
    if (typeof value !== 'object' || value === null) return false;
    return 'columns' in value && 'uniques' in value && 'indexes' in value && 'foreignKeys' in value;
  }

  static assert(
    value: StorageTable | undefined,
    coordinate: string,
  ): asserts value is StorageTable {
    if (!StorageTable.is(value)) {
      throw new InternalError(`Expected a StorageTable at ${coordinate}`);
    }
  }
}
