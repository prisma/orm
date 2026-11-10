import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { PrimaryKey, type PrimaryKeyInput } from './primary-key';
import { RelationalSchemaNodeKind } from './schema-node-kinds';
import { SqlCheckConstraintIR, type SqlCheckConstraintIRInput } from './sql-check-constraint-ir';
import { type SqlAnnotations, SqlColumnIR, type SqlColumnIRInput } from './sql-column-ir';
import { SqlForeignKeyIR, type SqlForeignKeyIRInput } from './sql-foreign-key-ir';
import { SqlIndexIR, type SqlIndexIRInput } from './sql-index-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';
import { SqlUniqueIR, type SqlUniqueIRInput } from './sql-unique-ir';

export interface SqlTableIRInput {
  readonly name: string;
  readonly columns: Record<string, SqlColumnIR | SqlColumnIRInput>;
  readonly foreignKeys: ReadonlyArray<SqlForeignKeyIR | SqlForeignKeyIRInput>;
  readonly uniques: ReadonlyArray<SqlUniqueIR | SqlUniqueIRInput>;
  readonly indexes: ReadonlyArray<SqlIndexIR | SqlIndexIRInput>;
  readonly primaryKey?: PrimaryKey | PrimaryKeyInput;
  readonly annotations?: SqlAnnotations;
  /** Optional check constraints for enum-restricted columns. Omitted when none present. */
  readonly checks?: ReadonlyArray<SqlCheckConstraintIR | SqlCheckConstraintIRInput>;
}

/**
 * Schema IR node for a single table as observed by introspection.
 *
 * Unlike the Contract IR `StorageTable`, this carries the table's
 * `name` — introspection queries return tables as arrays and the
 * verifier keys them into `SqlSchemaIR.tables` afterwards, so the name
 * stays on the table object for downstream call sites that walk
 * `Object.values(schema.tables)`.
 *
 * The constructor normalises nested IR-class fields so downstream
 * walks see a uniform AST regardless of whether the input was a
 * plain-data literal (from introspection) or already-constructed
 * class instances.
 *
 * Implements `DiffableNode` so a flat (single-schema) tree is directly
 * diffable: `id` is the table name; `isEqualTo` is identity (the table's
 * structural drift is entirely expressed by its children); `children()`
 * yields every column, the primary key (when present), every foreign key,
 * unique, index, and check constraint — the same composition and order as
 * the Postgres table node, minus policies.
 */
export class SqlTableIR extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = RelationalSchemaNodeKind.table;

  readonly name: string;
  readonly columns: Readonly<Record<string, SqlColumnIR>>;
  readonly foreignKeys: ReadonlyArray<SqlForeignKeyIR>;
  readonly uniques: ReadonlyArray<SqlUniqueIR>;
  readonly indexes: ReadonlyArray<SqlIndexIR>;
  declare readonly primaryKey?: PrimaryKey;
  declare readonly annotations?: SqlAnnotations;
  declare readonly checks?: ReadonlyArray<SqlCheckConstraintIR>;

  constructor(input: SqlTableIRInput) {
    super();
    this.name = input.name;
    this.columns = Object.freeze(
      Object.fromEntries(
        Object.entries(input.columns).map(([key, col]) => [
          key,
          col instanceof SqlColumnIR ? col : new SqlColumnIR(col),
        ]),
      ),
    );
    this.foreignKeys = Object.freeze(
      input.foreignKeys.map((fk) => (fk instanceof SqlForeignKeyIR ? fk : new SqlForeignKeyIR(fk))),
    );
    this.uniques = Object.freeze(
      input.uniques.map((u) => (u instanceof SqlUniqueIR ? u : new SqlUniqueIR(u))),
    );
    this.indexes = Object.freeze(input.indexes.map(SqlIndexIR.from));
    if (input.primaryKey !== undefined) {
      this.primaryKey = PrimaryKey.from(input.primaryKey);
    }
    if (input.annotations !== undefined) this.annotations = input.annotations;
    if (input.checks !== undefined && input.checks.length > 0) {
      this.checks = Object.freeze(input.checks.map(SqlCheckConstraintIR.from));
    }
    freezeNode(this);
  }

  get id(): string {
    return this.name;
  }

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return [
      ...Object.values(this.columns),
      ...(this.primaryKey ? [this.primaryKey] : []),
      ...this.foreignKeys,
      ...this.uniques,
      ...this.indexes,
      ...(this.checks ?? []),
    ];
  }
}
