import { soleDomainNamespaceId } from '@internal/contract/types';
import { test } from 'vitest';
import { Collection } from '../src/collection';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { createMockRuntime, getTestContext, withCapabilities } from './helpers';

// Pins whether the house `as never` idiom (`test/aggregate-pagination.test.ts`
// and throughout the aggregate tests, e.g. `const numericField = 'views' as
// never`) can be used at the argument position to satisfy `distinctOn`'s
// `never`-typed parameter on a contract lacking `postgres.distinctOn`. The
// gate narrows the *parameter* to `never`, not the whole method — an
// argument-level cast is a different defeat surface than the whole-method
// `never` sql-builder's `GatedMethod` produces. If this directive reports as
// unused, the cast is accepted and the type gate is castable; kept here so a
// future TypeScript upgrade can't silently flip the answer unnoticed.
test('distinctOn capability gates unsupported contracts', () => {
  const contract = withCapabilities(baseContract, { sql: { defaultInInsert: true } });
  const context = { ...getTestContext(), contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Post', {
    namespaceId: soleDomainNamespaceId(contract.domain),
  });

  const ordered = collection.orderBy((post) => post.title.asc());
  // @ts-expect-error distinctOn stays gated even through an `as never` cast
  ordered.distinctOn('title' as never);

  // Regression guard: the same cast on a capable contract compiles clean —
  // confirms the directive above fails for the capability reason, not because
  // `as never` is always rejected as an argument.
  const { collection: capable } = createCollectionFor('Post');
  capable.orderBy((post) => post.title.asc()).distinctOn('title' as never);
});
