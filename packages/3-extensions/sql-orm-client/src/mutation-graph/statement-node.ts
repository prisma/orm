import type { ProjectionItem } from '@internal/sql-relational-core/ast';
import { Node, type Slots, type StatementAst } from './node';
import type { StateSlot } from './state';

export abstract class StatementNode<
  Inputs extends Slots & StateSlot = Slots & StateSlot,
> extends Node<Inputs> {
  abstract readonly returns: readonly ProjectionItem[];

  abstract readonly statements: readonly StatementAst[];

  abstract withReturning(columns: readonly ProjectionItem[]): StatementNode<Inputs>;
}
