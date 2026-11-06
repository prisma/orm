import { resolve } from 'node:path';
import { describeTemporalFallbackEntries } from '@repo/test-utils/temporal-fallback-entries';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

describeTemporalFallbackEntries({
  name: 'MySQL',
  repoRoot: REPO_ROOT,
  publishedPackages: ['@prisma/orm-target-mysql', '@prisma/orm-mysql'],
  internalTarget: {
    name: '@internal/target-mysql',
    dir: resolve(REPO_ROOT, 'packages/3-targets/mysql/1-target'),
    minimumEntries: 15,
  },
  expectedApplicationEntries: [
    '@prisma/orm-target-mysql ./target/runtime',
    '@prisma/orm-target-mysql ./target/codecs',
    '@prisma/orm-target-mysql ./target/types',
    '@prisma/orm-target-mysql ./adapter/runtime',
    '@prisma/orm-target-mysql ./driver/runtime',
    '@prisma/orm-mysql ./runtime',
    '@prisma/orm-mysql ./contract-builder',
  ],
  entriesThatLoadThePolyfill: [
    '@prisma/orm-target-mysql ./target/control',
    '@prisma/orm-mysql ./config',
    '@prisma/orm-mysql ./control',
    '@prisma/orm-mysql ./target/control',
  ],
  decode: {
    lookupFactory: 'createMysqlBuiltinCodecLookup',
    codecId: 'mysql/datetime-temporal@1',
    contractValue: '2024-01-01T00:00:00',
    decoded: '2024-01-01T00:00:00Z',
  },
  applicationLoadsWithoutControl: [
    ['the runtime entry', ['./runtime']],
    ['the runtime and contract builder entries', ['./runtime', './contract-builder']],
  ],
});
