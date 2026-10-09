import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import type { Edge, Input, NodeId } from './edges';
import type { Node } from './nodes';

export type ResultForm = 'rows' | 'first row' | 'count';

export interface GraphResult {
  readonly node: NodeId | undefined;
  readonly form: ResultForm;
  readonly collection: DescribeCollectionRowsOptions;
}

export class Graph {
  #nodes: (Node | undefined)[] = [];
  #in: Edge[][] = [];
  #out: Edge[][] = [];
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

  add(node: Node, ...inputs: Input[]): NodeId {
    const id = this.#nodes.length;
    const edges = inputs.map((input) => input(id));
    this.#nodes.push(node);
    this.#in.push(edges);
    this.#out.push([]);
    for (const edge of edges) {
      this.#out[edge.from]?.push(edge);
    }

    const next = node.peephole(this, id);
    if (next === undefined) {
      this.remove(id);
    } else {
      this.replace(id, next);
    }
    return id;
  }

  replace(id: NodeId, next: Node): void {
    this.#nodes[id] = next;
  }

  remove(id: NodeId): void {
    for (const edge of this.edgesInto(id)) {
      drop(this.#out[edge.from], edge);
    }
    for (const edge of this.edgesOutOf(id)) {
      drop(this.#in[edge.to], edge);
    }
    this.#nodes[id] = undefined;
    this.#in[id] = [];
    this.#out[id] = [];
  }

  nodeAt(id: NodeId): Node | undefined {
    return this.#nodes[id];
  }

  nodes(): readonly (readonly [NodeId, Node])[] {
    return this.#nodes.flatMap((node, id) => (node === undefined ? [] : [[id, node] as const]));
  }

  edgesInto(id: NodeId): readonly Edge[] {
    return this.#in[id] ?? [];
  }

  edgesOutOf(id: NodeId): readonly Edge[] {
    return this.#out[id] ?? [];
  }
}

function drop(edges: Edge[] | undefined, edge: Edge): void {
  edges?.splice(edges.indexOf(edge), 1);
}
