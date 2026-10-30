import { resolve } from 'node:path';
import { describeTemporalFallbackEntries } from '@repo/test-utils/temporal-fallback-entries';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

describeTemporalFallbackEntries({
  name: 'MongoDB',
  repoRoot: REPO_ROOT,
  publishedPackages: ['@prisma/orm-target-mongo', '@prisma/orm-mongo'],
  internalTarget: {
    name: '@internal/target-mongo',
    dir: resolve(REPO_ROOT, 'packages/3-targets/mongo/1-target'),
    minimumEntries: 8,
  },
  minimumApplicationEntries: 60,
  expectedApplicationEntries: [
    '@prisma/orm-target-mongo ./target/runtime',
    '@prisma/orm-target-mongo ./target/codecs',
    '@prisma/orm-target-mongo ./adapter/runtime',
    '@prisma/orm-target-mongo ./driver/runtime',
    '@prisma/orm-mongo ./runtime',
    '@prisma/orm-mongo ./contract-builder',
  ],
  entriesThatLoadThePolyfill: [
    '@prisma/orm-target-mongo ./target',
    '@prisma/orm-target-mongo ./target/control',
    '@prisma/orm-mongo ./config',
    '@prisma/orm-mongo ./control',
    '@prisma/orm-mongo ./target/control',
  ],
  decode: {
    lookupFactory: 'buildStandardCodecRegistry',
    codecId: 'mongo/date-instant@1',
    contractValue: '2024-01-01T00:00:00.000Z',
    decoded: '2024-01-01T00:00:00Z',
  },
  applicationLoadsWithoutControl: [
    ['the runtime entry', ['./runtime']],
    ['the runtime and contract builder entries', ['./runtime', './contract-builder']],
  ],
});
