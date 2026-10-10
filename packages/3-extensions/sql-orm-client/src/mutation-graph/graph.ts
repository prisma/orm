import { blindCast } from '@internal/utils/casts';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import { After } from './after';
import type { Edge, NodeId, Pending } from './edge';
import type { Node, Slots } from './node';

export type ResultForm = 'rows' | 'first row' | 'count';

export interface GraphResult {
  readonly node: NodeId | undefined;
  readonly form: ResultForm;
  readonly collection: DescribeCollectionRowsOptions;
}

export type PendingInputs<Inputs extends Slots> = {
  readonly [Slot in keyof Inputs]: readonly Pending<Inputs[Slot][number]>[];
};

type DataEdge = Edge<unknown>;

export class Graph {
  #ids: NodeId[] = [];
  #nodes: (Node | undefined)[] = [];
  #inputs: Record<string, DataEdge[]>[] = [];
  #out: (DataEdge | After)[][] = [];
  #result: GraphResult;

  constructor(form: ResultForm, collection: DescribeCollectionRowsOptions) {
    this.#result = { node: undefined, form, collection };
  }

  get result(): GraphResult {
    return this.#result;
  }

  setResult(node: NodeId): void {
    this.#result = { ...this.#result, node };
  }

  add<Inputs extends Slots>(node: Node<Inputs>, inputs: PendingInputs<Inputs>): NodeId {
    const id = blindCast<NodeId, 'the position a node is added at is its id'>(this.#nodes.length);
    const slots: Record<string, DataEdge[]> = {};
    for (const slot in inputs) {
      slots[slot] = inputs[slot].map((pending) => pending(id));
    }
    this.#ids.push(id);
    this.#nodes.push(node);
    this.#inputs.push(slots);
    this.#out.push([]);
    for (const edge of Object.values(slots).flat()) {
      this.#out[edge.from]?.push(edge);
      this.#nodes[edge.from] = this.#nodes[edge.from]?.alsoReturning(
        edge.columns.map(([source]) => source),
      );
    }
    return id;
  }

  after(from: NodeId, to: NodeId): void {
    this.#out[from]?.push(new After(from, to));
  }

  nodes(): readonly (readonly [NodeId, Node])[] {
    return this.#ids.flatMap((id) => {
      const node = this.#nodes[id];
      return node === undefined ? [] : [[id, node] as const];
    });
  }

  inputsOf(id: NodeId): Readonly<Record<string, readonly DataEdge[]>> {
    return this.#inputs[id] ?? {};
  }

  edgesOutOf(id: NodeId): readonly (DataEdge | After)[] {
    return this.#out[id] ?? [];
  }
}
