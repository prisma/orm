import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { hasContractCapability } from '../collection-contract';
import { deleteRule } from './delete-rule';
import type { NodeId } from './edge';
import { foldRule } from './fold-rule';
import type { Graph } from './graph';
import type { InputEdges, Node, Slots } from './node';
import { readBackRule } from './read-back-rule';

export interface Replacement {
  readonly node: Node;
  readonly inputs: InputEdges<Slots>;
  readonly standsFor: readonly NodeId[];
}

export type Rule = (
  graph: Graph,
  node: Node,
  inputs: InputEdges<Slots>,
) => NodeId | Replacement | undefined;

export function rulesFor(contract: Contract<SqlStorage>): readonly Rule[] {
  return hasContractCapability(contract, 'returning')
    ? [foldRule(contract), deleteRule(contract), readBackRule(contract)]
    : [];
}
