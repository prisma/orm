import type { PlanMeta } from '@internal/contract/types';
import { isRuntimeError } from '@internal/framework-components/runtime';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import { MongoParamRef } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { computeMongoContentHash } from '../src/content-hash';
import type { MongoExecutionPlan } from '../src/mongo-execution-plan';

const baseMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'test',
  lane: 'orm',
};

function buildDraftExec(draft: MongoLoweredDraft): MongoExecutionPlan {
  return {
    meta: baseMeta,
    command: blindCast<
      MongoExecutionPlan['command'],
      'pre-resolve draft placed in command slot for guard tests'
    >(draft),
  };
}

describe('computeMongoContentHash unresolved-command guard', () => {
  it('throws RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND for a structural draft in the command slot', async () => {
    const draft: MongoLoweredDraft = {
      kind: 'insertOne',
      collection: 'users',
      document: { name: new MongoParamRef('Alice') },
    };

    await expect(async () => computeMongoContentHash(buildDraftExec(draft))).rejects.toSatisfy(
      (error) => {
        if (!isRuntimeError(error)) return false;
        return (
          error.code === 'RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND' &&
          error.message.includes('contentHash') &&
          error.message.includes('resolved wire command') &&
          error.message.includes('before hook')
        );
      },
    );
  });

  it.each([
    { label: 'null', command: null },
    { label: 'a primitive', command: 'not-a-command' },
  ])(
    'throws when the command slot holds $label rather than a wire command',
    async ({ command }) => {
      const exec: MongoExecutionPlan = {
        meta: baseMeta,
        command: blindCast<
          MongoExecutionPlan['command'],
          'non-object command slot for guard tests'
        >(command),
      };

      await expect(async () => computeMongoContentHash(exec)).rejects.toSatisfy((error) => {
        if (!isRuntimeError(error)) return false;
        return error.code === 'RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND';
      });
    },
  );
});
