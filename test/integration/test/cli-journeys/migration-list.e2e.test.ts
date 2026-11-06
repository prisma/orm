import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrationList,
  setupJourney,
  swapContract,
} from '../utils/journey-test-helpers';

/**
 * `migration list` is the first command running on the engine, so this journey
 * is also the proof that the harness works against a real project on disk: a
 * real `prisma.config.ts`, evaluated through the same adapter the binary
 * uses, with the step's directory passed as `cwd` instead of chdir'ed into.
 */
withTempDir(({ createTempDir }) => {
  describe('journey: listing on-disk migrations', () => {
    async function projectWithTwoMigrations(): Promise<JourneyContext> {
      const ctx = setupJourney({ createTempDir });
      await runContractEmit(ctx);
      await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
      swapContract(ctx, 'contract-additive');
      await runContractEmit(ctx);
      await planMigrationAndSelfEmit(ctx, [
        '--name',
        'add-name',
        '--from',
        latestMigrationDirName(ctx),
      ]);
      return ctx;
    }

    it(
      'settles as a completed envelope naming every migration on disk',
      async () => {
        const ctx = await projectWithTwoMigrations();

        const listed = await runMigrationList(ctx, ['--json']);
        const terminal = listed.json.at(-1);

        expect(listed.exitCode).toBe(0);
        expect(terminal).toMatchObject({ kind: 'result', envelope: { ok: true, exitCode: 0 } });
        const list = listed.presented?.data as {
          spaces: ReadonlyArray<{ space: string; migrations: ReadonlyArray<{ name: string }> }>;
        };
        expect(list.spaces.map((space) => space.space)).toEqual(['app']);
        const names = list.spaces[0]?.migrations.map((migration) => migration.name) ?? [];
        expect(names).toHaveLength(2);
        expect(names.some((name) => name.includes('initial'))).toBe(true);
        expect(names.some((name) => name.includes('add_name'))).toBe(true);
      },
      timeouts.coldTransformImport,
    );

    it(
      'draws the tree for the reader on stderr and keeps stdout a frame stream',
      async () => {
        const ctx = await projectWithTwoMigrations();

        const human = await runMigrationList(ctx);
        const json = await runMigrationList(ctx, ['--json']);

        expect(human.stderr).toContain('initial');
        expect(human.stdout).toBe('');
        expect(human.presented?.presentation.human.at(-1)?.kind).toBe('drawing');
        expect(json.presented?.presentation.stdout).toEqual([]);
        for (const line of json.stdout.split('\n').filter((entry) => entry.length > 0)) {
          expect(() => JSON.parse(line)).not.toThrow();
        }
      },
      timeouts.coldTransformImport,
    );

    it(
      'narrows to one contract space',
      async () => {
        const ctx = await projectWithTwoMigrations();

        const listed = await runMigrationList(ctx, ['--space', 'app', '--json']);
        const list = listed.presented?.data as { spaces: ReadonlyArray<{ space: string }> };

        expect(listed.exitCode).toBe(0);
        expect(list.spaces.map((space) => space.space)).toEqual(['app']);
      },
      timeouts.coldTransformImport,
    );

    it(
      'errors with the dotted code and typed next actions for an unknown space',
      async () => {
        const ctx = await projectWithTwoMigrations();

        const listed = await runMigrationList(ctx, ['--space', 'nope', '--json']);
        const terminal = listed.json.at(-1);
        const envelope =
          terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

        expect(listed.exitCode).toBe(2);
        expect(envelope).toMatchObject({
          ok: false,
          error: { code: 'MIGRATION.SPACE_NOT_FOUND' },
        });
        expect(envelope?.nextActions.length).toBeGreaterThan(0);
        expect(envelope?.ok).toBe(false);
        expect(envelope).not.toHaveProperty('error.fix');
      },
      timeouts.coldTransformImport,
    );

    it(
      'reports an empty project without failing',
      async () => {
        const ctx = setupJourney({ createTempDir });

        const listed = await runMigrationList(ctx, ['--json']);

        expect(listed.exitCode).toBe(0);
        expect(listed.presented?.data).toMatchObject({ ok: true });
      },
      timeouts.typeScriptCompilation,
    );
  });
});
