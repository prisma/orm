import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { createControlClient } from '../../src/control-api/client';
import type { EmitContractConfig } from '../../src/control-api/types';
import { createMockComponents, createSourceProvider, emittableContract } from './client-fixtures';

const MISSING = {
  code: 'CONFIG.CONTRACT_TYPES_MODULE_MISSING',
  why: expect.stringContaining('Config.contract.typesModule is not set'),
};

function client() {
  const { mockFamily, mockTarget, mockAdapter } = createMockComponents();
  return createControlClient({ family: mockFamily, target: mockTarget, adapter: mockAdapter });
}

describe('the control client given no types module', () => {
  it.each([
    ['no types module', undefined],
    ['an empty one', ''],
  ])('refuses to emit with %s, as the commands do', async (_, typesModule) => {
    const contractConfig = blindCast<EmitContractConfig, 'a caller that does not type its config'>({
      source: createSourceProvider(),
      output: '/tmp/contract.json',
      typesModule,
    });

    await expect(client().emit({ contractConfig })).rejects.toMatchObject(MISSING);
  });

  it.each([
    ['no types module', undefined],
    ['an empty one', ''],
  ])('refuses to render contract types with %s', async (_, typesModule) => {
    const options = blindCast<
      Parameters<ReturnType<typeof client>['renderContractDts']>[0],
      'a caller that does not type its options'
    >({ contract: emittableContract(), typesModule });

    await expect(client().renderContractDts(options)).rejects.toMatchObject(MISSING);
  });
});
