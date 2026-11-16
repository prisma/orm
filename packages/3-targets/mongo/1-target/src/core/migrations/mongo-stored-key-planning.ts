import {
  asNamespaceId,
  type ContractWithDomain,
  valueObjectAt,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import {
  describeMigrationStatement,
  type FieldCoordinate,
  fieldStatementText,
  type MigrationPlannerConflict,
  type MigrationSubject,
  type ModelCoordinate,
  type ResolvedFieldRenameStatement,
  type ResolvedRenameStatement,
  type ResolvedValueObjectFieldRenameStatement,
  valueObjectFieldStatementText,
} from '@internal/framework-components/control';
import {
  embeddingModelOf,
  type MongoContract,
  ownEmbedStoredNamesOf,
  ownStoredNameOf,
  ownStoredNamesOf,
  type SelectedVariant,
  validatorDocumentShapesOf,
  variantFilter,
} from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { notOk, ok, type Result } from '@internal/utils/result';
import { unrewritableKeyReason } from './migration-factories';
import {
  type PlannedRewrite,
  type RewriteCollection,
  rewriteRefusals,
} from './mongo-rewrite-refusals';
import { collectionControlPolicy, modelAt, modelCoordinates } from './mongo-statement-planning';
import {
  type StoredPlace,
  type StoredType,
  storedPlacesOf,
  type UnlistedPlace,
} from './mongo-stored-places';
import { RemoveStoredKeyCall, RenameStoredKeyCall } from './op-factory-call';
import { type JsonPathStep, jsonPathText } from './stored-key-path';

/** What changes for one field of a value object or an embedded model: its key `from` becomes `to`, or, with no `to`, is removed. */
interface KeyChange {
  readonly type: StoredType;
  /** The field as the origin contract names it. */
  readonly subject: Extract<MigrationSubject, { readonly kind: 'field' | 'valueObjectField' }>;
  readonly from: string;
  readonly to: string | undefined;
  readonly statement:
    | ResolvedFieldRenameStatement
    | ResolvedValueObjectFieldRenameStatement
    | undefined;
}

/** A key rewrite the plan makes: its call, the field it is about, and the statement it carries out. */
export interface StoredKeyRewrite {
  readonly call: RenameStoredKeyCall | RemoveStoredKeyCall;
  readonly subject: MigrationSubject;
  readonly statement: KeyChange['statement'];
  /** The variant whose documents the call selects; `undefined` for a root model's documents. */
  readonly variant: SelectedVariant | undefined;
}

/** The key rewrites of a plan: renames, run first in the rewrite step, and removals, run last. */
export interface StoredKeyRewrites {
  readonly renames: readonly StoredKeyRewrite[];
  readonly removals: readonly StoredKeyRewrite[];
}

interface StoredKeyInput {
  readonly statements: readonly ResolvedRenameStatement[];
  readonly fromContract: ContractWithDomain | null;
  readonly contract: MongoContract;
  /** The schema the plan starts from, with each renamed collection under its new name. */
  readonly schema: MongoSchemaIR;
  /** The schema the destination contract describes. */
  readonly destination: MongoSchemaIR;
}

function valueObjectChanges(
  fromContract: ContractWithDomain,
  contract: MongoContract,
  statements: readonly ResolvedRenameStatement[],
): readonly KeyChange[] {
  return valueObjectsWithCoordinates(fromContract.storage).flatMap(
    ({ coordinate, valueObject }) => {
      const destination = valueObjectAt(contract.storage, coordinate);
      if (destination === undefined) return [];
      return Object.keys(valueObject.fields).flatMap((field): KeyChange[] => {
        const subject = {
          kind: 'valueObjectField' as const,
          namespaceId: asNamespaceId(coordinate.namespaceId),
          valueObject: coordinate.entityName,
          field,
        };
        const type: StoredType = { kind: 'valueObject', valueObject: coordinate };
        const statement = statements.find(
          (each): each is ResolvedValueObjectFieldRenameStatement =>
            each.entity === 'valueObjectField' &&
            each.from.namespaceId === subject.namespaceId &&
            each.from.valueObject === subject.valueObject &&
            each.from.field === field,
        );
        if (statement !== undefined) {
          return [{ type, subject, from: field, to: statement.to.field, statement }];
        }
        const takenByRename = statements.some(
          (each) =>
            each.entity === 'valueObjectField' &&
            each.from.namespaceId === subject.namespaceId &&
            each.from.valueObject === subject.valueObject &&
            each.from.field !== field &&
            each.to.field === field,
        );
        return Object.hasOwn(destination.fields, field) && !takenByRename
          ? []
          : [{ type, subject, from: field, to: undefined, statement: undefined }];
      });
    },
  );
}

function sameModelAs(a: ModelCoordinate, b: ModelCoordinate): boolean {
  return a.namespaceId === b.namespaceId && a.model === b.model;
}

function sameField(a: FieldCoordinate, b: FieldCoordinate): boolean {
  return sameModelAs(a, b) && a.field === b.field;
}

function embeddedModelChanges(
  fromContract: ContractWithDomain,
  contract: MongoContract,
  statements: readonly ResolvedRenameStatement[],
): readonly KeyChange[] {
  return modelCoordinates(fromContract).flatMap((coordinate) => {
    if (embeddingModelOf(fromContract.domain, coordinate) === undefined) return [];
    if (embeddingModelOf(contract.domain, coordinate) === undefined) return [];
    const origin = modelAt(fromContract, coordinate);
    const destination = modelAt(contract, coordinate);
    if (origin === undefined || destination === undefined) return [];
    const kept = new Set([
      ...Object.values(ownStoredNamesOf(destination)),
      ...Object.values(ownEmbedStoredNamesOf(destination)),
    ]);
    const type: StoredType = { kind: 'embeddedModel', model: coordinate };
    const takenByRename = new Set(
      statements.flatMap((each) => {
        if (each.entity !== 'field' || !sameModelAs(each.from, coordinate)) return [];
        const from = Object.hasOwn(origin.fields, each.from.field)
          ? ownStoredNameOf(origin, each.from.field)
          : undefined;
        const to = Object.hasOwn(destination.fields, each.to.field)
          ? ownStoredNameOf(destination, each.to.field)
          : undefined;
        return to === undefined || to === from ? [] : [to];
      }),
    );
    return Object.entries(ownStoredNamesOf(origin)).flatMap(([field, from]): KeyChange[] => {
      const subject = { kind: 'field' as const, ...coordinate, field };
      const statement = statements.find(
        (each): each is ResolvedFieldRenameStatement =>
          each.entity === 'field' && sameField(each.from, subject),
      );
      if (statement !== undefined) {
        const to = Object.hasOwn(destination.fields, statement.to.field)
          ? ownStoredNameOf(destination, statement.to.field)
          : undefined;
        return to === undefined || to === from ? [] : [{ type, subject, from, to, statement }];
      }
      return kept.has(from) && !takenByRename.has(from)
        ? []
        : [{ type, subject, from, to: undefined, statement: undefined }];
    });
  });
}

/** The field a key change is about, as a refusal names it. */
function fieldText(change: KeyChange, contracts: StoredKeyContracts): string {
  return change.subject.kind === 'valueObjectField'
    ? `value object field "${valueObjectFieldStatementText(contracts.fromContract, change.subject)}"`
    : `field "${fieldStatementText(contracts.fromContract, change.subject)}"`;
}

interface StoredKeyContracts {
  readonly fromContract: ContractWithDomain;
  readonly contract: MongoContract;
}

function refused(
  change: KeyChange,
  contracts: StoredKeyContracts,
  reason: string,
  why: (advice: string) => string,
): MigrationPlannerConflict {
  if (change.statement === undefined) {
    return {
      kind: 'fieldRemovalRefused',
      summary: `Cannot remove ${fieldText(change, contracts)}: ${reason}`,
      why: why('keep the field in the contract'),
    };
  }
  return {
    kind: 'statementRefused',
    summary: `Cannot ${describeMigrationStatement(change.statement, contracts.fromContract, contracts.contract)}: ${reason}`,
    why: why('leave out this statement'),
    refusedStatement: change.statement,
  };
}

function placeText(place: Pick<StoredPlace, 'collection' | 'field'>): string {
  return `field "${place.field}" of collection "${place.collection}"`;
}

function unlistedRefusal(
  change: KeyChange,
  place: UnlistedPlace,
  contracts: StoredKeyContracts,
): MigrationPlannerConflict {
  const byHand = (advice: string) =>
    `Rewrite ${placeText(place)} in a dataTransform operation of migration.ts, or ${advice}.`;
  if (place.reach.kind === 'containsItself') {
    return refused(
      change,
      contracts,
      `${placeText(place)} holds it inside "${place.reach.type}", which contains itself, so the documents can hold it at any depth`,
      (advice) =>
        `The plan rewrites a key at every path from a field to its objects, and a type that contains itself has no last path. ${byHand(advice)}`,
    );
  }
  return refused(
    change,
    contracts,
    `${placeText(place)} holds a ${place.reach.kind} of value objects`,
    (advice) =>
      `The plan rewrites a key only in a field that holds a value object, a list of them, or an embedded model. ${byHand(advice)}`,
  );
}

function unrewritableKeyRefusal(
  change: KeyChange,
  keys: readonly string[],
  contracts: StoredKeyContracts,
): MigrationPlannerConflict | undefined {
  for (const key of keys) {
    const reason = unrewritableKeyReason(key);
    if (reason === undefined) continue;
    return refused(
      change,
      contracts,
      `the stored name "${key}" cannot be rewritten`,
      (advice) =>
        `${reason}, so the plan cannot rewrite the key. Rewrite it in the database yourself, or ${advice}.`,
    );
  }
  if (change.to === undefined) return undefined;
  const reason = unrewritableKeyReason(change.to);
  return reason === undefined
    ? undefined
    : refused(
        change,
        contracts,
        `the stored name "${change.to}" cannot be written`,
        (advice) =>
          `${reason}. Give the field a stored name without "." that does not start with "$", or ${advice}.`,
      );
}

/** One key rewrite at one path, with the models whose documents it is planned for. */
interface PlannedKeyRewrite {
  readonly change: KeyChange;
  readonly place: StoredPlace;
  readonly path: readonly JsonPathStep[];
  readonly models: string[];
}

function rewriteKey(place: StoredPlace, path: readonly JsonPathStep[]): string {
  return JSON.stringify([place.collection, place.field, jsonPathText(path), place.variant ?? null]);
}

function callOf(planned: PlannedKeyRewrite): RenameStoredKeyCall | RemoveStoredKeyCall {
  const { change, place, path } = planned;
  const at = { collection: place.collection, field: place.field, path: jsonPathText(path) };
  const filter = place.variant === undefined ? {} : { filter: variantFilter(place.variant) };
  return change.to === undefined
    ? new RemoveStoredKeyCall({ ...at, ...filter })
    : new RenameStoredKeyCall({ ...at, to: change.to, ...filter });
}

function plannedRewriteOf(
  planned: PlannedKeyRewrite,
  contracts: StoredKeyContracts,
): PlannedRewrite {
  return {
    kind: planned.change.to === undefined ? 'removeStoredKey' : 'renameStoredKey',
    collection: planned.place.collection,
    field: planned.place.field,
    variant: planned.place.variant,
    model: planned.place.model,
    storedKey: { key: fieldText(planned.change, contracts), together: planned.models },
  };
}

function policyRefusal(
  change: KeyChange,
  place: StoredPlace,
  policy: string,
  contracts: StoredKeyContracts,
): MigrationPlannerConflict {
  return refused(
    change,
    contracts,
    `collection "${place.collection}" has control policy "${policy}"`,
    () =>
      'Statements rename only collections, and fields of collections, whose control policy is "managed". Make the change in the database yourself and leave out this statement.',
  );
}

export function rewriteCollectionOf(schema: MongoSchemaIR, name: string): RewriteCollection {
  const collection = schema.collection(name);
  return {
    timeSeries: collection?.options?.timeseries !== undefined,
    validator: collection?.validator?.jsonSchema,
  };
}

/**
 * The key rewrites of the fields of value objects and embedded models a plan makes. A value object or embedded model of the origin is compared, field by field, with the one of the same name in the destination: a rename statement renames a field's key, and a field whose stored name the destination no longer has, which no statement renames, is removed, which the plan asks about. Each rewrite acts at every place the destination's documents hold the type, in a collection the plan keeps, with the destination's names on the path; renames run outer keys first. A rename in a collection whose control policy is not `managed` is refused, and a removal there is left out, as top-level removals are. With no origin contract, the removals are read from the two validators.
 */
export function planStoredKeyRewrites(
  input: StoredKeyInput,
): Result<StoredKeyRewrites, readonly MigrationPlannerConflict[]> {
  const { fromContract, contract } = input;
  if (fromContract === null) {
    const removals = validatorKeyRemovals(input);
    const refusals = removals.flatMap(({ call, key }) =>
      rewriteRefusals(
        {
          kind: 'removeStoredKey',
          collection: call.options.collection,
          field: call.options.field,
          variant: undefined,
          model: undefined,
          storedKey: { key: `key ${JSON.stringify(key)}`, together: [] },
        },
        contract,
        rewriteCollectionOf(input.schema, call.options.collection),
      ),
    );
    return refusals.length > 0
      ? notOk(dedupe(refusals))
      : ok({ renames: [], removals: removals.map(({ key: _, ...removal }) => removal) });
  }
  const contracts = { fromContract, contract };
  const changes = [
    ...valueObjectChanges(fromContract, contract, input.statements),
    ...embeddedModelChanges(fromContract, contract, input.statements),
  ];
  const placesOf = storedPlacesOf(contract);
  const conflicts: MigrationPlannerConflict[] = [];
  const planned = new Map<string, PlannedKeyRewrite>();
  for (const change of changes) {
    const places = placesOf(change.type);
    if (!places.ok) {
      conflicts.push(unlistedRefusal(change, places.failure, contracts));
      continue;
    }
    for (const place of places.value) {
      if (input.schema.collection(place.collection) === undefined) continue;
      const policy = collectionControlPolicy(contract, place.collection);
      if (policy !== 'managed' && change.statement === undefined) continue;
      const refusal =
        policy !== 'managed'
          ? policyRefusal(change, place, policy, contracts)
          : unrewritableKeyRefusal(
              change,
              [
                place.field,
                ...place.steps.flatMap((step) => (step.kind === 'member' ? [step.name] : [])),
                change.from,
              ],
              contracts,
            );
      if (refusal !== undefined) {
        conflicts.push(refusal);
        continue;
      }
      const path: readonly JsonPathStep[] = [...place.steps, { kind: 'member', name: change.from }];
      const key = JSON.stringify([rewriteKey(place, path), change.to ?? null]);
      const known = planned.get(key);
      if (known !== undefined) {
        known.models.push(place.model.model);
        continue;
      }
      planned.set(key, { change, place, path, models: [place.model.model] });
    }
  }
  for (const each of planned.values()) {
    conflicts.push(
      ...rewriteRefusals(
        plannedRewriteOf(each, contracts),
        contract,
        rewriteCollectionOf(input.schema, each.place.collection),
      ),
    );
  }
  if (conflicts.length > 0) return notOk(dedupe(conflicts));
  const rewrites = [...planned.values()]
    .map((each, order) => ({ each, order }))
    .sort((a, b) => a.each.path.length - b.each.path.length || a.order - b.order)
    .map(({ each }) => ({
      call: callOf(each),
      subject: each.change.subject,
      statement: each.change.statement,
      variant: each.place.variant,
    }));
  return ok({
    renames: rewrites.filter((rewrite) => rewrite.call instanceof RenameStoredKeyCall),
    removals: rewrites.filter((rewrite) => rewrite.call instanceof RemoveStoredKeyCall),
  });
}

function dedupe(
  conflicts: readonly MigrationPlannerConflict[],
): readonly MigrationPlannerConflict[] {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = JSON.stringify([conflict.kind, conflict.summary, conflict.why]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys a validator's property schema declares for each object below its field, by the path to those objects. */
function declaredKeys(
  schema: unknown,
  steps: readonly JsonPathStep[],
  found: Map<string, { readonly steps: readonly JsonPathStep[]; readonly keys: Set<string> }>,
): void {
  if (!isRecord(schema)) return;
  const { properties, items } = schema;
  if (isRecord(properties)) {
    const text = jsonPathText(steps);
    const entry = found.get(text) ?? { steps, keys: new Set<string>() };
    found.set(text, entry);
    for (const [key, property] of Object.entries(properties)) {
      entry.keys.add(key);
      declaredKeys(property, [...steps, { kind: 'member', name: key }], found);
    }
  }
  if (items !== undefined) declaredKeys(items, [...steps, { kind: 'wildcard' }], found);
  for (const branch of [schema['oneOf'], schema['anyOf']].flat()) {
    declaredKeys(branch, steps, found);
  }
}

/** The keys each root field's objects are declared with, over every kind of document a validator describes. */
function declaredKeysOf(jsonSchema: unknown) {
  const byField = new Map<
    string,
    Map<string, { readonly steps: readonly JsonPathStep[]; readonly keys: Set<string> }>
  >();
  for (const shape of validatorDocumentShapesOf(jsonSchema)) {
    for (const [field, schema] of Object.entries(shape.properties)) {
      const found = byField.get(field) ?? new Map();
      byField.set(field, found);
      declaredKeys(schema, [], found);
    }
  }
  return byField;
}

/**
 * Without an origin contract, a key inside a root field is known removed when the origin validator declares it on the objects at a path and the destination validator declares those objects without it. It is named by its storage name, the collection, field and keys joined by dots.
 */
function validatorKeyRemovals(
  input: StoredKeyInput,
): readonly (StoredKeyRewrite & { readonly key: string })[] {
  return input.schema.collections.flatMap((origin) => {
    const collection = origin.name;
    if (collectionControlPolicy(input.contract, collection) !== 'managed') return [];
    const after = input.destination.collection(collection)?.validator?.jsonSchema;
    if (after === undefined || origin.validator === undefined) return [];
    const kept = declaredKeysOf(after);
    return [...declaredKeysOf(origin.validator.jsonSchema)].flatMap(([field, objects]) => {
      const keptObjects = kept.get(field);
      if (keptObjects === undefined || unrewritableKeyReason(field) !== undefined) return [];
      return [...objects].flatMap(([text, { steps, keys }]) => {
        const keptKeys = keptObjects.get(text)?.keys;
        if (keptKeys === undefined) return [];
        const members = steps.flatMap((step) => (step.kind === 'member' ? [step.name] : []));
        if (members.some((key) => unrewritableKeyReason(key) !== undefined)) return [];
        return [...keys]
          .filter((key) => !keptKeys.has(key) && unrewritableKeyReason(key) === undefined)
          .sort()
          .map((key) => ({
            call: new RemoveStoredKeyCall({
              collection,
              field,
              path: jsonPathText([...steps, { kind: 'member', name: key }]),
            }),
            subject: {
              kind: 'storage' as const,
              name: [collection, field, ...members, key].join('.'),
            },
            statement: undefined,
            variant: undefined,
            key,
          }));
      });
    });
  });
}
