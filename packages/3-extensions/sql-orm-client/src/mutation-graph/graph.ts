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
  #nodes: (Node | undefined)[] = [];
  #inputs: Record<string, DataEdge[]>[] = [];
  #before: After[][] = [];
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
    const id = this.#nodes.length;
    const slots: Record<string, DataEdge[]> = {};
    for (const slot in inputs) {
      slots[slot] = inputs[slot].map((pending) => pending(id));
    }
    this.#nodes.push(node);
    this.#inputs.push(slots);
    this.#before.push([]);
    this.#out.push([]);
    for (const edge of Object.values(slots).flat()) {
      this.#out[edge.from]?.push(edge);
      this.#nodes[edge.from] = this.#nodes[edge.from]?.alsoReturning(
        edge.columns.map(([source]) => source),
      );
    }

    const next = node.peephole(this, id);
    if (next === undefined) {
      this.remove(id);
    } else {
      this.replace(id, next);
    }
    return id;
  }

  after(from: NodeId, to: NodeId): void {
    const edge = new After(from, to);
    this.#out[from]?.push(edge);
    this.#before[to]?.push(edge);
  }

  replace(id: NodeId, next: Node): void {
    this.#nodes[id] = next;
  }

  remove(id: NodeId): void {
    for (const edge of this.edgesInto(id)) {
      this.#out[edge.from] = this.edgesOutOf(edge.from).filter((other) => other !== edge);
    }
    for (const edge of this.edgesOutOf(id)) {
      const slots = this.#inputs[edge.to] ?? {};
      for (const slot in slots) {
        slots[slot] = (slots[slot] ?? []).filter((other) => other !== edge);
      }
      this.#before[edge.to] = (this.#before[edge.to] ?? []).filter((other) => other !== edge);
    }
    this.#nodes[id] = undefined;
    this.#inputs[id] = {};
    this.#before[id] = [];
    this.#out[id] = [];
  }

  nodeAt(id: NodeId): Node | undefined {
    return this.#nodes[id];
  }

  nodes(): readonly (readonly [NodeId, Node])[] {
    return this.#nodes.flatMap((node, id) => (node === undefined ? [] : [[id, node] as const]));
  }

  inputsOf(id: NodeId): Readonly<Record<string, readonly DataEdge[]>> {
    return this.#inputs[id] ?? {};
  }

  edgesInto(id: NodeId): readonly (DataEdge | After)[] {
    return [...Object.values(this.inputsOf(id)).flat(), ...(this.#before[id] ?? [])];
  }

  edgesOutOf(id: NodeId): readonly (DataEdge | After)[] {
    return this.#out[id] ?? [];
  }
}
