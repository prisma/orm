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
  #edges: Edge[] = [];
  #result: GraphResult | undefined = undefined;

  get nodes(): readonly Node[] {
    return this.#nodes;
  }

  get result(): GraphResult | undefined {
    return this.#result;
  }

  add(node: Node, ...inputs: Edge[]): Node | undefined {
    if (this.#nodes.includes(node)) {
      throw new InternalError('The node is already in the graph');
    }
    for (const input of inputs) {
      if (input.to !== node) {
        throw new InternalError('An input must go to the node being added');
      }
      if (!this.#nodes.includes(input.from)) {
        throw new InternalError('An input must come from a node in the graph');
      }
    }
    this.#nodes.push(node);
    this.#edges.push(...inputs);

    const next = node.peephole(this);
    if (next === undefined) {
      this.#remove(node);
      return undefined;
    }
    if (next !== node) {
      this.replace(node, next);
    }
    return next;
  }

  replace(old: Node, next: Node): void {
    const index = this.#nodes.indexOf(old);
    if (index === -1) {
      throw new InternalError('The node to replace is not in the graph');
    }
    if (this.#nodes.includes(next)) {
      throw new InternalError('The replacement node is already in the graph');
    }
    this.#nodes[index] = next;
    this.#edges = this.#edges.map((edge) =>
      edge.from === old || edge.to === old ? edge.replaceNode(old, next) : edge,
    );
    if (this.#result?.node === old) {
      this.#result = { ...this.#result, node: next };
    }
  }

  inputsOf(node: Node): readonly Edge[] {
    return this.#edges.filter((edge) => edge.to === node);
  }

  usersOf(node: Node): readonly Edge[] {
    return this.#edges.filter((edge) => edge.from === node);
  }

  setResult(result: GraphResult): void {
    if (result.node !== undefined && !this.#nodes.includes(result.node)) {
      throw new InternalError('The result node is not in the graph');
    }
    this.#result = result;
  }

  #remove(node: Node): void {
    this.#nodes = this.#nodes.filter((other) => other !== node);
    this.#edges = this.#edges.filter((edge) => edge.from !== node && edge.to !== node);
  }
}
