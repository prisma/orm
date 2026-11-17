import { runtimeError } from '@internal/framework-components/runtime';
import {
  type AnyFromSource,
  type AnyQueryAst,
  isQueryAst,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { ifDefined } from '@internal/utils/defined';
import { assertNever } from '@internal/utils/internal-error';
import { evaluateRawGuardrails } from '../guardrails/raw';
import type { SqlMiddleware, SqlMiddlewareContext } from './sql-middleware';

export interface LintsOptions {
  readonly severities?: {
    readonly selectStar?: 'warn' | 'error';
    readonly noLimit?: 'warn' | 'error';
    readonly deleteWithoutWhere?: 'warn' | 'error';
    readonly updateWithoutWhere?: 'warn' | 'error';
    readonly readOnlyMutation?: 'warn' | 'error';
  };
  readonly fallbackWhenAstMissing?: 'raw' | 'skip';
}

export interface LintFinding {
  readonly code: `LINT.${string}`;
  readonly severity: 'error' | 'warn';
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

function getFromSourceTableDetail(source: AnyFromSource): string | undefined {
  switch (source.kind) {
    case 'table-source':
      return source.name;
    case 'derived-table-source':
      return source.alias;
    case 'function-source':
      return source.fn;
    // v8 ignore next 4
    default:
      return assertNever(
        source,
        `Unsupported source kind: ${(source satisfies never as { kind: string }).kind}`,
      );
  }
}

function evaluateAstLints(ast: AnyQueryAst): LintFinding[] {
  const findings: LintFinding[] = [];

  switch (ast.kind) {
    case 'delete':
      if (ast.where === undefined) {
        findings.push({
          code: 'LINT.DELETE_WITHOUT_WHERE',
          severity: 'error',
          message:
            'DELETE without WHERE clause blocks execution to prevent accidental full-table deletion',
          details: { table: ast.table.name },
        });
      }
      break;

    case 'update':
      if (ast.where === undefined) {
        findings.push({
          code: 'LINT.UPDATE_WITHOUT_WHERE',
          severity: 'error',
          message:
            'UPDATE without WHERE clause blocks execution to prevent accidental full-table update',
          details: { table: ast.table.name },
        });
      }
      break;

    case 'select':
      if (ast.limit === undefined) {
        const table = ast.from !== undefined ? getFromSourceTableDetail(ast.from) : undefined;
        findings.push({
          code: 'LINT.NO_LIMIT',
          severity: 'warn',
          message: 'Unbounded SELECT may return large result sets',
          ...ifDefined('details', table !== undefined ? { table } : undefined),
        });
      }
      if (ast.selectAllIntent !== undefined) {
        const table = ast.selectAllIntent.table;
        findings.push({
          code: 'LINT.SELECT_STAR',
          severity: 'warn',
          message: 'Query selects all columns via selectAll intent',
          ...ifDefined('details', table !== undefined ? { table } : undefined),
        });
      }
      break;

    case 'insert':
      break;

    case 'raw-query':
      // Raw-SQL ASTs opt out of structural lints (LIMIT / WHERE etc.) —
      // the embedded SQL fragments are caller-authored and the lint's
      // shape-based heuristics don't apply.
      break;

    // v8 ignore next 2
    default:
      assertNever(ast, `Unsupported AST kind: ${(ast satisfies never as { kind: string }).kind}`);
  }

  return findings;
}

function getConfiguredSeverity(code: string, options?: LintsOptions): 'warn' | 'error' | undefined {
  const severities = options?.severities;
  if (!severities) return undefined;

  switch (code) {
    case 'LINT.SELECT_STAR':
      return severities.selectStar;
    case 'LINT.NO_LIMIT':
      return severities.noLimit;
    case 'LINT.DELETE_WITHOUT_WHERE':
      return severities.deleteWithoutWhere;
    case 'LINT.UPDATE_WITHOUT_WHERE':
      return severities.updateWithoutWhere;
    case 'LINT.READ_ONLY_MUTATION':
      return severities.readOnlyMutation;
    default:
      return undefined;
  }
}

/**
 * AST-first lint middleware for SQL plans. When `plan.ast` is a SQL QueryAst, inspects
 * the AST structurally. When `plan.ast` is missing, falls back to raw heuristic
 * guardrails or skips linting depending on `fallbackWhenAstMissing`.
 *
 * Rules (AST-based):
 * - DELETE without WHERE: blocks execution (configurable severity, default error)
 * - UPDATE without WHERE: blocks execution (configurable severity, default error)
 * - Unbounded SELECT: warn/error (severity from noLimit)
 * - SELECT * intent: warn/error (severity from selectStar)
 *
 * Fallback: When ast is missing, `fallbackWhenAstMissing: 'raw'` uses heuristic
 * SQL parsing; `'skip'` skips all lints. Default is `'raw'`.
 */
export function lints(options?: LintsOptions): SqlMiddleware {
  const fallback = options?.fallbackWhenAstMissing ?? 'raw';

  const beforeOperation = async (
    plan: SqlExecutionPlan,
    ctx: SqlMiddlewareContext,
  ): Promise<void> => {
    const findings: LintFinding[] = [];
    if (isQueryAst(plan.ast)) {
      findings.push(...evaluateAstLints(plan.ast));
      // A raw statement has no structural shape to lint (no LIMIT / WHERE
      // clause the runtime authored), but its SQL text still wants the
      // heuristic guardrails. Without this the lint middleware would
      // silently disable both for raw plans.
      if (plan.ast.kind === 'raw-query') {
        findings.push(...evaluateRawGuardrails(plan).lints);
      }
    } else if (fallback !== 'skip') {
      findings.push(...evaluateRawGuardrails(plan).lints);
    }

    for (const lint of findings) {
      const configuredSeverity = getConfiguredSeverity(lint.code, options);
      const effectiveSeverity = configuredSeverity ?? lint.severity;

      if (effectiveSeverity === 'error') {
        throw runtimeError(lint.code, lint.message, lint.details);
      }
      if (effectiveSeverity === 'warn') {
        ctx.log.warn({
          code: lint.code,
          message: lint.message,
          details: lint.details,
        });
      }
    }
  };

  return Object.freeze({
    name: 'lints',
    familyId: 'sql' as const,
    beforeEncode: beforeOperation,
  });
}
