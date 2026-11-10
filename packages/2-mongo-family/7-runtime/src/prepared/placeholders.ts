import { runtimeError } from '@internal/framework-components/runtime';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import {
  isMongoPreparedParamRef,
  MongoParamRef,
  MongoPreparedParamRef,
} from '@internal/mongo-value';
import { flattenMongoDraftLeaves, mapMongoDraftLeaves } from '../draft-leaves';
import type { MongoDeclaration } from './types';

const isRawDraftKind: Readonly<Record<MongoLoweredDraft['kind'], boolean>> = {
  aggregate: false,
  insertOne: false,
  insertMany: false,
  updateOne: false,
  updateMany: false,
  deleteOne: false,
  deleteMany: false,
  findOneAndUpdate: false,
  findOneAndDelete: false,
  rawAggregate: true,
  rawInsertOne: true,
  rawInsertMany: true,
  rawUpdateOne: true,
  rawUpdateMany: true,
  rawDeleteOne: true,
  rawDeleteMany: true,
  rawFindOneAndUpdate: true,
  rawFindOneAndDelete: true,
};

export function buildPlaceholders(
  declaration: MongoDeclaration,
): Readonly<Record<string, MongoPreparedParamRef>> {
  const placeholders: Record<string, MongoPreparedParamRef> = {};
  for (const [name, spec] of Object.entries(declaration)) {
    placeholders[name] =
      typeof spec === 'string'
        ? new MongoPreparedParamRef(name, spec, false)
        : new MongoPreparedParamRef(name, spec.codecId, spec.nullable === true);
  }
  return Object.freeze(placeholders);
}

/** The distinct placeholders in a draft, in walk order. Refuses a placeholder in a raw command, which is sent to the driver without its values being resolved. */
export function collectPlaceholders(
  draft: MongoLoweredDraft,
): ReadonlyArray<MongoPreparedParamRef> {
  const found = new Set<MongoPreparedParamRef>();
  for (const leaf of flattenMongoDraftLeaves(draft)) {
    if (!isMongoPreparedParamRef(leaf)) continue;
    if (isRawDraftKind[draft.kind]) {
      throw runtimeError(
        'RUNTIME.PREPARE_RAW_PLACEHOLDER',
        `The raw command has a placeholder for '${leaf.name}'. Raw commands are sent as written, so they cannot take prepared parameters.`,
        { name: leaf.name },
      );
    }
    found.add(leaf);
  }
  return [...found];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Replaces each placeholder with one `MongoParamRef` holding its run value, placed at every position the placeholder holds. */
export function bindPlaceholders(
  draft: MongoLoweredDraft,
  placeholders: ReadonlyArray<MongoPreparedParamRef>,
  params: unknown,
): MongoLoweredDraft {
  if (!isRecord(params)) {
    throw runtimeError(
      'RUNTIME.PREPARE_MISSING_PARAM',
      'Prepared statement parameters must be an object',
    );
  }
  for (const placeholder of placeholders) {
    if (!Object.hasOwn(params, placeholder.name)) {
      throw runtimeError(
        'RUNTIME.PREPARE_MISSING_PARAM',
        `Prepared statement is missing parameter '${placeholder.name}'`,
        { name: placeholder.name },
      );
    }
  }
  if (placeholders.length === 0) return draft;
  const bound = new Map<MongoPreparedParamRef, MongoParamRef>();
  return mapMongoDraftLeaves(draft, (leaf) => {
    if (!isMongoPreparedParamRef(leaf)) return leaf;
    const existing = bound.get(leaf);
    if (existing !== undefined) return existing;
    const ref = new MongoParamRef(params[leaf.name], {
      name: leaf.name,
      codecId: leaf.codecId,
      nullable: leaf.nullable,
    });
    bound.set(leaf, ref);
    return ref;
  });
}
