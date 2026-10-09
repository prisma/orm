import { soleDomainNamespaceId } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { createMockRuntime, getTestContext, withCapabilities } from './helpers';

const flags = baseContract.capabilities;

function postsWith<Caps extends Record<string, Record<string, boolean>>>(capabilities: Caps) {
  const contract = withCapabilities(baseContract, capabilities);
  return new Collection(
    { runtime: createMockRuntime(), context: { ...getTestContext(), contract } },
    'Post',
    {
      namespaceId: soleDomainNamespaceId(contract.domain),
    },
  );
}

test('the four methods take options on a contract with every flag', () => {
  const { collection } = createCollectionFor('Post');

  expectTypeOf(collection.forUpdate()).toEqualTypeOf<typeof collection>();
  collection.forNoKeyUpdate({ nowait: true });
  collection.forShare({ skipLocked: true });
  collection.forKeyShare();
});

test('each method is unusable without its flag', () => {
  const noForUpdate = postsWith({ ...flags, sql: { ...flags.sql, forUpdate: false } });
  const noForShare = postsWith({ ...flags, sql: { ...flags.sql, forShare: false } });
  const noForNoKeyUpdate = postsWith({
    ...flags,
    postgres: { ...flags.postgres, forNoKeyUpdate: false },
  });
  const noForKeyShare = postsWith({
    ...flags,
    postgres: { ...flags.postgres, forKeyShare: false },
  });

  // @ts-expect-error forUpdate needs sql.forUpdate
  noForUpdate.forUpdate();
  // @ts-expect-error forShare needs sql.forShare
  noForShare.forShare();
  // @ts-expect-error forNoKeyUpdate needs postgres.forNoKeyUpdate
  noForNoKeyUpdate.forNoKeyUpdate();
  // @ts-expect-error forKeyShare needs postgres.forKeyShare
  noForKeyShare.forKeyShare();

  noForUpdate.forShare();
});

test('every method is unusable without sql.lockOf', () => {
  const noLockOf = postsWith({ ...flags, sql: { ...flags.sql, lockOf: false } });

  // @ts-expect-error forUpdate needs sql.lockOf
  noLockOf.forUpdate();
  // @ts-expect-error forNoKeyUpdate needs sql.lockOf
  noLockOf.forNoKeyUpdate();
  // @ts-expect-error forShare needs sql.lockOf
  noLockOf.forShare();
  // @ts-expect-error forKeyShare needs sql.lockOf
  noLockOf.forKeyShare();

  noLockOf.where({ id: 1 });
});

test('each option is absent without its flag', () => {
  const noNowait = postsWith({ ...flags, sql: { ...flags.sql, lockNowait: false } });
  const noSkipLocked = postsWith({ ...flags, sql: { ...flags.sql, lockSkipLocked: false } });

  // @ts-expect-error nowait needs sql.lockNowait
  noNowait.forUpdate({ nowait: true });
  noNowait.forUpdate({ skipLocked: true });
  // @ts-expect-error skipLocked needs sql.lockSkipLocked
  noSkipLocked.forUpdate({ skipLocked: true });
  noSkipLocked.forUpdate({ nowait: true });
});

test('nowait with skipLocked is a type error', () => {
  const { collection } = createCollectionFor('Post');

  // @ts-expect-error nowait and skipLocked exclude each other
  collection.forUpdate({ nowait: true, skipLocked: true });
});

test('of is not an option', () => {
  const { collection } = createCollectionFor('Post');

  // @ts-expect-error the ORM always locks the model table
  collection.forUpdate({ of: ['posts'] });
});
