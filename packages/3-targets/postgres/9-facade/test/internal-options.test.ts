import { describe, expect, it } from 'vitest';
import * as internalEntry from '../src/exports/internal-options';
import * as runtimeEntry from '../src/exports/runtime';

describe('the internal options entry', () => {
  it('exports the option helpers a facade built on postgres() reuses, and the runtime entry does not', () => {
    const helpers = [
      'resolveOptionalPostgresBinding',
      'toDriverCursorOptions',
      'toRuntimeBinding',
      'toRuntimeOptions',
      'validateCursorOptions',
    ];
    expect({
      internal: Object.keys(internalEntry).sort(),
      runtime: Object.keys(runtimeEntry).filter((name) => helpers.includes(name)),
    }).toEqual({ internal: helpers, runtime: [] });
  });
});
