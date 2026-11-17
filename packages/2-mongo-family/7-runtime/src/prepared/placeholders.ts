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
  const placeholders = Object.fromEntries(
    Object.entries(declaration).map(([name, spec]) => [
      name,
      typeof spec === 'string'
        ? new MongoPreparedParamRef(name, spec, false)
        : new MongoPreparedParamRef(name, spec.codecId, spec.nullable === true),
    ]),
  );
  return Object.freeze(placeholders);
}

function nullability(placeholder: MongoPreparedParamRef): string {
  return placeholder.nullable ? 'nullable' : 'not nullable';
}

function undeclaredReason(
  placeholder: MongoPreparedParamRef,
  declared: Readonly<Record<string, MongoPreparedParamRef>>,
): string | undefined {
  const own = Object.hasOwn(declared, placeholder.name) ? declared[placeholder.name] : undefined;
  if (own === undefined) return 'whose name the declaration does not give';
  if (own.codecId === placeholder.codecId && own.nullable === placeholder.nullable)
    return undefined;
  return `with codec '${placeholder.codecId}' (${nullability(placeholder)}), but the declaration gives codec '${own.codecId}' (${nullability(own)})`;
}

/** The distinct placeholders in a draft, in walk order. Refuses a placeholder in a raw command, which is sent to the driver without its values being resolved, and one whose name, codec or nullability the declaration does not give. */
export function collectPlaceholders(
  draft: MongoLoweredDraft,
  declared: Readonly<Record<string, MongoPreparedParamRef>>,
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
    const reason = undeclaredReason(leaf, declared);
    if (reason !== undefined) {
      throw runtimeError(
        'RUNTIME.PREPARE_UNDECLARED_PARAM',
        `The plan has a placeholder for '${leaf.name}' ${reason}. Use the placeholders passed to the callback.`,
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
