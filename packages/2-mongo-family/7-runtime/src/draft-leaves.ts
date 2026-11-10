import { isPlainRecord } from '@internal/contract/is-plain-record';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import {
  isMongoPreparedParamRef,
  MongoParamRef,
  type MongoPreparedParamRef,
} from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';

export type MongoDraftLeaf = MongoParamRef | MongoPreparedParamRef;

type DraftUpdate = Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;

function isDraftLeaf(value: unknown): value is MongoDraftLeaf {
  return value instanceof MongoParamRef || isMongoPreparedParamRef(value);
}

function* flattenSlot(value: unknown): Generator<MongoDraftLeaf> {
  if (isDraftLeaf(value)) {
    yield value;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* flattenSlot(item);
    }
    return;
  }
  if (isPlainRecord(value)) {
    for (const v of Object.values(value)) {
      yield* flattenSlot(v);
    }
  }
}

function draftSlots(draft: MongoLoweredDraft): ReadonlyArray<unknown> {
  switch (draft.kind) {
    case 'insertOne':
    case 'rawInsertOne':
      return [draft.document];
    case 'insertMany':
    case 'rawInsertMany':
      return draft.documents;
    case 'updateOne':
    case 'updateMany':
    case 'rawUpdateOne':
    case 'rawUpdateMany':
    case 'findOneAndUpdate':
    case 'rawFindOneAndUpdate':
      return [draft.filter, draft.update];
    case 'deleteOne':
    case 'deleteMany':
    case 'rawDeleteOne':
    case 'rawDeleteMany':
    case 'findOneAndDelete':
    case 'rawFindOneAndDelete':
      return [draft.filter];
    case 'aggregate':
    case 'rawAggregate':
      return draft.pipeline;
  }
}

/**
 * Yields every `MongoParamRef` and `MongoPreparedParamRef` in a draft, once per position, including in raw commands. Recurses into arrays and plain records only, as `resolveDraftSlot` in the MongoDB adapter does.
 */
export function* flattenMongoDraftLeaves(draft: MongoLoweredDraft): Generator<MongoDraftLeaf> {
  for (const slot of draftSlots(draft)) {
    yield* flattenSlot(slot);
  }
}

function mapSlot(value: unknown, map: (leaf: MongoDraftLeaf) => unknown): unknown {
  if (isDraftLeaf(value)) {
    return map(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapSlot(item, map));
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = mapSlot(v, map);
    }
    return out;
  }
  return value;
}

function mapDoc(
  doc: Record<string, unknown>,
  map: (leaf: MongoDraftLeaf) => unknown,
): Record<string, unknown> {
  return blindCast<Record<string, unknown>, 'mapSlot preserves plain-object shape for documents'>(
    mapSlot(doc, map),
  );
}

function isUpdatePipeline(update: DraftUpdate): update is ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(update);
}

function mapUpdate(
  update: DraftUpdate,
  map: (leaf: MongoDraftLeaf) => unknown,
): Record<string, unknown> | Array<Record<string, unknown>> {
  if (isUpdatePipeline(update)) {
    return update.map((stage) => mapDoc(stage, map));
  }
  return mapDoc(update, map);
}

/**
 * Copies a draft, replacing each `MongoParamRef` and `MongoPreparedParamRef` with `map(leaf)`. Walks the same positions as {@link flattenMongoDraftLeaves}.
 */
export function mapMongoDraftLeaves(
  draft: MongoLoweredDraft,
  map: (leaf: MongoDraftLeaf) => unknown,
): MongoLoweredDraft {
  switch (draft.kind) {
    case 'insertOne':
    case 'rawInsertOne':
      return { ...draft, document: mapDoc(draft.document, map) };
    case 'insertMany':
    case 'rawInsertMany':
      return { ...draft, documents: draft.documents.map((d) => mapDoc(d, map)) };
    case 'updateOne':
    case 'updateMany':
    case 'rawUpdateOne':
    case 'rawUpdateMany':
    case 'findOneAndUpdate':
    case 'rawFindOneAndUpdate':
      return {
        ...draft,
        filter: mapDoc(draft.filter, map),
        update: mapUpdate(draft.update, map),
      };
    case 'deleteOne':
    case 'deleteMany':
    case 'rawDeleteOne':
    case 'rawDeleteMany':
    case 'findOneAndDelete':
    case 'rawFindOneAndDelete':
      return { ...draft, filter: mapDoc(draft.filter, map) };
    case 'aggregate':
    case 'rawAggregate':
      return { ...draft, pipeline: draft.pipeline.map((s) => mapDoc(s, map)) };
  }
}
