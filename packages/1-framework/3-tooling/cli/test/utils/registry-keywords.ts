import type { LookUpRegistryKeywords, LookUpRegistryPeers } from '../../src/orm/registry-keywords';

/** For tests that name only listed facades, which init never looks up. */
export const noRegistryLookup: LookUpRegistryKeywords = async (packageName) => {
  throw new Error(`init looked up ${packageName} on the registry`);
};

/** For tests that never reach the printed Prisma 6 setup, which reads published manifests. */
export const noRegistryPeersLookup: LookUpRegistryPeers = async (packageName) => {
  throw new Error(`init looked up the peers of ${packageName} on the registry`);
};
