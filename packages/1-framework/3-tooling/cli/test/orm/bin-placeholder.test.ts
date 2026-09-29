import { CliStructuredError } from '@internal/errors/control';
import { ok } from '@prisma/cli-engine/protocol';
import { createTestCli } from '@prisma/cli-engine/testing';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { defineOrmCommand } from '../../src/orm/define-command';
import { runCommandAction } from '../../src/utils/next-actions';

/**
 * The engine harness always names the binary `prisma-test`. The real
 * `prisma` bin uses that same substitution with its own name.
 */
const TEST_BIN = 'prisma-test';

describe('the running binary name replaces {bin} when the CLI renders', () => {
  it('prints the binary in human next-step lines instead of a literal {bin}', async () => {
    const cli = createTestCli({
      commands: {
        hint: defineOrmCommand({
          help: { summary: 'Presents a follow-up command' },
          handler: async (_args, ctx) =>
            ok(
              ctx.present(
                { data: { ok: true }, exitCode: 0 },
                {
                  human: () => [{ kind: 'summary', status: 'ok', text: 'Done.' }],
                  stdout: () => [],
                  json: () => ({ ok: true }),
                  next: () => [runCommandAction('Apply the planned operations', '{bin} db update')],
                },
              ),
            ),
        }),
      },
    });

    const run = await cli.run(['hint'], {
      cwd: process.cwd(),
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr);

    expect(run.exitCode).toBe(0);
    expect(rendered).not.toContain('{bin}');
    expect(rendered).toContain(`${TEST_BIN} db update`);
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Apply the planned operations',
        command: `${TEST_BIN} db update`,
      },
    ]);
  });

  it('substitutes {bin} in error advice before the envelope is serialized', async () => {
    const cli = createTestCli({
      commands: {
        boom: defineOrmCommand({
          help: { summary: 'Throws a structured error' },
          handler: async () => {
            throw new CliStructuredError(
              'CLI.CONSENT_TOKEN_UNRESOLVED',
              'Could not resolve consent',
              {
                why: 'Name the database in `db.connection` (or pass `--db <url>`) and run `{bin} db update` again.',
                nextActions: [runCommandAction('Sign the database', '{bin} db sign --db <url>')],
              },
            );
          },
        }),
      },
    });

    const human = await cli.run(['boom'], {
      cwd: process.cwd(),
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(human.stderr);
    const json = await cli.run(['boom', '--json'], { cwd: process.cwd() });
    const terminal = json.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(human.exitCode).toBe(2);
    expect(rendered).not.toContain('{bin}');
    expect(rendered).toContain(`${TEST_BIN} db update`);
    expect(rendered).toContain(`${TEST_BIN} db sign --db <url>`);
    expect(envelope).toMatchObject({
      ok: false,
      nextActions: [
        {
          kind: 'run-command',
          label: 'Sign the database',
          command: `${TEST_BIN} db sign --db <url>`,
        },
      ],
    });
  });
});
