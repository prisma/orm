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
 * The base class of a MySQL `migration.ts`. Each protected method returns the operation its name says, rendered through the MySQL control adapter the migration CLI builds from `prisma.config.ts`.
 */
export abstract class MysqlMigration<
  Start extends Contract<SqlStorage> = Contract<SqlStorage>,
  End extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlMigration<MysqlPlanTargetDetails, 'mysql', Start, End> {
  readonly targetId = 'mysql' as const;

  protected readonly controlAdapter: SqlControlAdapter<'mysql'> | undefined;

  constructor(stack?: ControlStack<'sql', 'mysql'>) {
    super(stack);
    this.controlAdapter =
      stack?.adapter === undefined
        ? undefined
        : blindCast<
            SqlControlAdapter<'mysql'>,
            'the MySQL adapter descriptor creates a SqlControlAdapter<mysql>; the framework types it as the wider ControlAdapterInstance'
          >(stack.adapter.create(stack));
  }

  private adapterFor(operation: string): SqlControlAdapter<'mysql'> {
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
    );
  }

  protected dropTable(options: { readonly table: string }): Op {
    return new DropTableCall(options.table).toOp();
  }

  protected addColumn(options: {
    readonly table: string;
    readonly column: DdlColumn;
  }): Promise<Op> {
    return new AddColumnCall(options.table, options.column).toOp(this.adapterFor('addColumn'));
  }

  protected dropColumn(options: { readonly table: string; readonly column: string }): Op {
    return new DropColumnCall(options.table, options.column).toOp();
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
    ).toOp();
  }

  protected dropIndex(options: { readonly table: string; readonly index: string }): Op {
    return new DropIndexCall(options.table, options.index).toOp();
  }

  protected addUnique(options: {
    readonly table: string;
    readonly name: string;
    readonly columns: readonly string[];
  }): Op {
    return new AddUniqueCall(options.table, options.name, options.columns).toOp();
  }

  protected dropUnique(options: { readonly table: string; readonly name: string }): Op {
    return new DropUniqueCall(options.table, options.name).toOp();
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
    }).toOp();
  }

  protected dropForeignKey(options: { readonly table: string; readonly name: string }): Op {
    return new DropForeignKeyCall(options.table, options.name).toOp();
  }
}
