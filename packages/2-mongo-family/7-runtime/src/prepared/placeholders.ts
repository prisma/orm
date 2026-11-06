import { runtimeError } from '@internal/framework-components/runtime';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import {
  isMongoPreparedParamRef,
  MongoParamRef,
  MongoPreparedParamRef,
} from '@internal/mongo-value';
import { flattenMongoDraftLeaves, mapMongoDraftLeaves } from '../draft-leaves';
import type { MongoDeclaration } from './types';

const rawDraftKinds: ReadonlySet<MongoLoweredDraft['kind']> = new Set([
  'rawAggregate',
  'rawInsertOne',
  'rawInsertMany',
  'rawUpdateOne',
  'rawUpdateMany',
  'rawDeleteOne',
  'rawDeleteMany',
  'rawFindOneAndUpdate',
  'rawFindOneAndDelete',
]);

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
    if (rawDraftKinds.has(draft.kind)) {
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
  const bound = new Map<MongoPreparedParamRef, MongoParamRef>();
  for (const placeholder of placeholders) {
    if (!Object.hasOwn(params, placeholder.name)) {
      throw runtimeError(
        'RUNTIME.PREPARE_MISSING_PARAM',
        `Prepared statement query is missing parameter '${placeholder.name}'`,
        { name: placeholder.name },
      );
    }
    bound.set(
      placeholder,
      new MongoParamRef(params[placeholder.name], {
        name: placeholder.name,
        codecId: placeholder.codecId,
        nullable: placeholder.nullable,
      }),
    );
  }
  if (bound.size === 0) return draft;
  return mapMongoDraftLeaves(draft, (leaf) =>
    isMongoPreparedParamRef(leaf) ? (bound.get(leaf) ?? leaf) : leaf,
  );
}
