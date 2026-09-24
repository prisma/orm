import { CliStructuredError } from '@internal/errors/control';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import type { ErroredEnvelope, StreamEvent } from '@prisma/cli-engine';
import { ok } from '@prisma/cli-engine/protocol';
import { createTestCli } from '@prisma/cli-engine/testing';
import { describe, expect, it } from 'vitest';
import { defineOrmCommand } from '../../src/orm/define-command';

function cliThatThrows(thrown: unknown) {
  return createTestCli({
    commands: {
      boom: defineOrmCommand({
        help: { summary: 'Throws whatever the test handed it' },
        handler: async () => {
          throw thrown;
        },
      }),
    },
  });
}

function terminalEnvelope(run: { readonly json: readonly StreamEvent[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
}

function erroredEnvelope(run: { readonly json: readonly StreamEvent[] }): ErroredEnvelope {
  const envelope = terminalEnvelope(run);
  if (envelope === undefined || envelope.ok) {
    throw new Error('the run did not settle as an errored envelope');
  }
  return envelope;
}

describe('defineOrmCommand', () => {
  describe('a handler that throws a prisma/prisma structured error', () => {
    const thrown = new CliStructuredError('MIGRATION.SPACE_NOT_FOUND', 'Unknown contract space', {
      why: 'No directory named "billing" exists under the migrations root.',
      fix: 'Run `{bin} migration list` to see every space.',
    });

    it('settles as an errored envelope carrying the dotted code', async () => {
      const run = await cliThatThrows(thrown).run(['boom', '--json'], { cwd: process.cwd() });

      expect(run.exitCode).toBe(2);
      expect(terminalEnvelope(run)).toMatchObject({
        ok: false,
        error: { code: 'MIGRATION.SPACE_NOT_FOUND' },
      });
    });

    it('turns the fix prose into typed next actions and drops the non-protocol fix', async () => {
      const run = await cliThatThrows(thrown).run(['boom', '--json'], { cwd: process.cwd() });
      const envelope = erroredEnvelope(run);

      expect(envelope.nextActions).toEqual([
        { kind: 'user-choice', label: 'Run `{bin} migration list` to see every space.' },
      ]);
      expect(envelope.error).not.toHaveProperty('fix');
    });
  });

  describe('a handler that throws a structuredError() value', () => {
    it('keeps the dotted code rather than reporting an internal error', async () => {
      const thrown = structuredError('CONTRACT.VALIDATION_FAILED', 'Contract is not valid');

      const run = await cliThatThrows(thrown).run(['boom', '--json'], { cwd: process.cwd() });

      expect(terminalEnvelope(run)).toMatchObject({
        ok: false,
        error: { code: 'CONTRACT.VALIDATION_FAILED' },
      });
    });
  });

  describe('a handler that throws a bare Error', () => {
    it('settles as CLI.UNEXPECTED with an empty next-action list', async () => {
      const run = await cliThatThrows(new Error('connection reset')).run(['boom', '--json'], {
        cwd: process.cwd(),
      });

      expect(run.exitCode).toBe(2);
      expect(terminalEnvelope(run)).toMatchObject({
        ok: false,
        error: { code: 'CLI.UNEXPECTED', summary: 'connection reset' },
        nextActions: [],
      });
    });
  });

  describe('a handler that throws an InternalError', () => {
    it('lets it through to the engine, which reports a bug at exit 1', async () => {
      const run = await cliThatThrows(new InternalError('the per-space map was empty')).run(
        ['boom', '--json'],
        { cwd: process.cwd() },
      );

      expect(run.exitCode).toBe(1);
      expect(terminalEnvelope(run)).toMatchObject({
        ok: false,
        error: { code: 'CLI.INTERNAL_ERROR', summary: 'the per-space map was empty' },
      });
    });

    it('does not restate it as a CLI.UNEXPECTED failure at exit 2', async () => {
      const run = await cliThatThrows(new InternalError('invariant broke')).run(
        ['boom', '--json'],
        {
          cwd: process.cwd(),
        },
      );

      expect(erroredEnvelope(run).error.code).not.toBe('CLI.UNEXPECTED');
    });
  });

  describe('a handler that returns normally', () => {
    it('is passed through untouched', async () => {
      const cli = createTestCli({
        commands: {
          fine: defineOrmCommand({
            help: { summary: 'Returns a result' },
            handler: async (_args, ctx) =>
              ok(
                ctx.present(
                  { data: { count: 1 }, exitCode: 0 },
                  {
                    human: () => [],
                    stdout: () => [],
                    json: () => ({ ok: true }),
                    next: () => [],
                  },
                ),
              ),
          }),
        },
      });

      const run = await cli.run(['fine', '--json'], { cwd: process.cwd() });

      expect(run.exitCode).toBe(0);
      expect(terminalEnvelope(run)).toMatchObject({ ok: true });
    });
  });
});
