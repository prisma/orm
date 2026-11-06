import { isPlainRecord } from '@internal/contract/is-plain-record';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import { MongoParamRef } from '@internal/mongo-value';
import { ifDefined } from '@internal/utils/defined';
import { ormError } from '../orm-errors';

function assertPagingValue(stageName: '$limit' | '$skip', value: unknown): void {
  if (!(value instanceof MongoParamRef)) return;
  const n = value.value;
  const stage = stageName === '$limit' ? 'limit' : 'skip';
  const lowest = stage === 'limit' ? 1 : 0;
  if (typeof n === 'number' && Number.isInteger(n) && n >= lowest) return;
  const rule = stage === 'limit' ? 'a positive integer' : 'a non-negative integer';
  const source = value.name === undefined ? '' : `, and parameter '${value.name}' is not`;
  throw ormError('ORM.ARGUMENT_INVALID', `${stage} must be ${rule}${source}`, {
    stage,
    ...ifDefined('name', value.name),
  });
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

/** Checks that every parameter in a `$limit` stage holds a positive integer and every one in a `$skip` stage a non-negative integer, in the pipeline and in every sub-pipeline. Runs after `beforeEncode`, so it covers values middleware replaced. */
export function assertPagingValues(draft: MongoLoweredDraft): void {
  if (draft.kind === 'aggregate') {
    assertPipeline(draft.pipeline);
  }
}
