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

  it('reports anything else as unexpected, with the why the command gives', () => {
    const plain = new Error('boom');
    const coded = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(
      [plain, coded, 'string failure'].map((error) => {
        const { code, summary, why: reason } = errorFromCaught(error, why).toEnvelope();
        return { code, summary, why: reason };
      }),
    ).toEqual([
      { code: 'CLI.UNEXPECTED', summary: 'Unexpected error', why: why('boom') },
      { code: 'CLI.UNEXPECTED', summary: 'Unexpected error', why: why('no such file') },
      { code: 'CLI.UNEXPECTED', summary: 'Unexpected error', why: why('string failure') },
    ]);
  });
});
