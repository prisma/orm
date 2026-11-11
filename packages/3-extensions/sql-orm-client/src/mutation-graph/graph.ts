import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  collectTableSources,
  type ProjectionItem,
  type TableSource,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import type { TableStorageCoordinate } from '../table-scope';
import { changedBy, storageOf, tableKey, type WriteKind } from './changed-by';
import { type ColumnMapping, DataEdge, type Edge, type NodeId } from './edge';
import { Find } from './find';
import { FindByKeys } from './find-by-keys';
import type { InputEdges, Node, Slot, Slots, StatementAst } from './node';
import { type Rule, rulesFor } from './rules';
import { State, StateEdge } from './state';
import { StatementNode } from './statement-node';

export interface Reader {
  readonly reader: NodeId;
  readonly edge: Edge<unknown>;
}

export interface Entry {
  readonly id: NodeId;
  readonly node: Node;
  readonly inputs: Slots;
}

export class Graph {
  readonly #contract: Contract<SqlStorage>;
  readonly #rules: readonly Rule[];
  #nodes: (Node | undefined)[] = [];
  #inputs: Record<string, Slot>[] = [];
  #readers: Reader[][] = [];
  #states = new Map<string, NodeId>();
  #forwards = new Map<NodeId, NodeId>();
  #result: NodeId | undefined = undefined;

  constructor(contract: Contract<SqlStorage>) {
    this.#contract = contract;
    this.#rules = rulesFor(contract);
  }

  get result(): NodeId | undefined {
    return this.#result;
  }

  setResult(node: NodeId): void {
    this.#result = this.#resolve(node);
  }

  forward(from: NodeId, to: NodeId): void {
    this.#forwards.set(from, this.#resolve(to));
  }

  add<Inputs extends Slots>(node: Node<Inputs>, inputs: NoInfer<InputEdges<Inputs>>): NodeId {
    const resolved = Object.fromEntries(
      Object.entries<Slot | undefined>(inputs).flatMap(([slot, edges]) =>
        edges === undefined ? [] : [[slot, this.#resolveSlot(edges)]],
      ),
    );
    for (const rule of this.#rules) {
      const standing = rule(this, node, resolved);
      if (typeof standing === 'number') {
        return standing;
      }
      if (standing !== undefined) {
        const id = this.#addWithInputs(standing.node, standing.inputs);
        for (const replaced of standing.standsFor) {
          this.forward(replaced, id);
        }
        return id;
      }
    }
    return this.#addWithInputs(node, resolved);
  }

  #addWithInputs(node: Node, inputs: InputEdges<Slots>): NodeId {
    const id = this.#addNode(node);
    for (const [slot, edges] of Object.entries(inputs)) {
      for (const edge of [edges ?? []].flat()) {
        this.#addEdge(id, slot, edge);
      }
    }
    return id;
  }

  stateEdgesFor(node: StatementNode): StateEdge[] {
    return tablesReadBy(node.statements).map((table) => new StateEdge(this.#stateOf(table), table));
  }

  nodeAt(id: NodeId): Node | undefined {
    return this.#nodes[this.#resolve(id)];
  }

  columnsReadFrom(id: NodeId): readonly ProjectionItem[] {
    return this.#readersAt(this.#resolve(id)).flatMap(({ edge }) =>
      edge instanceof DataEdge ? edge.columns.map(([source]) => source) : [],
    );
  }

  replace(id: NodeId, next: Node): void {
    this.#nodes[this.#resolve(id)] = next;
  }

  removeUnreadFinds(): void {
    const unread = this.nodes().filter(
      ([id, node]) =>
        (node instanceof Find || node instanceof FindByKeys) &&
        id !== this.#result &&
        this.#readersAt(id).length === 0,
    );
    for (const [id] of unread) {
      this.#removeAt(id);
    }
    if (unread.length > 0) {
      this.removeUnreadFinds();
    }
  }

  nodes(): readonly (readonly [NodeId, Node])[] {
    return this.#nodes.flatMap((node, position) =>
      node === undefined ? [] : [[idAt(position), node] as const],
    );
  }

  entries(): readonly Entry[] {
    return this.nodes().map(([id, node]) => ({ id, node, inputs: this.#inputsAt(id) }));
  }

  inputsOf(id: NodeId): Slots {
    return this.#inputsAt(this.#resolve(id));
  }

  readersOf(id: NodeId): readonly Reader[] {
    return this.#readersAt(this.#resolve(id));
  }

  #resolve<Inputs extends Slots>(id: NodeId<Inputs>): NodeId<Inputs> {
    const to = this.#forwards.get(id);
    return to === undefined
      ? id
      : blindCast<NodeId<Inputs>, 'a node stands for a forwarded one in every use of its id'>(
          this.#resolve(to),
        );
  }

  #resolveSlot(slot: Slot): Slot {
    return Array.isArray(slot)
      ? slot.map((edge) => this.#resolveEdge(edge))
      : this.#resolveEdge(slot);
  }

  #resolveEdge(edge: Edge<unknown>): Edge<unknown> {
    const from = this.#resolve(edge.from);
    return from === edge.from ? edge : edge.withFrom(from);
  }

  #inputsAt(id: NodeId): Slots {
    return this.#inputs[id] ?? {};
  }

  #readersAt(id: NodeId): readonly Reader[] {
    return this.#readers[id] ?? [];
  }

  #removeAt(id: NodeId): void {
    for (const edge of edgesIn(this.#inputsAt(id))) {
      this.#readers[edge.from] = this.#readersAt(edge.from).filter((entry) => entry.edge !== edge);
    }
    this.#nodes[id] = undefined;
    this.#inputs[id] = {};
    this.#readers[id] = [];
  }

  #addNode<Inputs extends Slots>(node: Node<Inputs>): NodeId<Inputs> {
    const id = this.#append(node);
    if (!(node instanceof StatementNode)) {
      return id;
    }
    for (const table of this.#tablesWrittenBy(node.statements)) {
      const state = this.#append(new State(table));
      this.#connect(state, 'write', new StateEdge(id, table));
      this.#states.set(tableKey(table), state);
    }
    return id;
  }

  #append<Inputs extends Slots>(node: Node<Inputs>): NodeId<Inputs> {
    const id = idAt<Inputs>(this.#nodes.length);
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
    const current = this.#inputsAt(to)[slot];
    this.#inputs[to] = {
      ...this.#inputsAt(to),
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

function idAt<Inputs extends Slots>(position: number): NodeId<Inputs> {
  return blindCast<NodeId<Inputs>, 'the position a node is added at is its id'>(position);
}

function edgesIn(slots: Slots): readonly Edge<unknown>[] {
  return Object.values(slots).flat();
}

function tablesReadBy(statements: readonly StatementAst[]): readonly TableStorageCoordinate[] {
  return uniqueTables(statements.flatMap((ast) => collectTableSources(ast).map(storageOf)));
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
