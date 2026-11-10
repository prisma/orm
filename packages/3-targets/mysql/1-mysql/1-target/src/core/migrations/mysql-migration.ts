import type { Contract } from '@internal/contract/types';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { Migration as SqlMigration } from '@internal/family-sql/migration';
import type { ControlStack } from '@internal/framework-components/control';
import type { ReferentialAction, SqlStorage } from '@internal/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddUniqueCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropForeignKeyCall,
  DropIndexCall,
  DropTableCall,
  DropUniqueCall,
  mysqlMigrationStackMissing,
} from './op-factory-call';
import type { Op } from './operations';
import type { MysqlPlanTargetDetails } from './planner-target-details';

/**
 * The base class of a `migration.ts` for MySQL or a target that extends it, such as MariaDB. Each protected method returns the operation its name says, for the target `targetId` names, rendered through the control adapter the migration CLI builds from `prisma.config.ts`.
 */
export abstract class MysqlMigrationBase<
  TargetId extends string,
  Start extends Contract<SqlStorage> = Contract<SqlStorage>,
  End extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlMigration<MysqlPlanTargetDetails, TargetId, Start, End> {
  abstract override readonly targetId: TargetId;

  protected readonly controlAdapter: SqlControlAdapter<TargetId> | undefined;

  constructor(stack?: ControlStack<'sql', TargetId>) {
    super(stack);
    this.controlAdapter =
      stack?.adapter === undefined
        ? undefined
        : blindCast<
            SqlControlAdapter<TargetId>,
            'the target adapter descriptor creates a SqlControlAdapter for its target; the framework types it as the wider ControlAdapterInstance'
          >(stack.adapter.create(stack));
  }

  private adapterFor(operation: string): SqlControlAdapter<TargetId> {
    if (this.controlAdapter === undefined) throw mysqlMigrationStackMissing(operation);
    return this.controlAdapter;
  }

  protected createTable(options: {
    readonly table: string;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }): Promise<Op> {
    return new CreateTableCall(options.table, options.columns, options.constraints ?? []).toOp(
      this.adapterFor('createTable'),
      this.targetId,
    );
  }

  protected dropTable(options: { readonly table: string }): Op {
    return new DropTableCall(options.table).toOp(undefined, this.targetId);
  }

  protected addColumn(options: {
    readonly table: string;
    readonly column: DdlColumn;
  }): Promise<Op> {
    return new AddColumnCall(options.table, options.column).toOp(
      this.adapterFor('addColumn'),
      this.targetId,
    );
  }

  protected dropColumn(options: { readonly table: string; readonly column: string }): Op {
    return new DropColumnCall(options.table, options.column).toOp(undefined, this.targetId);
  }

  protected createIndex(options: {
    readonly table: string;
    readonly index: string;
    readonly columns: readonly string[];
    readonly unique?: boolean;
  }): Op {
    return new CreateIndexCall(
      options.table,
      options.index,
      options.columns,
      options.unique === true,
    ).toOp(undefined, this.targetId);
  }

  protected dropIndex(options: { readonly table: string; readonly index: string }): Op {
    return new DropIndexCall(options.table, options.index).toOp(undefined, this.targetId);
  }

  protected addUnique(options: {
    readonly table: string;
    readonly name: string;
    readonly columns: readonly string[];
  }): Op {
    return new AddUniqueCall(options.table, options.name, options.columns).toOp(
      undefined,
      this.targetId,
    );
  }

  protected dropUnique(options: { readonly table: string; readonly name: string }): Op {
    return new DropUniqueCall(options.table, options.name).toOp(undefined, this.targetId);
  }

  protected addForeignKey(options: {
    readonly table: string;
    readonly name: string;
    readonly columns: readonly string[];
    readonly references: { readonly table: string; readonly columns: readonly string[] };
    readonly onDelete?: ReferentialAction;
    readonly onUpdate?: ReferentialAction;
  }): Op {
    return new AddForeignKeyCall(options.table, {
      name: options.name,
      columns: options.columns,
      references: options.references,
      ...ifDefined('onDelete', options.onDelete),
      ...ifDefined('onUpdate', options.onUpdate),
    }).toOp(undefined, this.targetId);
  }

  protected dropForeignKey(options: { readonly table: string; readonly name: string }): Op {
    return new DropForeignKeyCall(options.table, options.name).toOp(undefined, this.targetId);
  }
}

/** The base class of a MySQL `migration.ts`. */
export abstract class MysqlMigration<
  Start extends Contract<SqlStorage> = Contract<SqlStorage>,
  End extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends MysqlMigrationBase<'mysql', Start, End> {
  readonly targetId = 'mysql' as const;
}
