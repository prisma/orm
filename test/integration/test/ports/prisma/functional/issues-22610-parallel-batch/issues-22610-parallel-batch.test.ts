import { or } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/22610-parallel-batch
// (allProviders; postgres matrix entry).
//
// Subject: a large parallel batch of queries (Promise.all of 25 findUnique calls with
// relation-join OR conditions) completes without timing out or throwing.
//
// Upstream: prisma.post.findUnique({ where: { id: X, OR: [{ author: { id: Y } }] } })
// In prisma-next: Post.where(p => or(p.id.eq(X), p.author.some(a => a.id.eq(Y)))).first()
//
// The subject is "batch of 25 parallel queries doesn't timeout". None will match.

function withIssue22610(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-22610-parallel-batch', () => {
  it(
    'batch does not time out',
    () =>
      withIssue22610(async ({ db }) => {
        const results = Promise.all(
          Array.from({ length: 25 }).map((_, i) =>
            db.public.Post.where((p) =>
              or(
                p.id.eq(`nonexistent-post-${i}`),
                p.author.some((a) => a.id.eq(`nonexistent-author-${i}`)),
              ),
            ).first(),
          ),
        );

        await expect(results).resolves.not.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );
});
