import { describe, expect, it } from 'vitest';
import { retryCommandFor } from '../../src/control-api/operations/ref-resolution';

const HASH_A = `abcdef${'0'.repeat(58)}`;

describe('retryCommandFor', () => {
  const status = { commandName: 'migration status', canRunOffline: true };
  const migrate = { commandName: 'db migrate', from: undefined, canRunOffline: false };

  it.each([
    {
      args: { ...status, from: undefined, to: undefined },
      retry: '{bin} migration status --from <contract>',
    },
    {
      args: { ...status, from: undefined, to: 'prod' },
      retry: '{bin} migration status --from <contract> --to prod',
    },
    {
      args: { ...status, from: '@db', to: 'prod' },
      retry: '{bin} migration status --from @db --to prod --db $DATABASE_URL',
    },
    {
      args: { ...status, from: HASH_A, to: '@db' },
      retry: `{bin} migration status --from ${HASH_A} --to @db --db $DATABASE_URL`,
    },
    {
      args: { ...migrate, to: 'prod', advanceRef: 'staging' },
      retry: '{bin} db migrate --to prod --advance-ref staging --db $DATABASE_URL',
    },
    { args: { ...migrate, to: undefined }, retry: '{bin} db migrate --db $DATABASE_URL' },
  ])('repeats the flags as given: $retry', ({ args, retry }) => {
    expect(retryCommandFor(args)).toBe(retry);
  });
});
