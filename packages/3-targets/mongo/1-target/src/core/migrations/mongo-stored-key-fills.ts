import {
  asNamespaceId,
  type ContractField,
  type ContractValueObjectField,
  type ContractWithDomain,
  valueObjectAt,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import type { TypeLookups } from '@internal/framework-components/codec';
import {
  describeMigrationStatement,
  type FieldCoordinate,
  fieldStatementText,
  type MigrationPlannerConflict,
  type MigrationSubject,
  type ResolvedFieldBackfillStatement,
  type ResolvedFieldRenameStatement,
  type ResolvedMigrationStatement,
  type ResolvedValueObjectFieldBackfillStatement,
  type ResolvedValueObjectFieldRenameStatement,
  type ValueObjectFieldCoordinate,
  valueObjectFieldStatementText,
} from '@internal/framework-components/control';
import {
  embeddingModelOf,
  type MongoContract,
  ownStoredNameOf,
  variantFilter,
} from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { notOk, ok, type Result } from '@internal/utils/result';
import { unrewritableKeyReason } from './migration-factories';
import { temporaryValueOf } from './mongo-field-fills';
import { type PlannedRewrite, rewriteRefusals } from './mongo-rewrite-refusals';
import { collectionControlPolicy, modelAt, modelCoordinates } from './mongo-statement-planning';
import { rewriteCollectionOf } from './mongo-stored-key-planning';
import {
  type StoredPlace,
  type StoredType,
  storedPlacesOf,
  type UnlistedPlace,
} from './mongo-stored-places';
import { FillStoredKeyCall } from './op-factory-call';
import { type JsonPathStep, jsonPathText } from './stored-key-path';
import { UnfilledValue } from './unfilled-value';

type NestedBackfillStatement =
  | ResolvedValueObjectFieldBackfillStatement
  | ResolvedFieldBackfillStatement;

/** A fill of a key inside a field's value: its call, the field it fills, and the temporary value or statement that chooses the value. */
export interface StoredKeyFill {
  readonly call: FillStoredKeyCall;
  /** The field, as the destination contract names it. */
  readonly subject: MigrationSubject;
  /** The temporary value as the target writes it; `undefined` for a backfill. */
  readonly text: string | undefined;
  readonly statement: NestedBackfillStatement | undefined;
}

/** A field of a value object or an embedded model that the destination makes required, new or once optional. */
interface RequiredField {
  readonly type: StoredType;
  readonly subject: Extract<MigrationSubject, { readonly kind: 'field' | 'valueObjectField' }>;
  /** The key the field is stored under. */
  readonly key: string;
  readonly field: ContractField | ContractValueObjectField;
  readonly statement: NestedBackfillStatement | undefined;
}

interface StoredKeyFillInput {
  readonly statements: readonly ResolvedMigrationStatement[];
  readonly fromContract: ContractWithDomain | null;
  readonly contract: MongoContract;
  readonly lookups: TypeLookups;
  /** The schema the plan starts from, with each renamed collection under its new name. */
  readonly schema: MongoSchemaIR;
  /** The schema the destination contract describes. */
  readonly destination: MongoSchemaIR;
}

function byName<T>([a]: readonly [string, T], [b]: readonly [string, T]): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sameValueObjectField(a: ValueObjectFieldCoordinate, b: ValueObjectFieldCoordinate) {
  return a.namespaceId === b.namespaceId && a.valueObject === b.valueObject && a.field === b.field;
}

function sameField(a: FieldCoordinate, b: FieldCoordinate) {
  return a.namespaceId === b.namespaceId && a.model === b.model && a.field === b.field;
}

/** Whether a field is new to the destination, or was optional in the origin. */
function newlyRequired(
  field: ContractField | ContractValueObjectField,
  origin: ContractField | ContractValueObjectField | undefined,
): boolean {
  return !field.nullable && (origin === undefined || origin.nullable);
}

function valueObjectFields(
  fromContract: ContractWithDomain,
  contract: MongoContract,
  statements: readonly ResolvedMigrationStatement[],
): readonly RequiredField[] {
  return valueObjectsWithCoordinates(contract.storage).flatMap(({ coordinate, valueObject }) => {
    const origin = valueObjectAt(fromContract.storage, coordinate);
    if (origin === undefined) return [];
    return Object.entries(valueObject.fields)
      .sort(byName)
      .flatMap(([name, field]): RequiredField[] => {
        const subject = {
          kind: 'valueObjectField' as const,
          namespaceId: asNamespaceId(coordinate.namespaceId),
          valueObject: coordinate.entityName,
          field: name,
        };
        const originName =
          statements.find(
            (statement): statement is ResolvedValueObjectFieldRenameStatement =>
              statement.kind === 'rename' &&
              statement.entity === 'valueObjectField' &&
              sameValueObjectField(statement.to, subject),
          )?.from.field ?? name;
        const originField = Object.hasOwn(origin.fields, originName)
          ? origin.fields[originName]
          : undefined;
        if (!newlyRequired(field, originField)) return [];
        return [
          {
            type: { kind: 'valueObject', valueObject: coordinate },
            subject,
            key: name,
            field,
            statement: statements.find(
              (statement): statement is ResolvedValueObjectFieldBackfillStatement =>
                statement.kind === 'backfill' &&
                statement.entity === 'valueObjectField' &&
                sameValueObjectField(statement.field, subject),
            ),
          },
        ];
      });
  });
}

function embeddedModelFields(
  fromContract: ContractWithDomain,
  contract: MongoContract,
  statements: readonly ResolvedMigrationStatement[],
): readonly RequiredField[] {
  return modelCoordinates(contract).flatMap((coordinate) => {
    if (embeddingModelOf(contract.domain, coordinate) === undefined) return [];
    if (embeddingModelOf(fromContract.domain, coordinate) === undefined) return [];
    const origin = modelAt(fromContract, coordinate);
    const destination = modelAt(contract, coordinate);
    if (origin === undefined || destination === undefined) return [];
    return Object.entries(destination.fields)
      .sort(byName)
      .flatMap(([name, field]): RequiredField[] => {
        const subject = { kind: 'field' as const, ...coordinate, field: name };
        const originName =
          statements.find(
            (statement): statement is ResolvedFieldRenameStatement =>
              statement.kind === 'rename' &&
              statement.entity === 'field' &&
              sameField(statement.to, subject),
          )?.from.field ?? name;
        const originField = Object.hasOwn(origin.fields, originName)
          ? origin.fields[originName]
          : undefined;
        if (!newlyRequired(field, originField)) return [];
        return [
          {
            type: { kind: 'embeddedModel', model: coordinate },
            subject,
            key: ownStoredNameOf(destination, name),
            field,
            statement: statements.find(
              (statement): statement is ResolvedFieldBackfillStatement =>
                statement.kind === 'backfill' &&
                statement.entity === 'field' &&
                sameField(statement.field, subject),
            ),
          },
        ];
      });
  });
}

/** The backfill statements of fields inside a field's value: of a value object field, or of a field of an embedded model. */
function nestedBackfills(
  statements: readonly ResolvedMigrationStatement[],
  contract: MongoContract,
): readonly NestedBackfillStatement[] {
  return statements.filter(
    (statement): statement is NestedBackfillStatement =>
      statement.kind === 'backfill' &&
      (statement.entity === 'valueObjectField' ||
        embeddingModelOf(contract.domain, statement.field) !== undefined),
  );
}

/** The field a fill is about, as a refusal names it. */
function fieldText(required: RequiredField, contract: MongoContract): string {
  return required.subject.kind === 'valueObjectField'
    ? `value object field "${valueObjectFieldStatementText(contract, required.subject)}"`
    : `field "${fieldStatementText(contract, required.subject)}"`;
}

/** The field as a statement names it, such as `Address.zip`. */
function statementText(required: RequiredField, contract: MongoContract): string {
  return required.subject.kind === 'valueObjectField'
    ? valueObjectFieldStatementText(contract, required.subject)
    : fieldStatementText(contract, required.subject);
}

function refused(
  required: RequiredField,
  contracts: { readonly fromContract: ContractWithDomain; readonly contract: MongoContract },
  reason: string,
  why: (advice: string) => string,
): MigrationPlannerConflict {
  if (required.statement === undefined) {
    return {
      kind: 'fieldFillRefused',
      summary: `Cannot fill ${fieldText(required, contracts.contract)}: ${reason}`,
      why: why('make the field optional in the contract'),
    };
  }
  return {
    kind: 'statementRefused',
    summary: `Cannot ${describeMigrationStatement(required.statement, contracts.fromContract, contracts.contract)}: ${reason}`,
    why: why('leave out this statement'),
    refusedStatement: required.statement,
  };
}

function placeText(place: Pick<StoredPlace, 'collection' | 'field'>): string {
  return `field "${place.field}" of collection "${place.collection}"`;
}

function unlistedRefusal(
  required: RequiredField,
  place: UnlistedPlace,
  contracts: { readonly fromContract: ContractWithDomain; readonly contract: MongoContract },
): MigrationPlannerConflict {
  const byHand = (advice: string) =>
    `Fill the key in ${placeText(place)} in a dataTransform operation of migration.ts, or ${advice}.`;
  if (place.reach.kind === 'containsItself') {
    return refused(
      required,
      contracts,
      `${placeText(place)} holds it inside "${place.reach.type}", which contains itself, so the documents can hold it at any depth`,
      (advice) =>
        `The plan fills a key at every path from a field to its objects, and a type that contains itself has no last path. ${byHand(advice)}`,
    );
  }
  return refused(
    required,
    contracts,
    `${placeText(place)} holds a ${place.reach.kind} of value objects`,
    (advice) =>
      `The plan fills a key only in a field that holds a value object, a list of them, or an embedded model. ${byHand(advice)}`,
  );
}

/** The names on the path from a document to the key: the root field, each member the path steps through, and the key. */
function namesOnPath(place: StoredPlace, key: string): readonly string[] {
  return [
    place.field,
    ...place.steps.flatMap((step) => (step.kind === 'member' ? [step.name] : [])),
    key,
  ];
}

/** Whether a unique index covers the key at a place, so that one value in every object would break it. */
function underUniqueIndex(destination: MongoSchemaIR, place: StoredPlace, key: string): boolean {
  const dotted = namesOnPath(place, key).join('.');
  return (destination.collection(place.collection)?.indexes ?? []).some(
    (index) => index.unique && index.keys.some((indexKey) => indexKey.field === dotted),
  );
}

/** One fill at one path, with the models whose documents it is planned for. */
interface PlannedFill {
  readonly required: RequiredField;
  readonly place: StoredPlace;
  readonly path: readonly JsonPathStep[];
  readonly models: string[];
}

/**
 * The places a required field is filled at: every place the destination's documents hold its value object or embedded model, in a collection the plan keeps, as the destination names them. A temporary value is not written in a collection whose control policy is not `managed`, nor where a stored name on the path cannot be rewritten; a backfill there is refused.
 */
function fillPlaces(
  required: RequiredField,
  places: readonly StoredPlace[],
  input: StoredKeyFillInput,
  contracts: { readonly fromContract: ContractWithDomain; readonly contract: MongoContract },
): Result<readonly PlannedFill[], readonly MigrationPlannerConflict[]> {
  const planned = new Map<string, PlannedFill>();
  const conflicts: MigrationPlannerConflict[] = [];
  for (const place of places) {
    if (input.schema.collection(place.collection) === undefined) continue;
    const policy = collectionControlPolicy(input.contract, place.collection);
    if (policy !== 'managed') {
      if (required.statement !== undefined) {
        conflicts.push(
          refused(
            required,
            contracts,
            `collection "${place.collection}" has control policy "${policy}"`,
            () =>
              'Statements fill only fields of collections whose control policy is "managed". Fill the field in the database yourself and leave out this statement.',
          ),
        );
      }
      continue;
    }
    const unrewritable = namesOnPath(place, required.key).find(
      (name) => unrewritableKeyReason(name) !== undefined,
    );
    if (unrewritable !== undefined) {
      if (required.statement !== undefined) {
        conflicts.push(
          refused(
            required,
            contracts,
            `the stored name "${unrewritable}" cannot be rewritten`,
            (advice) =>
              `${unrewritableKeyReason(unrewritable)}, so the plan cannot fill the key. Fill it in the database yourself, or ${advice}.`,
          ),
        );
      }
      continue;
    }
    const path: readonly JsonPathStep[] = [...place.steps, { kind: 'member', name: required.key }];
    const key = JSON.stringify([
      place.collection,
      place.field,
      jsonPathText(path),
      place.variant ?? null,
    ]);
    const known = planned.get(key);
    if (known !== undefined) {
      known.models.push(place.model.model);
      continue;
    }
    planned.set(key, { required, place, path, models: [place.model.model] });
  }
  return conflicts.length > 0 ? notOk(conflicts) : ok([...planned.values()]);
}

function plannedRewriteOf(fill: PlannedFill, contract: MongoContract): PlannedRewrite {
  return {
    kind: 'fillStoredKey',
    collection: fill.place.collection,
    field: fill.place.field,
    variant: fill.place.variant,
    model: fill.place.model,
    storedKey: { key: fieldText(fill.required, contract), together: fill.models },
  };
}

/**
 * The fills of keys inside fields' values a plan makes. A field of a value object or an embedded model that both contracts have is filled when the destination makes it required and the origin lacks it or makes it optional. A backfill statement fills it with a value the user writes in `migration.ts`. Without one, a field whose type has a temporary value gets it, unless a unique index covers it at one of its places; any other is left to the validator change's document check. Each fill acts at every place the destination's documents hold the type, nested or in lists, as the destination names them, and has the refusals of every rewrite. With no origin contract, nothing is known to have changed.
 */
export function planStoredKeyFills(
  input: StoredKeyFillInput,
): Result<readonly StoredKeyFill[], readonly MigrationPlannerConflict[]> {
  const { fromContract, contract } = input;
  const required =
    fromContract === null
      ? []
      : [
          ...valueObjectFields(fromContract, contract, input.statements),
          ...embeddedModelFields(fromContract, contract, input.statements),
        ];
  const conflicts = nestedBackfills(input.statements, contract)
    .filter((statement) => !required.some((each) => each.statement === statement))
    .map(
      (statement): MigrationPlannerConflict => ({
        kind: 'statementRefused',
        summary: `Cannot ${describeMigrationStatement(statement, fromContract ?? contract, contract)}: no existing object is known to lack it, since the origin contract has no such field that is optional, nor this value object or embedded model without it`,
        why: 'A --backfill statement fills a required field that a value object or an embedded model gains, or that was optional. Leave out this statement.',
        refusedStatement: statement,
      }),
    );
  if (fromContract === null) return conflicts.length > 0 ? notOk(conflicts) : ok([]);
  const contracts = { fromContract, contract };
  const placesOf = storedPlacesOf(contract);
  const fills: StoredKeyFill[] = [];
  for (const each of required) {
    const temporary =
      each.statement === undefined ? temporaryValueOf(each.field, input.lookups) : undefined;
    if (each.statement === undefined && temporary === undefined) continue;
    const places = placesOf(each.type);
    if (!places.ok) {
      conflicts.push(unlistedRefusal(each, places.failure, contracts));
      continue;
    }
    if (
      temporary !== undefined &&
      places.value.some((place) => underUniqueIndex(input.destination, place, each.key))
    ) {
      continue;
    }
    const planned = fillPlaces(each, places.value, input, contracts);
    if (!planned.ok) {
      conflicts.push(...planned.failure);
      continue;
    }
    for (const fill of planned.value) {
      conflicts.push(
        ...rewriteRefusals(
          plannedRewriteOf(fill, contract),
          contract,
          rewriteCollectionOf(input.schema, fill.place.collection),
        ),
      );
      fills.push({
        call: new FillStoredKeyCall({
          collection: fill.place.collection,
          field: fill.place.field,
          path: jsonPathText(fill.path),
          value:
            temporary?.expression ?? new UnfilledValue(`${statementText(each, contract)}:value`),
          ...(fill.place.variant === undefined
            ? {}
            : { filter: variantFilter(fill.place.variant) }),
        }),
        subject: each.subject,
        text: temporary?.text,
        statement: each.statement,
      });
    }
  }
  return conflicts.length > 0 ? notOk(conflicts) : ok(fills);
}
