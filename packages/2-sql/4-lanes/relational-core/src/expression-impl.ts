import type { AnyExpression as AstExpression } from './ast/types';
import type { Expression, ScopeField } from './expression';

/**
 * Runtime wrapper around a relational-core AST expression node. Carries ScopeField metadata (codecId, nullable) so aggregate-like combinators can propagate the input codec onto their result.
 *
 * `returnType.codec` records the column-bound codec ref when the field-proxy knows the binding — both the namespaced form (`f.user.email` → `ColumnRef`) and the top-level shortcut (`f.email` → `IdentifierRef`) stamp the ref derived from contract storage. `codecOf(expression)` exposes it for operation implementations forwarding the ref to `toExpr`.
 *
 * `projectionAst` carries the descriptor-lowered rendering of the expression, where a target declares one (e.g. SQLite's `CAST(count(*) AS TEXT)`). Lowering exists to carry the value across the driver boundary, so only the projection site consumes it — predicate and ordering positions (`buildAst()`) keep the plain form, where the rendering would change SQL semantics.
 */
export class ExpressionImpl<T extends ScopeField = ScopeField> implements Expression<T> {
  private readonly ast: AstExpression;
  private readonly projectionAst: AstExpression | undefined;
  readonly returnType: T;

  constructor(ast: AstExpression, returnType: T, projectionAst?: AstExpression) {
    this.ast = ast;
    this.returnType = returnType;
    this.projectionAst = projectionAst;
  }

  buildAst(): AstExpression {
    return this.ast;
  }

  buildProjectionAst(): AstExpression {
    return this.projectionAst ?? this.ast;
  }
}
