import type { ProjectionItem } from '@internal/sql-relational-core/ast';
import { Node, type Slots } from './node';

export abstract class StatementNode<Inputs extends Slots = Slots> extends Node<Inputs> {
  abstract readonly returns: readonly ProjectionItem[];

  abstract withReturning(columns: readonly ProjectionItem[]): StatementNode<Inputs>;
}
