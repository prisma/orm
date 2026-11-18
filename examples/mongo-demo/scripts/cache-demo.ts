import { existsSync } from 'node:fs';
import type { CacheAnnotationOptions } from '@prisma/orm-extension-middleware-cache';
import { cacheAnnotation } from '@prisma/orm-extension-middleware-cache';
import type { MongoQueryPlan } from '@prisma/orm-mongo/query-ast/execution';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createClient } from '../src/db';
import { seed } from '../src/seed';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const DB_NAME = 'cache_demo';

/**
 * Attach the read-only `cacheAnnotation` to a Mongo query plan post-build.
 *
 * The Mongo query builder doesn't yet expose a chainable `.annotate(...)`
 * surface (the SQL DSL does), so we thread the annotation through
 * `plan.meta.annotations.cache` directly. The cache middleware reads it
 * via `cacheAnnotation.read(plan)` exactly the same way it does for SQL
 * plans — the package depends only on `@internal/framework-components/runtime`
 * and is family-agnostic by construction.
 */
function withCacheAnnotation<P extends MongoQueryPlan>(
  plan: P,
  options: CacheAnnotationOptions,
): P {
  return {
    ...plan,
    meta: {
      ...plan.meta,
      annotations: {
        ...plan.meta.annotations,
        cache: cacheAnnotation(options),
      },
    },
  };
}

async function main() {
  const externalUrl = process.env['MONGODB_URL'];
  let uri: string;
  let stopMemoryServer: (() => Promise<void>) | undefined;

  if (externalUrl) {
    uri = externalUrl;
    console.log(`Connecting to external MongoDB at ${uri}`);
  } else {
    console.log('No MONGODB_URL set — starting in-memory MongoDB...');
    const replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = replSet.getUri();
    stopMemoryServer = async () => {
      await replSet.stop();
    };
    console.log(`In-memory MongoDB ready at ${uri}`);
  }

  const { orm, runtime, query } = await createClient(uri, DB_NAME);

  try {
    console.log('Seeding data...');
    await seed(orm);
    console.log('Seed complete.\n');

    // Annotate the post-lowering plan with cacheAnnotation({}). The
    // same query is executed twice; the second call should be served
    // from the in-process store configured in `src/db.ts` and never reach
    // the underlying driver.
    const plan = withCacheAnnotation(
      query.from('posts').sort({ createdAt: -1 }).limit(5).build(),
      {},
    );

    console.log('Demonstrating opt-in caching with cacheAnnotation on a Mongo aggregation plan...');
    console.log('Running the same plan twice — second call should hit cache.\n');

    const firstStart = performance.now();
    const first = await runtime.query(plan).toArray();
    const firstMs = performance.now() - firstStart;

    const secondStart = performance.now();
    const second = await runtime.query(plan).toArray();
    const secondMs = performance.now() - secondStart;

    console.log(`First call (cache miss):  ${firstMs.toFixed(2)}ms`);
    console.log(`Second call (cache hit):  ${secondMs.toFixed(2)}ms`);
    console.log(`Speedup: ${(firstMs / Math.max(secondMs, 0.001)).toFixed(1)}x faster`);
    console.log(`\nReturned ${second.length} rows (identical between calls).`);

    // Sanity: results are equivalent.
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error('Cache hit returned rows that differ from the miss path');
    }
  } finally {
    await runtime.close();
    await stopMemoryServer?.();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
