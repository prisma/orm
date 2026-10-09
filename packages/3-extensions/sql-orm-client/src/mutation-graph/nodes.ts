import type { DeleteAst, SelectAst, UpdateAst } from '@internal/sql-relational-core/ast';
import type { NodeId } from './edges';
import type { Graph } from './graph';

export type StatementAst = SelectAst | UpdateAst | DeleteAst;

export abstract class Node {
  abstract readonly ast: StatementAst;

  peephole(_graph: Graph, _id: NodeId): Node | undefined {
    return this;
  }
}

export class Find extends Node {
  readonly ast: SelectAst;

  constructor(ast: SelectAst) {
    super();
    this.ast = ast;
    Object.freeze(this);
  }
}

export class Update extends Node {
  readonly ast: UpdateAst;

  constructor(ast: UpdateAst) {
    super();
    this.ast = ast;
    Object.freeze(this);
  }

  override peephole(_graph: Graph, _id: NodeId): Node | undefined {
    return Object.keys(this.ast.set).length === 0 ? undefined : this;
  }
}

export class Delete extends Node {
  readonly ast: DeleteAst;

  constructor(ast: DeleteAst) {
    super();
    this.ast = ast;
    Object.freeze(this);
  }
}
