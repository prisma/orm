import { runtimeError } from '@internal/framework-components/runtime';
import { errorInvalidRefName } from '@internal/migration-tools/errors';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { errorFromCaught } from '../../src/control-api/operations/caught-errors';
import { errorRuntime } from '../../src/utils/cli-errors';

const why = (message: string) => `Unexpected error during test: ${message}`;

describe('errorFromCaught', () => {
  it('returns a CLI error unchanged', () => {
    const error = errorRuntime('CLI.UNEXPECTED', 'already structured');
    expect(errorFromCaught(error, why)).toBe(error);
  });

  it('returns a migration tools error unchanged, since it is a CLI error', () => {
    const error = errorInvalidRefName('Bad Name');
    expect(errorFromCaught(error, why)).toBe(error);
  });

  it('reports a library error with a structured code as itself', () => {
    const error = structuredError('CONTRACT.DEFAULT_INVALID', 'Column "t"."c" has a bad default', {
      why: 'The codec refuses it.',
      fix: 'Correct the default.',
      where: { path: 'contract.json' },
      meta: { table: 't', column: 'c' },
    });
    expect(errorFromCaught(error, why).toEnvelope()).toEqual({
      ok: false,
      code: 'CONTRACT.DEFAULT_INVALID',
      severity: 'error',
      summary: 'Column "t"."c" has a bad default',
      why: 'The codec refuses it.',
      fix: 'Correct the default.',
      nextActions: [],
      where: { path: 'contract.json' },
      meta: { table: 't', column: 'c' },
    });
  });

  it('reports a runtime error with a structured code as itself', () => {
    const error = runtimeError('RUNTIME.TYPE_PARAMS_INVALID', "Invalid typeParams for codec 'x'");
    expect(errorFromCaught(error, why).toEnvelope()).toMatchObject({
      code: 'RUNTIME.TYPE_PARAMS_INVALID',
      summary: "Invalid typeParams for codec 'x'",
    });
  });

  it('passes an internal error through, so the command boundary reports it as a bug', () => {
    const error = new InternalError('an invariant broke');
    expect(() => errorFromCaught(error, why)).toThrow(error);
  });

  it('reports anything else as unexpected, with the why the command gives and any code it carries in meta', () => {
    const plain = new Error('boom');
    const coded = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(
      [plain, coded, 'string failure'].map((error) => {
        const { code, summary, why: reason, meta } = errorFromCaught(error, why).toEnvelope();
        return { code, summary, why: reason, meta };
      }),
    ).toEqual([
      { code: 'CLI.UNEXPECTED', summary: 'Unexpected error', why: why('boom'), meta: undefined },
      {
        code: 'CLI.UNEXPECTED',
        summary: 'Unexpected error',
        why: why('no such file'),
        meta: { code: 'ENOENT' },
      },
      {
        code: 'CLI.UNEXPECTED',
        summary: 'Unexpected error',
        why: why('string failure'),
        meta: undefined,
      },
    ]);
  });

  describe('with the connection string the command holds', () => {
    const connection = 'postgresql://alice:hunter2@db.example.com:5432/app';
    const masked = 'postgresql://****:****@db.example.com:5432/app';

    it('removes it from the message, why, fix, next actions and every string in meta of a library error', () => {
      const error = structuredError('DRIVER.CONNECTION_FAILED', `Could not reach ${connection}`, {
        why: `The server at ${connection} refused the connection`,
        fix: `Check that ${connection} is reachable`,
        nextActions: [{ kind: 'run-command', label: 'Connect', command: `psql ${connection}` }],
        meta: { url: connection, attempts: 2, tried: [{ url: connection }] },
      });
      expect(errorFromCaught(error, why, { connection }).toEnvelope()).toEqual({
        ok: false,
        code: 'DRIVER.CONNECTION_FAILED',
        severity: 'error',
        summary: `Could not reach ${masked}`,
        why: `The server at ${masked} refused the connection`,
        fix: `Check that ${masked} is reachable`,
        nextActions: [{ kind: 'run-command', label: 'Connect', command: `psql ${masked}` }],
        meta: { url: masked, attempts: 2, tried: [{ url: masked }] },
      });
    });

    it('removes it from a CLI error and from an unexpected error', () => {
      const cliError = errorRuntime('RUNTIME.X', `Failed at ${connection}`, {
        why: `Because of ${connection}`,
      });
      const reported = [cliError, new Error(`boom at ${connection}`)].map((error) =>
        errorFromCaught(error, why, { connection }).toEnvelope(),
      );
      expect(JSON.stringify(reported)).not.toContain('hunter2');
      expect(
        reported.map(({ code, summary, why: reason }) => ({ code, summary, why: reason })),
      ).toEqual([
        { code: 'RUNTIME.X', summary: `Failed at ${masked}`, why: `Because of ${masked}` },
        { code: 'CLI.UNEXPECTED', summary: 'Unexpected error', why: why(`boom at ${masked}`) },
      ]);
    });
  });
});
