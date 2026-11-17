import type { MongoFieldRewriteMeta } from '@internal/mongo-query-ast/control';
import { expectTypeOf, test } from 'vitest';
import type { RewriteKind } from '../src/core/migrations/mongo-rewrite-refusals';

test("every kind an operation's meta.rewrite names is a kind the rewrite refusals know", () => {
  expectTypeOf<MongoFieldRewriteMeta['kind']>().toExtend<RewriteKind>();
});
