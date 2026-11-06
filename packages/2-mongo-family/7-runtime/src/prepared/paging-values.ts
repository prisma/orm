import { isPlainRecord } from '@internal/contract/is-plain-record';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import { MongoParamRef } from '@internal/mongo-value';
import { structuredError } from '@internal/utils/structured-error';

function assertPagingValue(stageName: '$limit' | '$skip', value: unknown): void {
  if (!(value instanceof MongoParamRef)) return;
  const n = value.value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    throw structuredError(
      'ORM.ARGUMENT_INVALID',
      `${stageName === '$limit' ? 'limit' : 'skip'} must be a non-negative integer`,
    );
  }
}

function subPipelines(stageName: string, body: unknown): ReadonlyArray<unknown> {
  if (!isPlainRecord(body)) return [];
  switch (stageName) {
    case '$lookup':
    case '$unionWith':
      return [body['pipeline']];
    case '$facet':
      return Object.values(body);
    case '$merge':
      return [body['whenMatched']];
    default:
      return [];
  }
}

function assertPipeline(pipeline: unknown): void {
  if (!Array.isArray(pipeline)) return;
  for (const stage of pipeline) {
    if (!isPlainRecord(stage)) continue;
    for (const [stageName, body] of Object.entries(stage)) {
      if (stageName === '$limit' || stageName === '$skip') {
        assertPagingValue(stageName, body);
      }
      for (const sub of subPipelines(stageName, body)) {
        assertPipeline(sub);
      }
    }
  }
}

/** Checks that every parameter in a `$limit` or `$skip` stage holds a non-negative integer, in the pipeline and in every sub-pipeline. Runs after `beforeEncode`, so it covers values middleware replaced. */
export function assertPagingValues(draft: MongoLoweredDraft): void {
  if (draft.kind === 'aggregate') {
    assertPipeline(draft.pipeline);
  }
}
