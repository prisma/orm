import type { CodecRef } from '@internal/framework-components/codec';
import type { AnyExpression as AstExpression } from '@internal/sql-relational-core/ast';
import type { Expression } from '@internal/sql-relational-core/expression';
import { structuredError } from '@internal/utils/structured-error';
import type { ScopeField } from '../scope';

/**
 * Runtime wrapper around a relational-core AST expression node. Carries ScopeField metadata (codecId, nullable) so aggregate-like combinators can propagate the input codec onto their result.
 *
 * `codec` records the column-bound {@link CodecRef} when the field-proxy knows the binding — both the namespaced form (`f.user.email` → `ColumnRef`) and the top-level shortcut (`f.email` → `IdentifierRef`) stamp the ref derived from contract storage. `codecOf(expression)` exposes it for operation implementations forwarding the ref to `toExpr`.
 *
 * `projectionAst` carries the descriptor-lowered rendering of the expression, where a target declares one (e.g. SQLite's `CAST(count(*) AS TEXT)`). Lowering exists to carry the value across the driver boundary, so only the projection site consumes it — predicate and ordering positions (`buildAst()`) keep the plain form, where the rendering would change SQL semantics.
 */
export class ExpressionImpl<T extends ScopeField = ScopeField> implements Expression<T> {
  private readonly ast: AstExpression;
  private readonly projectionAst: AstExpression | undefined;
  readonly returnType: T;
  readonly codec: CodecRef | undefined;

  constructor(ast: AstExpression, returnType: T, codec?: CodecRef, projectionAst?: AstExpression) {
    this.ast = ast;
    this.returnType = returnType;
    this.codec = codec;
    this.projectionAst = projectionAst;
  }

  buildAst(): AstExpression {
    return this.ast;
  }

  buildProjectionAst(): AstExpression {
    return this.projectionAst ?? this.ast;
  }
}

/**
 * An aggregate whose operation lies outside the SQL aggregate alphabet: the expression exists only in its descriptor-lowered form, so only the projection may consume it.
 *
 * Predicate and ordering positions build the plain form through `buildAst()` and are refused at authoring time — the lowered rendering exists to carry the value across the driver boundary, and comparing or sorting by it inside the database would change SQL semantics (a textual rendering compares lexicographically).
 */
export class ProjectionOnlyExpressionImpl<
  T extends ScopeField = ScopeField,
> extends ExpressionImpl<T> {
  private readonly operation: string;

  constructor(operation: string, lowered: AstExpression, returnType: T) {
    super(lowered, returnType, undefined, lowered);
    this.operation = operation;
  }

  override buildAst(): AstExpression {
    throw structuredError(
      'ORM.AGGREGATE_PROJECTION_ONLY',
      `Aggregate operation '${this.operation}' is projection-only: it has no plain SQL form for HAVING, ORDER BY, or comparison positions.`,
      {
        why: "An operation outside the SQL aggregate alphabet reaches SQL only through its descriptor's lowering hook — a rendering for the driver boundary. HAVING and ORDER BY compare the value inside the database, where that rendering would change SQL semantics.",
        fix: `Project '${this.operation}' in a select and filter or order on the projected value, or use an operation from the SQL aggregate alphabet.`,
        meta: { operation: this.operation },
      },
    );
  }
}

/**
 * The AST to project for an expression: the descriptor-lowered form when the expression carries one, the plain form otherwise. `resolveSelectArgs` calls this where a lane expression becomes a `ProjectionItem` — the one place the value crosses the driver boundary.
 */
export function projectionAstOf(expr: Expression<ScopeField>): AstExpression {
  return expr instanceof ExpressionImpl ? expr.buildProjectionAst() : expr.buildAst();
}
