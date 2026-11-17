import { describe, expect, it } from 'vitest';
import { evaluateRawGuardrails } from '../src/guardrails/raw';

function makePlan(sql: string, annotations?: Record<string, unknown>) {
  return {
    sql,
    meta: {
      target: 'postgres',
      storageHash: 'test-hash' as never,
      lane: 'raw',
      ...(annotations ? { annotations } : {}),
    },
  } as never;
}

describe('evaluateRawGuardrails — statement classification', () => {
  it('classifies a WITH ... SELECT statement as select', () => {
    const result = evaluateRawGuardrails(makePlan('WITH cte AS (SELECT 1) SELECT * FROM cte'));
    expect(result.statement).toBe('select');
  });

  it('classifies an INSERT statement as mutation', () => {
    const result = evaluateRawGuardrails(makePlan('INSERT INTO users (id) VALUES (1)'));
    expect(result.statement).toBe('mutation');
  });

  it('classifies a non-select, non-mutation statement as other', () => {
    const result = evaluateRawGuardrails(makePlan('EXPLAIN SELECT 1'));
    expect(result.statement).toBe('other');
  });
});

describe('evaluateRawGuardrails — read-only mutation lint', () => {
  it('flags a mutation statement whose intent is in READ_ONLY_INTENTS', () => {
    const result = evaluateRawGuardrails(
      makePlan('DELETE FROM users WHERE id = 1', { intent: 'read' }),
    );
    expect(result.lints).toContainEqual(
      expect.objectContaining({ code: 'LINT.READ_ONLY_MUTATION' }),
    );
  });

  it('does not flag a mutation statement whose intent is not read-only', () => {
    const result = evaluateRawGuardrails(
      makePlan('DELETE FROM users WHERE id = 1', { intent: 'write' }),
    );
    expect(result.lints).not.toContainEqual(
      expect.objectContaining({ code: 'LINT.READ_ONLY_MUTATION' }),
    );
  });

  it('does not flag a mutation statement when intent is undefined', () => {
    const result = evaluateRawGuardrails(makePlan('DELETE FROM users WHERE id = 1'));
    expect(result.lints).not.toContainEqual(
      expect.objectContaining({ code: 'LINT.READ_ONLY_MUTATION' }),
    );
  });

  it('does not flag a mutation statement when annotations are entirely absent', () => {
    const result = evaluateRawGuardrails({
      sql: 'DELETE FROM users WHERE id = 1',
      meta: { target: 'postgres', storageHash: 'test-hash' as never, lane: 'raw' },
    } as never);
    expect(result.lints).not.toContainEqual(
      expect.objectContaining({ code: 'LINT.READ_ONLY_MUTATION' }),
    );
  });
});

describe('evaluateRawGuardrails — unbounded select budget details', () => {
  it('includes estimatedRows in the budget details when provided in config', () => {
    const result = evaluateRawGuardrails(makePlan('SELECT * FROM users'), {
      budgets: { estimatedRows: 5000 },
    });
    expect(result.budgets).toContainEqual(
      expect.objectContaining({
        code: 'BUDGET.ROWS_EXCEEDED',
        details: expect.objectContaining({ estimatedRows: 5000 }),
      }),
    );
  });
});

describe('evaluateRawGuardrails — WITH without SELECT', () => {
  it('classifies a WITH clause with no SELECT keyword as other', () => {
    const result = evaluateRawGuardrails(
      makePlan('WITH cte AS (INSERT INTO users DEFAULT VALUES) INSERT INTO log VALUES (1)'),
    );
    expect(result.statement).toBe('other');
  });
});

describe('evaluateRawGuardrails — select without star', () => {
  it('does not flag LINT.SELECT_STAR for a select that names explicit columns', () => {
    const result = evaluateRawGuardrails(makePlan('SELECT id, name FROM users LIMIT 10'));
    expect(result.lints).not.toContainEqual(expect.objectContaining({ code: 'LINT.SELECT_STAR' }));
  });
});
