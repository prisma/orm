import { InternalError } from '@internal/utils/internal-error';
import type { IncludeExpr } from '../types';
import type { Edge } from './edges';
import type { Node } from './nodes';

export type ResultForm = 'rows' | 'first row' | 'count';

export interface GraphResult {
  readonly node: Node | undefined;
  readonly form: ResultForm;
  readonly selectedFields: readonly string[] | undefined;
  readonly includes: readonly IncludeExpr[];
}

export class Graph {
  #nodes: Node[] = [];
  #positions = new Map<Node, number>();
  #inputs = new Map<Node, Edge[]>();
  #users = new Map<Node, Edge[]>();
  #result: GraphResult | undefined = undefined;

  get nodes(): readonly Node[] {
    return this.#nodes;
  }

  get result(): GraphResult | undefined {
    return this.#result;
  }

  add(node: Node, ...inputs: Edge[]): Node | undefined {
    if (this.#positions.has(node)) {
      throw new InternalError('The node is already in the graph');
    }
    for (const input of inputs) {
      if (input.to !== node) {
        throw new InternalError('An input must go to the node being added');
      }
      if (!this.#positions.has(input.from)) {
        throw new InternalError('An input must come from a node in the graph');
      }
    }
    this.#positions.set(node, this.#nodes.length);
    this.#nodes.push(node);
    this.#inputs.set(node, inputs);
    this.#users.set(node, []);
    for (const input of inputs) {
      this.#usersList(input.from).push(input);
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
    const position = this.#positions.get(old);
    if (position === undefined) {
      throw new InternalError('The node to replace is not in the graph');
    }
    if (this.#positions.has(next)) {
      throw new InternalError('The replacement node is already in the graph');
    }
    this.#nodes[position] = next;
    this.#positions.delete(old);
    this.#positions.set(next, position);

    const inputs = this.#inputsList(old).map((edge) => {
      const moved = edge.replaceNode(old, next);
      swap(this.#usersList(edge.from), edge, moved);
      return moved;
    });
    const users = this.#usersList(old).map((edge) => {
      const moved = edge.replaceNode(old, next);
      swap(this.#inputsList(edge.to), edge, moved);
      return moved;
    });
    this.#inputs.delete(old);
    this.#users.delete(old);
    this.#inputs.set(next, inputs);
    this.#users.set(next, users);

    if (this.#result?.node === old) {
      this.#result = { ...this.#result, node: next };
    }
  }

  inputsOf(node: Node): readonly Edge[] {
    return this.#inputs.get(node) ?? [];
  }

  usersOf(node: Node): readonly Edge[] {
    return this.#users.get(node) ?? [];
  }

  setResult(result: GraphResult): void {
    if (result.node !== undefined && !this.#positions.has(result.node)) {
      throw new InternalError('The result node is not in the graph');
    }
    this.#result = result;
  }

  #removeLastAdded(node: Node): void {
    for (const input of this.#inputsList(node)) {
      this.#usersList(input.from).pop();
    }
    this.#nodes.pop();
    this.#positions.delete(node);
    this.#inputs.delete(node);
    this.#users.delete(node);
  }

  #inputsList(node: Node): Edge[] {
    const edges = this.#inputs.get(node);
    if (edges === undefined) {
      throw new InternalError('The node is not in the graph');
    }
    return edges;
  }

  #usersList(node: Node): Edge[] {
    const edges = this.#users.get(node);
    if (edges === undefined) {
      throw new InternalError('The node is not in the graph');
    }
    return edges;
  }
}

function swap(edges: Edge[], old: Edge, next: Edge): void {
  edges[edges.indexOf(old)] = next;
}
