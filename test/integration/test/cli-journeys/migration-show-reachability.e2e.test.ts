/**
 * `migration show <target>` loads the contract-space aggregate once (tolerant,
 * ungated) so the verb stays reachable when an extension is declared but its
 * migrations directory is not materialised yet — a common fresh-checkout state.
 *
 * This file pins:
 *
 * 1. `migration show` without a target is rejected (target is required).
 * 2. Wrong-grammar diagnostics reach the user in that state (not MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION).
 * 3. A valid app-space migration directory resolves and returns details.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  declarePgvectorExtension,
  type EngineCommandResult,
  type JourneyContext,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrationShow,
  setupJourney,
  timeouts,
} from '../utils/journey-test-helpers';

function errorEnvelope(run: EngineCommandResult) {
  const terminal = run.json.at(-1);
  const envelope =
    terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
  return envelope !== undefined && !envelope.ok ? envelope : undefined;
}

function setupUnmigratedExtensionsState(ctx: JourneyContext): void {
  declarePgvectorExtension(ctx);
  const pgvectorDir = join(ctx.testDir, 'migrations', 'pgvector');
  if (existsSync(pgvectorDir)) {
    rmSync(pgvectorDir, { recursive: true, force: true });
  }
}

function listAppMigrationDirs(ctx: JourneyContext): string[] {
  const appDir = join(ctx.testDir, 'migrations', 'app');
  if (!existsSync(appDir)) return [];
  return readdirSync(appDir).filter(
    (e) => !e.startsWith('.') && !e.startsWith('_') && e !== 'refs',
  );
}

withTempDir(({ createTempDir }) => {
  describe('migration show — reachability without materialised extensions', () => {
    it(
      'rejects invocation with no target',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        setupUnmigratedExtensionsState(ctx);

        const show = await runMigrationShow(ctx, ['--json']);
        expect(show.exitCode, 'show without target exits non-zero').not.toBe(0);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'wrong-grammar input surfaces resolver diagnostic, not aggregate-loader',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        setupUnmigratedExtensionsState(ctx);
        expect(
          existsSync(join(ctx.testDir, 'migrations', 'pgvector')),
          'pgvector space dir is intentionally absent',
        ).toBe(false);

        const show = await runMigrationShow(ctx, ['production', '--json']);
        expect(show.exitCode, 'show exit code is non-zero').not.toBe(0);

        const envelope = errorEnvelope(show);
        expect(envelope, 'response is an error envelope').toBeDefined();
        expect(envelope?.error.code, 'must not be the aggregate-loader code').not.toBe(
          'MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION',
        );
        expect(envelope?.error.meta?.['input'], 'meta echoes the user input verbatim').toBe(
          'production',
        );
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'valid app-space migration resolves and returns details',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        setupUnmigratedExtensionsState(ctx);

        const dirs = listAppMigrationDirs(ctx);
        expect(dirs.length, 'at least one app migration was planned').toBeGreaterThan(0);
        const dirName = dirs[0]!;

        const show = await runMigrationShow(ctx, [dirName, '--json']);
        expect(show.exitCode, 'show exits 0').toBe(0);

        expect(
          show.presented?.data,
          'the presented document describes the migration',
        ).toMatchObject({ ok: true, migration: { space: 'app', name: dirName } });
      },
      timeouts.typeScriptCompilation,
    );
  });
});
