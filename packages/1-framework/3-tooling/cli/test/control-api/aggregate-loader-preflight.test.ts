/**
 * Regression lock for TML-2478: pre-flight aggregate loading must surface a
 * structured `notOk` envelope instead of throwing past `handleResult`.
 *
 * `buildReadAggregate`'s terminal catch guards the whole pre-flight assembly
 * (family construction + the on-disk refs / migration-package reads). The
 * property pinned here is its classification contract: a `MigrationToolsError`
 * passes through unchanged; any other throw becomes `errorUnexpected`.
 * Either way the call resolves to a `Result` — it never propagates.
 *
 * The failure is injected through a dependency the function consumes —
 * `config.family.create`, called inside the guarded region — so the test
 * exercises the real catch branch without mocking a shared module (which is
 * unreliable under this package's `isolate: false` vitest config).
 */
import type { PrismaConfig } from '@internal/config/config-types';
import { errorInvalidJson } from '@internal/migration-tools/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReadAggregate } from '../../src/control-api/operations/contract-space-aggregate-loader';

const TARGET = 'postgres';
const TARGET_FAMILY = 'sql';

function makeConfig(familyCreate: () => unknown): PrismaConfig {
  return {
    family: {
      familyId: TARGET_FAMILY,
      create: vi.fn(familyCreate),
    },
    target: {
      id: TARGET,
      familyId: TARGET_FAMILY,
      targetId: TARGET,
      kind: 'target',
      migrations: {},
    },
    adapter: { kind: 'adapter', familyId: TARGET_FAMILY, targetId: TARGET },
    contract: { output: 'contract.json' },
  } as unknown as PrismaConfig;
}

describe('buildReadAggregate — pre-flight loading failures return a structured envelope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a structured failure when pre-flight assembly throws a non-MigrationToolsError', async () => {
    const result = await buildReadAggregate(
      makeConfig(() => {
        throw Object.assign(new Error('EACCES: permission denied, open migrations'), {
          code: 'EACCES',
        });
      }),
      { migrationsDir: '/nonexistent/migrations' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('CLI.UNEXPECTED');
    expect(result.failure.message).toBe('Unexpected error');
    expect(result.failure.why).toContain('EACCES');
  });

  it('passes a MigrationToolsError thrown during pre-flight assembly straight through', async () => {
    const toolsError = errorInvalidJson(
      '/nonexistent/migrations/app/refs/head.json',
      'Unexpected end of JSON input',
    );
    const result = await buildReadAggregate(
      makeConfig(() => {
        throw toolsError;
      }),
      { migrationsDir: '/nonexistent/migrations' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Passed through unchanged (the error is itself a CliStructuredError), not errorUnexpected.
    expect(result.failure).toBe(toolsError);
    expect(result.failure.code).toBe('MIGRATION.INVALID_JSON');
  });
});
