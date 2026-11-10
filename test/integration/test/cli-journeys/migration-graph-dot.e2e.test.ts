/**
 * `migration graph --dot` under the engine.
 *
 * DOT is not a `--format` value — the engine reserves that flag — so `--dot`
 * stays a command-owned boolean and the old precedence quirk goes away: in
 * human mode the DOT text is both a human block and the stdout payload. On one
 * shared screen the engine suppresses the stdout mirror and the human block is
 * what the reader sees; with split sinks stdout carries the raw DOT too. In
 * json mode (which a non-TTY stdout selects) the result carries the DOT
 * alongside the graph document instead of replacing it.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrationGraph,
  setupJourney,
  timeouts,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('migration graph — DOT output', () => {
    it(
      'shows DOT on the human screen and carries it on the json result',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        const human = await runMigrationGraph(ctx, ['--dot']);
        expect(human.exitCode, 'graph exit code').toBe(0);
        expect(human.presented?.presentation.stdout?.[0], 'DOT preamble').toBe(
          'digraph migrations {',
        );
        // Both streams are TTYs here — one shared screen — so the engine
        // suppresses the stdout mirror and the human block is the copy the
        // reader sees, on stderr.
        expect(human.stderr, 'DOT reaches the reader').toContain('digraph migrations {');
        expect(human.stdout, 'stdout mirror suppressed on one screen').toBe('');

        // A pipe receives the DOT itself, ready for `dot -Tsvg`.
        const piped = await runMigrationGraph(ctx, ['--dot'], { isTTY: false });
        expect(piped.stdout.split('\n')[0], 'piped DOT preamble').toBe('digraph migrations {');

        // With --json the DOT rides the result rather than shadowing it: a
        // caller that asked for json never receives DOT where json was promised.
        const json = await runMigrationGraph(ctx, ['--dot', '--json']);
        const document = json.presented?.data as { dot: string; spaces: readonly unknown[] };
        expect(json.exitCode, 'graph json exit code').toBe(0);
        expect(document.dot, 'result carries the DOT').toContain('digraph migrations {');
        expect(document.spaces, 'result still carries the graph document').not.toHaveLength(0);
        expect(json.presented?.presentation.stdout, 'no raw DOT on the frame stream').toEqual([]);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'omits the dot field when --dot is absent',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        const graph = await runMigrationGraph(ctx, ['--json']);

        expect(graph.exitCode, 'graph exit code').toBe(0);
        expect(graph.presented?.data).not.toHaveProperty('dot');
        expect(graph.presented?.data).toMatchObject({ ok: true });
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'refuses --legend alongside --dot',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);

        const graph = await runMigrationGraph(ctx, ['--dot', '--legend', '--json']);
        const terminal = graph.json.at(-1);
        const envelope =
          terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

        expect(graph.exitCode, 'graph exit code').toBe(2);
        expect(envelope).toMatchObject({
          ok: false,
          error: { code: 'MIGRATION.LEGEND_HUMAN_ONLY' },
        });
      },
      timeouts.typeScriptCompilation,
    );
  });
});
