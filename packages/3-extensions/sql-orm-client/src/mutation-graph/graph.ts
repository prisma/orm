import { blindCast } from '@internal/utils/casts';
import type { Edge, NodeId } from './edge';
import type { Node, Slots } from './node';
import { StatementNode } from './statement-node';

export interface Reader {
  readonly reader: NodeId;
  readonly edge: Edge<unknown>;
}

export class Graph {
  #ids: NodeId[] = [];
  #nodes: (Node | undefined)[] = [];
  #inputs: Slots[] = [];
  #readers: Reader[][] = [];
  #result: NodeId | undefined = undefined;

  get result(): NodeId | undefined {
    return this.#result;
  }

  setResult(node: NodeId): void {
    this.#result = node;
  }

  add<Inputs extends Slots>(node: Node<Inputs>, inputs: Inputs): NodeId {
    const id = blindCast<NodeId, 'the position a node is added at is its id'>(this.#nodes.length);
    this.#ids.push(id);
    this.#nodes.push(node);
    this.#inputs.push(inputs);
    this.#readers.push([]);
    for (const edge of Object.values(inputs).flat()) {
      this.#readers[edge.from]?.push({ reader: id, edge });
      const source = this.#nodes[edge.from];
      if (source instanceof StatementNode) {
        this.#nodes[edge.from] = source.withReturning(edge.columns.map(([column]) => column));
      }
    }
    return id;
  }

  replace(id: NodeId, next: Node): void {
    this.#nodes[id] = next;
  }

  remove(id: NodeId): void {
    for (const edge of Object.values(this.inputsOf(id)).flat()) {
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
}
