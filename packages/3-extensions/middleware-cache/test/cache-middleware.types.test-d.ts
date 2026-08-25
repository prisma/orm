import { expectTypeOf, test } from 'vitest';
import type {
  CacheMiddlewareOptions,
  CacheStoreOperationMode,
  CacheStrategyConfig,
  GenerationBumpOn,
  GenerationGuardConfig,
  GenerationScope,
  GenerationStrategyConfig,
} from '../src/cache-middleware';

test('generation strategy config exposes scope, bumpOn and guard', () => {
  expectTypeOf<GenerationScope>().toEqualTypeOf<'detected-models' | 'action-models-preferred'>();
  expectTypeOf<GenerationBumpOn>().toEqualTypeOf<'uncache' | 'all-writes'>();

  expectTypeOf<GenerationGuardConfig>().toMatchTypeOf<{
    readonly enabled?: boolean;
    readonly maxDeletesPerBump?: number;
  }>();

  expectTypeOf<GenerationStrategyConfig>().toMatchTypeOf<{
    readonly scope?: GenerationScope;
    readonly bumpOn?: GenerationBumpOn;
    readonly guard?: GenerationGuardConfig;
  }>();
});

test('cache strategy config and middleware options accept generation config', () => {
  expectTypeOf<CacheStrategyConfig>().toMatchTypeOf<{
    readonly mode?: 'broad' | 'targeted' | 'versioned';
    readonly generation?: GenerationStrategyConfig;
  }>();

  expectTypeOf<CacheStoreOperationMode>().toEqualTypeOf<'await' | 'detached'>();

  const options: CacheMiddlewareOptions = {
    readDedupe: false,
    storeOperationMode: 'detached',
    cacheStrategy: {
      mode: 'versioned',
      generation: {
        scope: 'action-models-preferred',
        bumpOn: 'all-writes',
        guard: { enabled: true, maxDeletesPerBump: 10 },
      },
    },
  };

  expectTypeOf(options.cacheStrategy).toMatchTypeOf<CacheStrategyConfig | undefined>();
});
