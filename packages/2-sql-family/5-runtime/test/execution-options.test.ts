import { describe, expect, it } from 'vitest';
import { toRuntimeOptions } from '../src/execution-options';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';

describe('toRuntimeOptions', () => {
  it('keeps the options the runtime takes and drops extensions', () => {
    const middleware: readonly SqlMiddleware[] = [];
    const log = { info() {}, warn() {}, error() {} };
    expect(
      toRuntimeOptions({ extensions: [], middleware, verifyMarker: false, log, mode: 'strict' }),
    ).toEqual({ middleware, verifyMarker: false, log, mode: 'strict' });
  });

  it('leaves out options that are not set', () => {
    expect(toRuntimeOptions({})).toEqual({});
  });
});
