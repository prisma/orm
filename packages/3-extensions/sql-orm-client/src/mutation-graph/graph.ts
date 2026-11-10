import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  collectTableSources,
  type ProjectionItem,
  type TableSource,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import type { TableStorageCoordinate } from '../table-scope';
import { changedBy, tableKey, type WriteKind } from './changed-by';
import { type ColumnMapping, DataEdge, type Edge, type NodeId, type StorageRow } from './edge';
import { FilterData } from './filter-data';
import type { InputEdges, Node, Slot, Slots, StatementAst } from './node';
import { PayloadData } from './payload-data';
import { Requires } from './requires';
import { Rows } from './rows';
import { type Rule, rulesFor } from './rules';
import { State, StateEdge } from './state';
import { StatementNode } from './statement-node';

export interface Reader {
  readonly reader: NodeId;
  readonly edge: Edge<unknown>;
}

export class Graph {
  readonly #contract: Contract<SqlStorage>;
  readonly #rules: readonly Rule[];
  #ids: NodeId[] = [];
  #nodes: (Node | undefined)[] = [];
  #inputs: Record<string, Slot>[] = [];
  #readers: Reader[][] = [];
  #states = new Map<string, NodeId>();
  #result: NodeId | undefined = undefined;

  constructor(contract: Contract<SqlStorage>) {
    this.#contract = contract;
    this.#rules = rulesFor(contract);
  }

  get result(): NodeId | undefined {
    return this.#result;
  }

  setResult(node: NodeId): void {
    this.#result = node;
  }

  add<Inputs extends Slots>(node: Node<Inputs>): NodeId<Inputs>;
  add<Inputs extends Slots>(node: Node<Inputs>, inputs: NoInfer<InputEdges<Inputs>>): NodeId;
  add<Inputs extends Slots>(node: Node<Inputs>, inputs?: InputEdges<Inputs>): NodeId {
    if (inputs === undefined) {
      return this.#addNode(node);
    }
    for (const rule of this.#rules) {
      const standing = rule(this, node, inputs);
      if (standing !== undefined) {
        return standing;
      }
    }
    const id = this.#addNode(node);
    for (const [slot, edges] of Object.entries<Slot | undefined>(inputs)) {
      for (const edge of [edges ?? []].flat()) {
        this.#addEdge(id, slot, edge);
      }
    }
    return id;
  }

  #addNode<Inputs extends Slots>(node: Node<Inputs>): NodeId<Inputs> {
    if (!(node instanceof StatementNode)) {
      return this.#append(node);
    }
    const stateEdges = tablesReadBy(node.statements).map(
      (table) => new StateEdge(this.#stateOf(table), table),
    );
    const id = this.#append(node);
    for (const edge of stateEdges) {
      this.#connect(id, 'state', edge);
    }
    for (const table of this.#tablesWrittenBy(node.statements)) {
      const state = this.#append(new State(table));
      this.#connect(state, 'write', new StateEdge(id, table));
      this.#states.set(tableKey(table), state);
    }
    return id;
  }

  addFilterDataEdge(
    from: NodeId,
    to: NodeId<{ filter: FilterData[] }>,
    columns: readonly ColumnMapping[],
    changed: Readonly<StorageRow> = {},
  ): void {
    this.#addEdge(to, 'filter', new FilterData(from, columns, changed));
  }

  addPayloadDataEdge(
    from: NodeId,
    to: NodeId<{ payload: PayloadData[] }>,
    columns: readonly ColumnMapping[],
  ): void {
    this.#addEdge(to, 'payload', new PayloadData(from, columns));
  }

  addRowsEdge<Name extends string>(
    from: NodeId,
    to: NodeId<{ [Slot in Name]: Rows | Rows[] }>,
    slot: Name,
    columns: readonly ColumnMapping[],
  ): void {
    this.#addEdge(to, slot, new Rows(from, columns));
  }

  addRequiresEdge(from: NodeId, to: NodeId<{ requires: Requires[] }>): void {
    this.#addEdge(to, 'requires', new Requires(from));
  }

  moveReaders(from: NodeId, to: NodeId): void {
    for (const { reader, edge } of this.readersOf(from)) {
      const moved = edge.withFrom(to);
      const swap = (other: Edge<unknown>) => (other === edge ? moved : other);
      this.#inputs[reader] = Object.fromEntries(
        Object.entries(this.inputsOf(reader)).map(([name, slot]) => [
          name,
          Array.isArray(slot) ? slot.map(swap) : swap(slot),
        ]),
      );
      if (moved instanceof DataEdge) {
        this.#read(to, moved.columns);
      }
      this.#readers[to]?.push({ reader, edge: moved });
    }
    this.#readers[from] = [];
  }

  nodeAt(id: NodeId): Node | undefined {
    return this.#nodes[id];
  }

  latestWriteOf(table: TableSource): NodeId | undefined {
    const state = this.#states.get(tableKey(storageOf(table)));
    if (state === undefined) {
      return undefined;
    }
    const [write] = edgesIn(this.inputsOf(state));
    return write?.from;
  }

  sameState(a: NodeId, b: NodeId, table: TableStorageCoordinate): boolean {
    const stateA = this.#stateEdgeOf(a, table);
    return stateA !== undefined && stateA.from === this.#stateEdgeOf(b, table)?.from;
  }

  columnsReadFrom(id: NodeId): readonly ProjectionItem[] {
    return this.readersOf(id).flatMap(({ edge }) =>
      edge instanceof DataEdge ? edge.columns.map(([source]) => source) : [],
    );
  }

  replace(id: NodeId, next: Node): void {
    this.#nodes[id] = next;
  }

  remove(id: NodeId): void {
    for (const edge of edgesIn(this.inputsOf(id))) {
      this.#readers[edge.from] = this.readersOf(edge.from).filter((entry) => entry.edge !== edge);
    }
    for (const { reader, edge } of this.readersOf(id)) {
      this.#inputs[reader] = Object.fromEntries(
        Object.entries(this.inputsOf(reader)).map(([name, slot]) => [
          name,
          Array.isArray(slot) ? slot.filter((other) => other !== edge) : slot,
        ]),
      );
    }
    this.#nodes[id] = undefined;
    this.#inputs[id] = {};
    this.#readers[id] = [];
  }

  nodes(): readonly (readonly [NodeId, Node])[] {
    return this.#ids.flatMap((id) => {
      const node = this.#nodes[id];
      return node === undefined ? [] : [[id, node] as const];
    });
  }

  inputsOf(id: NodeId): Slots {
    return this.#inputs[id] ?? {};
  }

  readersOf(id: NodeId): readonly Reader[] {
    return this.#readers[id] ?? [];
  }

  #append<Inputs extends Slots>(node: Node<Inputs>): NodeId<Inputs> {
    const id = blindCast<NodeId<Inputs>, 'the position a node is added at is its id'>(
      this.#nodes.length,
    );
    this.#ids.push(id);
    this.#nodes.push(node);
    this.#inputs.push(
      Object.fromEntries(
        Object.entries(node.slots)
          .filter(([, kind]) => kind === 'list')
          .map(([name]) => [name, []]),
      ),
    );
    this.#readers.push([]);
    return id;
  }

  #addEdge(to: NodeId, slot: string, edge: Edge<unknown>): void {
    if (edge instanceof DataEdge) {
      this.#read(edge.from, edge.columns);
    }
    this.#connect(to, slot, edge);
  }

  #connect(to: NodeId, slot: string, edge: Edge<unknown>): void {
    const current = this.inputsOf(to)[slot];
    this.#inputs[to] = {
      ...this.inputsOf(to),
      [slot]: Array.isArray(current) ? [...current, edge] : edge,
    };
    this.#readers[edge.from]?.push({ reader: to, edge });
  }

  #read(from: NodeId, columns: readonly ColumnMapping[]): void {
    const source = this.#nodes[from];
    if (source instanceof StatementNode) {
      this.#nodes[from] = source.withReturning(columns.map(([column]) => column));
    }
  }

  #stateOf(table: TableStorageCoordinate): NodeId {
    const current = this.#states.get(tableKey(table));
    if (current !== undefined) {
      return current;
    }
    const initial = this.#append(new State(table));
    this.#states.set(tableKey(table), initial);
    return initial;
  }

  #stateEdgeOf(id: NodeId, table: TableStorageCoordinate): StateEdge | undefined {
    return edgesIn(this.inputsOf(id)).find(
      (edge): edge is StateEdge =>
        edge instanceof StateEdge &&
        edge.table.namespaceId === table.namespaceId &&
        edge.table.tableName === table.tableName,
    );
  }

  #tablesWrittenBy(statements: readonly StatementAst[]): readonly TableStorageCoordinate[] {
    return uniqueTables(
      statements.flatMap((ast) => {
        const write = writeOf(ast);
        return write === undefined
          ? []
          : changedBy(this.#contract, write.kind, storageOf(write.target));
      }),
    );
  }
}

function edgesIn(slots: Slots): readonly Edge<unknown>[] {
  return Object.values(slots).flat();
}

function tablesReadBy(statements: readonly StatementAst[]): readonly TableStorageCoordinate[] {
  return uniqueTables(statements.flatMap((ast) => collectTableSources(ast).map(storageOf)));
}

function storageOf(source: TableSource): TableStorageCoordinate {
  return {
    namespaceId: blindCast<
      string,
      'The ORM builds every table source with tableSourceForContract, which sets the namespace'
    >(source.namespaceId),
    tableName: source.name,
  };
}

function uniqueTables(
  tables: readonly TableStorageCoordinate[],
): readonly TableStorageCoordinate[] {
  return [...new Map(tables.map((table) => [tableKey(table), table])).values()];
}

function writeOf(
  ast: StatementAst,
): { readonly kind: WriteKind; readonly target: TableSource } | undefined {
  switch (ast.kind) {
    case 'insert':
      return {
        kind: ast.onConflict?.action.kind === 'do-update-set' ? 'update' : 'insert',
        target: ast.table,
      };
    case 'update':
    case 'delete':
      return { kind: ast.kind, target: ast.table };
    case 'select':
      return undefined;
  }
}
