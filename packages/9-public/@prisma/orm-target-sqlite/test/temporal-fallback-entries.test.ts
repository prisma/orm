import { resolve } from 'node:path';
import { describeTemporalFallbackEntries } from '@repo/test-utils/temporal-fallback-entries';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

describeTemporalFallbackEntries({
  name: 'SQLite',
  repoRoot: REPO_ROOT,
  publishedPackages: ['@prisma/orm-target-sqlite', '@prisma/orm-sqlite'],
  internalTarget: {
    name: '@internal/target-sqlite',
    dir: resolve(REPO_ROOT, 'packages/3-targets/sqlite/1-target'),
    minimumEntries: 15,
  },
  expectedApplicationEntries: [
    '@prisma/orm-target-sqlite ./target/runtime',
    '@prisma/orm-target-sqlite ./target/codecs',
    '@prisma/orm-target-sqlite ./target/types',
    '@prisma/orm-target-sqlite ./adapter/runtime',
    '@prisma/orm-target-sqlite ./driver/runtime',
    '@prisma/orm-sqlite ./runtime',
    '@prisma/orm-sqlite ./contract-builder',
  ],
  entriesThatLoadThePolyfill: [
    '@prisma/orm-target-sqlite ./target/control',
    '@prisma/orm-sqlite ./config',
    '@prisma/orm-sqlite ./control',
    '@prisma/orm-sqlite ./target/control',
  ],
  decode: {
    lookupFactory: 'createSqliteBuiltinCodecLookup',
    codecId: 'sqlite/datetime-temporal@1',
    contractValue: '2024-01-01T00:00:00.000Z',
    decoded: '2024-01-01T00:00:00Z',
  },
  applicationLoadsWithoutControl: [
    ['the runtime entry', ['./runtime']],
    ['the runtime and contract builder entries', ['./runtime', './contract-builder']],
  ],
});
