/**
 * The mutation prologue of `executeMigrationPlanCommand` (path resolution,
 * context resolution, from/to resolution, seed phase) runs before the
 * planner-phase try block. A throw there must still surface as
 * notOk(CliStructuredError) — never as an unhandled rejection past the Result
 * contract.
 */
import type { PrismaNextConfig } from '@internal/config-loader';
import { errorInvalidJson } from '@internal/migration-tools/errors';
import { ok } from '@internal/utils/result';
import { describe, expect, it, vi } from 'vitest';

const stubClient = {
  renderContractDts: async () => ok({ contractDts: 'export type Contract = never;\n' }),
};

const mocks = vi.hoisted(() => ({
  resolveMigrationPaths: vi.fn(),
}));

vi.mock('../../src/utils/command-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/command-helpers')>();
  return { ...actual, resolveMigrationPaths: mocks.resolveMigrationPaths };
});

const config = { migrations: { dir: 'migrations' } } as unknown as PrismaNextConfig;

describe('executeMigrationPlanCommand — mutation-prologue guard', () => {
  it('maps a MigrationToolsError thrown in the prologue to a structured failure', async () => {
    const toolsError = errorInvalidJson('/project/prisma.config.ts', 'Unexpected token');
    mocks.resolveMigrationPaths.mockImplementationOnce(() => {
      throw toolsError;
    });
    vi.resetModules();
    const { executeMigrationPlanCommand } = await import(
      '../../src/control-api/operations/migration-plan'
    );

    const result = await executeMigrationPlanCommand(
      { config, cwd: '/project', projectDir: '/project', client: stubClient },
      Date.now(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const envelope = result.failure.toEnvelope();
    expect(envelope.code).toBe('MIGRATION.INVALID_JSON');
    expect(envelope.summary).toBe(toolsError.message);
    expect(envelope.why).toBe(toolsError.why);
  });

  it('maps an unknown prologue throw to the CLI.UNEXPECTED envelope', async () => {
    mocks.resolveMigrationPaths.mockImplementationOnce(() => {
      throw new Error('path resolution exploded');
    });
    vi.resetModules();
    const { executeMigrationPlanCommand } = await import(
      '../../src/control-api/operations/migration-plan'
    );

    const result = await executeMigrationPlanCommand(
      { config, cwd: '/project', projectDir: '/project', client: stubClient },
      Date.now(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const envelope = result.failure.toEnvelope();
    expect(envelope.code).toBe('CLI.UNEXPECTED');
    expect(envelope.why).toBe('Unexpected error during migration plan: path resolution exploded');
  });
});
