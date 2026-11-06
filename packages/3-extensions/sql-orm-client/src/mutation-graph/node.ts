import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { DeleteAst, InsertAst, SelectAst, UpdateAst } from '@internal/sql-relational-core/ast';
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

export type Executed = AsyncIterableResult<StorageRow> | Promise<number>;

export interface Run {
  query(ast: StatementAst): AsyncIterableResult<StorageRow>;
  execute(ast: StatementAst): Promise<number>;
}

export type SlotLayout<Inputs extends Slots> = {
  readonly [Name in keyof Inputs]: Inputs[Name] extends Edge<unknown>[]
    ? 'list'
    : Inputs[Name] extends Edge<unknown>
      ? 'one'
      : 'list' | 'one';
};

export abstract class Node<Inputs extends Slots = Slots> {
  abstract readonly slots: SlotLayout<Inputs>;

  abstract execute(inputs: OutputsOf<Inputs>, run: Run): Executed;
}
