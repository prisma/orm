import type {
  AnyExpression,
  LimitOffsetValue,
  OrderByItem,
} from '@internal/sql-relational-core/ast';
import type { Graph } from './graph';

export interface TableIdentity {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly modelName: string;
  readonly variantName: string | undefined;
}

export interface FindRead {
  readonly orderBy: readonly OrderByItem[] | undefined;
  readonly offset: LimitOffsetValue | undefined;
  readonly cursor: Readonly<Record<string, unknown>> | undefined;
  readonly distinct: readonly string[] | undefined;
  readonly distinctOn: readonly string[] | undefined;
  readonly limit: LimitOffsetValue | undefined;
}

const defaultRead: FindRead = {
  orderBy: undefined,
  offset: undefined,
  cursor: undefined,
  distinct: undefined,
  distinctOn: undefined,
  limit: undefined,
};

export abstract class Node {
  peephole(_graph: Graph): Node | undefined {
    return this;
  }
}

export class Find extends Node {
  readonly table: TableIdentity;
  readonly where: readonly AnyExpression[];
  readonly read: FindRead;

  constructor(table: TableIdentity, where: readonly AnyExpression[], read: FindRead = defaultRead) {
    super();
    this.table = Object.freeze({ ...table });
    this.where = Object.freeze([...where]);
    this.read = Object.freeze({ ...read });
    Object.freeze(this);
  }
}

export class Update extends Node {
  readonly table: TableIdentity;
  readonly set: Readonly<Record<string, unknown>>;
  readonly where: readonly AnyExpression[];

  constructor(
    table: TableIdentity,
    set: Readonly<Record<string, unknown>>,
    where: readonly AnyExpression[],
  ) {
    super();
    this.table = Object.freeze({ ...table });
    this.set = Object.freeze({ ...set });
    this.where = Object.freeze([...where]);
    Object.freeze(this);
  }

  override peephole(_graph: Graph): Node | undefined {
    return Object.keys(this.set).length === 0 ? undefined : this;
  }
}

export class Delete extends Node {
  readonly table: TableIdentity;
  readonly where: readonly AnyExpression[];

  constructor(table: TableIdentity, where: readonly AnyExpression[]) {
    super();
    this.table = Object.freeze({ ...table });
    this.where = Object.freeze([...where]);
    Object.freeze(this);
  }
}
