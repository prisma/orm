import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/issues/17005-args-type-conflict
// (postgres matrix entry; allProviders — porting postgres only per brief).
//
// Upstream: the test verifies that `include` still works when a model has field
// names ("postId"/"mediaId") that historically conflicted with Prisma-generated
// args types. The runtime assertion is that `post.findFirst()` resolves without
// throwing. prisma-next uses structural types with no codegen naming conflicts,
// so this is a straightforward runtime port.
//
// Upstream test: prisma.post.findFirst() → resolves.not.toThrow()
// Port:          db.public.Post.first()  → resolves to null (no rows) without throwing

describe('ports/prisma/functional/issues-17005-args-type-conflict', () => {
  it(
    'dummy',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await expect(db.public.Post.first()).resolves.not.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );
});
