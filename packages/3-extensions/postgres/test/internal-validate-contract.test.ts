import { describe, expect, it } from 'vitest';
import * as internalEntry from '../src/exports/internal-validate-contract';
import * as runtimeEntry from '../src/exports/runtime';

describe('validatePostgresContract', () => {
  it('is exported from the internal entry and not from the runtime entry', () => {
    expect({
      internal: Object.keys(internalEntry),
      runtime: Object.keys(runtimeEntry).includes('validatePostgresContract'),
    }).toEqual({ internal: ['validatePostgresContract'], runtime: false });
  });
});
