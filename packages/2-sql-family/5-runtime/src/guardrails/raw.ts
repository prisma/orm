import type { PlanMeta } from '@internal/contract/types';

export type LintSeverity = 'error' | 'warn';
export type BudgetSeverity = 'error' | 'warn';

export interface LintFinding {
  readonly code: `LINT.${string}`;
  readonly severity: LintSeverity;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface BudgetFinding {
  readonly code: `BUDGET.${string}`;
  readonly severity: BudgetSeverity;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface RawGuardrailConfig {
  readonly budgets?: {
    readonly unboundedSelectSeverity?: BudgetSeverity;
    readonly estimatedRows?: number;
  };
}

export interface RawGuardrailResult {
  readonly lints: LintFinding[];
  readonly budgets: BudgetFinding[];
  readonly statement: 'select' | 'mutation' | 'other';
}

/**
 * Minimal plan view consumed by raw-SQL guardrails. Structurally satisfied
 * by `SqlExecutionPlan`; declared inline so this module stays decoupled
 * from a specific plan type at the call site.
 */
interface RawGuardrailPlan {
  readonly sql: string;
  readonly meta: PlanMeta;
}

const SELECT_STAR_REGEX = /select\s+\*/i;
const LIMIT_REGEX = /\blimit\b/i;
const MUTATION_PREFIX_REGEX = /^(insert|update|delete|create|alter|drop|truncate)\b/i;

const READ_ONLY_INTENTS = new Set(['read', 'report', 'readonly']);

export function evaluateRawGuardrails(
  plan: RawGuardrailPlan,
  config?: RawGuardrailConfig,
): RawGuardrailResult {
  const lints: LintFinding[] = [];
  const budgets: BudgetFinding[] = [];

  const normalized = normalizeWhitespace(plan.sql);
  const statementType = classifyStatement(normalized);

  if (statementType === 'select') {
    if (SELECT_STAR_REGEX.test(normalized)) {
      lints.push(
        createLint('LINT.SELECT_STAR', 'error', 'Raw SQL plan selects all columns via *', {
          sql: snippet(plan.sql),
        }),
      );
    }

    if (!LIMIT_REGEX.test(normalized)) {
      const severity = config?.budgets?.unboundedSelectSeverity ?? 'error';
      lints.push(
        createLint('LINT.NO_LIMIT', 'warn', 'Raw SQL plan omits LIMIT clause', {
          sql: snippet(plan.sql),
        }),
      );

      budgets.push(
        createBudget(
          'BUDGET.ROWS_EXCEEDED',
          severity,
          'Raw SQL plan is unbounded and may exceed row budget',
          {
            sql: snippet(plan.sql),
            ...(config?.budgets?.estimatedRows !== undefined
              ? { estimatedRows: config.budgets.estimatedRows }
              : {}),
          },
        ),
      );
    }
  }

  if (isMutationStatement(statementType) && isReadOnlyIntent(plan.meta)) {
    lints.push(
      createLint(
        'LINT.READ_ONLY_MUTATION',
        'error',
        'Raw SQL plan mutates data despite read-only intent',
        {
          sql: snippet(plan.sql),
          intent: plan.meta.annotations?.['intent'],
        },
      ),
    );
  }

  return { lints, budgets, statement: statementType };
}

function classifyStatement(sql: string): 'select' | 'mutation' | 'other' {
  const trimmed = sql.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('with')) {
    if (lower.includes('select')) {
      return 'select';
    }
  }

  if (lower.startsWith('select')) {
    return 'select';
  }

  if (MUTATION_PREFIX_REGEX.test(trimmed)) {
    return 'mutation';
  }

  return 'other';
}

function isMutationStatement(statement: 'select' | 'mutation' | 'other'): boolean {
  return statement === 'mutation';
}

function isReadOnlyIntent(meta: PlanMeta): boolean {
  const annotations = meta.annotations as { intent?: string } | undefined;
  const intent =
    typeof annotations?.intent === 'string' ? annotations.intent.toLowerCase() : undefined;
  return intent !== undefined && READ_ONLY_INTENTS.has(intent);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function snippet(sql: string): string {
  return normalizeWhitespace(sql).slice(0, 200);
}

function createLint(
  code: LintFinding['code'],
  severity: LintFinding['severity'],
  message: string,
  details?: Record<string, unknown>,
): LintFinding {
  return { code, severity, message, ...(details ? { details } : {}) };
}

function createBudget(
  code: BudgetFinding['code'],
  severity: BudgetFinding['severity'],
  message: string,
  details?: Record<string, unknown>,
): BudgetFinding {
  return { code, severity, message, ...(details ? { details } : {}) };
}
