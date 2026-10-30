import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type {
  DeleteAst,
  InsertAst,
  SelectAst,
  SqlStatementStats,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import type { Edge, StorageRow } from './edge';

export type StatementAst = SelectAst | InsertAst | UpdateAst | DeleteAst;

export type Slot = Edge<unknown> | Edge<unknown>[];

export type Slots = Record<string, Slot>;

type OutputOf<E> = E extends Edge<infer Output> ? Output : never;

type OutputsOfSlot<S> = S extends Edge<unknown>[]
  ? readonly (readonly OutputOf<S[number]>[])[] | null
  : readonly OutputOf<S>[];

export type OutputsOf<Inputs extends Slots> = {
  readonly [Name in keyof Inputs]: OutputsOfSlot<Inputs[Name]>;
};

export type Executed = AsyncIterableResult<StorageRow> | Promise<SqlStatementStats>;

export interface Run {
  query(ast: StatementAst): AsyncIterableResult<StorageRow>;
  execute(ast: StatementAst): Promise<SqlStatementStats>;
}

export abstract class Node<Inputs extends Slots = Slots> {
  abstract execute(inputs: OutputsOf<Inputs>, run: Run): Executed;
}
