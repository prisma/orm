import type { LookUpRegistryKeywords } from '../../src/orm/registry-keywords';

/** For tests that name only listed target packages, which init never looks up. */
export const noRegistryLookup: LookUpRegistryKeywords = async (packageName) => {
  throw new Error(`init looked up ${packageName} on the registry`);
};
