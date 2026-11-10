import { resolve } from 'node:path';
import { describeTemporalFallbackEntries } from '@repo/test-utils/temporal-fallback-entries';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

describeTemporalFallbackEntries({
  name: 'Postgres',
  repoRoot: REPO_ROOT,
  publishedPackages: ['@prisma/orm-target-postgres', '@prisma/orm-postgres'],
  internalTarget: {
    name: '@internal/target-postgres',
    dir: resolve(REPO_ROOT, 'packages/3-targets/postgres/1-target'),
    minimumEntries: 30,
  },
  expectedApplicationEntries: [
    '@prisma/orm-target-postgres ./target/runtime',
    '@prisma/orm-target-postgres ./target/codecs',
    '@prisma/orm-target-postgres ./adapter/runtime',
    '@prisma/orm-target-postgres ./driver/runtime',
    '@prisma/orm-postgres ./runtime',
    '@prisma/orm-postgres ./serverless',
    '@prisma/orm-postgres ./contract-builder',
  ],
  entriesThatLoadThePolyfill: [
    '@prisma/orm-target-postgres ./target/control',
    '@prisma/orm-postgres ./config',
    '@prisma/orm-postgres ./control',
    '@prisma/orm-postgres ./target/control',
  ],
  decode: {
    lookupFactory: 'createPostgresBuiltinCodecLookup',
    codecId: 'pg/timestamptz-temporal@1',
    contractValue: '2024-01-01T00:00:00Z',
    decoded: '2024-01-01T00:00:00Z',
  },
  applicationLoadsWithoutControl: [['the runtime entry', ['./runtime']]],
});
