/**
 * Raw SQL written as `sql` literals migrates, verifies, and survives `contract infer`.
 *
 * A PSL contract declares a partial index, an expression index, a CHECK whose text spans several
 * lines, and a policy with `using` (an `EXISTS (SELECT … FROM … WHERE …)` predicate) and
 * `withCheck`. The partial index, the CHECK and `withCheck` end their last line in a `--` comment.
 * Emit → plan → apply → verify clean. Then `contract infer` prints every text as a `sql` literal;
 * the inferred schema emits and verifies clean against the same database; a second inference
 * equals the first.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  planMigrationAndSelfEmit,
  runContractEmit,
  runContractInfer,
  runDbVerify,
  runMigrate,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const AUTHORED_SCHEMA = `// use prisma-8

namespace public {
  model Profile {
    id      Int    @id
    ownerId Int    @map("owner_id")
    email   String

    @@map("profile")
    @@rls
    @@index([ownerId], where: sql\`owner_id > 0 -- active owners only\`, name: "profile_owner_active")
    @@index(expression: sql\`lower(email)\`, name: "profile_email_lower")
    @@check(expression: sql\`
      owner_id > 0
        AND char_length(email) > 0 -- an owner needs an email
    \`, name: "profile_valid")
  }

  model Post {
    id       Int @id
    authorId Int @map("author_id")

    @@map("post")
    @@rls
  }

  policy_update post_author_write {
    target    = Post
    roles     = [app_user]
    using     = sql\`EXISTS (SELECT 1 FROM profile WHERE profile.id = post.author_id AND profile.owner_id = 1)\`
    withCheck = sql\`author_id > 0 -- an author is required\`
  }
}
`;

function readContract(ctx: JourneyContext): string {
  return readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
}

withTempDir(({ createTempDir }) => {
  describe('sql literals in the six places', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query('CREATE ROLE app_user')),
    });

    it(
      'authored sql literals migrate and verify; infer prints sql literals that verify and re-infer identically',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), AUTHORED_SCHEMA);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `emit\n${stripAnsi(emit.stderr)}`).toBe(0);
        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(plan.exitCode, `plan\n${stripAnsi(plan.stderr)}`).toBe(0);
        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `apply\n${stripAnsi(apply.stderr)}`).toBe(0);
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `verify authored\n${stripAnsi(verify.stderr)}`).toBe(0);

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const inferred = readContract(ctx);
        expect(inferred, 'no plain-string SQL').not.toMatch(
          /(where|expression): ["']|(using|withCheck) = ["']/,
        );
        expect(inferred, 'nothing skipped').not.toContain('prisma: skipped');
        expect(inferred).toMatch(
          /@@index\(\[ownerId\], map: "profile_owner_active_\w+", where: sql`/,
        );
        expect(inferred).toMatch(/@@index\(expression: sql`lower\(email\)`/);
        expect(inferred).toMatch(/@@check\(expression: sql`/);
        expect(inferred).toMatch(/using = sql`/);
        expect(inferred).toMatch(/withCheck = sql`/);

        const emitInferred = await runContractEmit(ctx);
        expect(emitInferred.exitCode, `emit inferred\n${stripAnsi(emitInferred.stderr)}`).toBe(0);
        const verifyInferred = await runDbVerify(ctx, ['--schema-only']);
        expect(
          verifyInferred.exitCode,
          `verify inferred\n${stripAnsi(verifyInferred.stderr)}`,
        ).toBe(0);

        const reinfer = await runContractInfer(ctx);
        expect(reinfer.exitCode, `re-infer\n${stripAnsi(reinfer.stderr)}`).toBe(0);
        expect(readContract(ctx)).toBe(inferred);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
