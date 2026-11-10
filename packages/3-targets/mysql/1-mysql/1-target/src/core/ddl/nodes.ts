import {
  type DdlColumn,
  DdlNode,
  type DdlTableConstraint,
} from '@internal/sql-relational-core/ast';

export interface MysqlDdlVisitor<R> {
  createTable(node: MysqlCreateTable): R;
}

export abstract class MysqlDdlNode extends DdlNode {
  abstract accept<R>(visitor: MysqlDdlVisitor<R>): R;
}

export class MysqlCreateTable extends MysqlDdlNode {
  readonly kind = 'create-table' as const;
  readonly table: string;
  readonly ifNotExists: boolean | undefined;
  readonly columns: ReadonlyArray<DdlColumn>;
  readonly constraints: ReadonlyArray<DdlTableConstraint> | undefined;

  constructor(options: {
    readonly table: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }) {
    super();
    this.table = options.table;
    this.ifNotExists = options.ifNotExists;
    this.columns = Object.freeze([...options.columns]);
    this.constraints =
      options.constraints === undefined ? undefined : Object.freeze([...options.constraints]);
    this.freeze();
  }

  override accept<R>(visitor: MysqlDdlVisitor<R>): R {
    return visitor.createTable(this);
  }
}

export type AnyMysqlDdlNode = MysqlCreateTable;
