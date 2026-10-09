import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import type { Edge } from './edges';
import type { Node } from './nodes';

export type ResultForm = 'rows' | 'first row' | 'count';

export interface GraphResult {
  readonly node: Node | undefined;
  readonly form: ResultForm;
  readonly collection: DescribeCollectionRowsOptions;
}

interface Entry {
  position: number;
  inputs: Edge[];
  users: Edge[];
}

export class Graph {
  #nodes: Node[] = [];
  #entries = new Map<Node, Entry>();
  #result: GraphResult;

  constructor(form: ResultForm, collection: DescribeCollectionRowsOptions) {
    this.#result = { node: undefined, form, collection };
  }

  get nodes(): readonly Node[] {
    return this.#nodes;
  }

  get result(): GraphResult {
    return this.#result;
  }

  add(node: Node, ...inputs: Edge[]): Node | undefined {
    this.#entries.set(node, { position: this.#nodes.length, inputs, users: [] });
    this.#nodes.push(node);
    for (const input of inputs) {
      this.#entries.get(input.from)?.users.push(input);
    }

    const next = node.peephole(this);
    if (next === undefined) {
      this.#removeLastAdded(node);
      return undefined;
    }
    if (next !== node) {
      this.replace(node, next);
    }
    return next;
  }

  replace(old: Node, next: Node): void {
    const entry = this.#entries.get(old);
    if (entry === undefined) {
      return;
    }
    this.#nodes[entry.position] = next;
    this.#entries.delete(old);
    this.#entries.set(next, {
      position: entry.position,
      inputs: entry.inputs.map((edge) => {
        const moved = edge.replaceNode(old, next);
        swap(this.#entries.get(edge.from)?.users, edge, moved);
        return moved;
      }),
      users: entry.users.map((edge) => {
        const moved = edge.replaceNode(old, next);
        swap(this.#entries.get(edge.to)?.inputs, edge, moved);
        return moved;
      }),
    });

    if (this.#result.node === old) {
      this.#result = { ...this.#result, node: next };
    }
  }

  inputsOf(node: Node): readonly Edge[] {
    return this.#entries.get(node)?.inputs ?? [];
  }

  usersOf(node: Node): readonly Edge[] {
    return this.#entries.get(node)?.users ?? [];
  }

  setResult(node: Node | undefined): void {
    this.#result = { ...this.#result, node };
  }

  #removeLastAdded(node: Node): void {
    for (const input of this.inputsOf(node)) {
      this.#entries.get(input.from)?.users.pop();
    }
    this.#nodes.pop();
    this.#entries.delete(node);
  }
}

function swap(edges: Edge[] | undefined, old: Edge, next: Edge): void {
  edges?.splice(edges.indexOf(old), 1, next);
}
