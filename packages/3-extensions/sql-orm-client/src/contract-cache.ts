import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';

const contractCache = new WeakMap<object, Map<string, unknown>>();

/** Builds a value derived from `contract` once per contract and key. Every key starts with a name that only one function uses, and that function stores its own result type under it. */
export function cachedFor<T>(
  contract: Contract<SqlStorage>,
  key: readonly unknown[],
  build: () => T,
): T {
  let perContract = contractCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    contractCache.set(contract, perContract);
  }
  const cacheKey = JSON.stringify(key);
  if (perContract.has(cacheKey)) {
    return blindCast<
      T,
      'each cache key is built by one function, which stores its own result type'
    >(perContract.get(cacheKey));
  }
  const built = build();
  perContract.set(cacheKey, built);
  return built;
}
