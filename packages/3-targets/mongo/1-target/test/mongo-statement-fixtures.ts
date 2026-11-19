import { createHash } from 'node:crypto';
import { asNamespaceId, type ControlPolicy } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  PlanOrigin,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { mongoTargetDescriptor } from '../src/core/migrations/control-target';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';

export const ALL_CLASSES_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

export const NS = asNamespaceId('__unbound__');

/** A field's type: its codec, and whether it takes null or is a list. A field without one is a required string. */
export interface FieldTypeSpec {
  readonly codecId: string;
  readonly nullable?: boolean;
  readonly many?: boolean;
  /** The value object the field holds, in place of its codec. */
  readonly valueObject?: string;
  /** The enum whose values the field takes. */
  readonly valueSet?: string;
  /** Whether the field holds a dictionary of its value object. */
  readonly dict?: boolean;
  /** The value objects a union field holds, in place of its codec. */
  readonly union?: readonly string[];
}

/** An embed relation: its stored name, the embedded model, and whether it holds one object or a list. */
export interface EmbedSpec {
  readonly field: string;
  readonly model: string;
  readonly cardinality?: '1:1' | '1:N';
}

export interface ModelSpec {
  /** Left out for a model whose documents live in another model's collection, or in none. */
  readonly collection?: string;
  readonly fields: readonly string[];
  readonly types?: Readonly<Record<string, FieldTypeSpec>>;
  /** The stored name of each field stored under a name other than its own. */
  readonly storedAs?: Readonly<Record<string, string>>;
  /** The stored name of each embed relation, keyed by relation name, embedding model `Embedded` as a list; or the relation in full. */
  readonly embeds?: Readonly<Record<string, string | EmbedSpec>>;
  readonly relations?: readonly string[];
  readonly base?: string;
  /** The model whose documents embed this one's. */
  readonly owner?: string;
  readonly discriminator?: string;
  readonly variants?: Readonly<Record<string, string>>;
}

/** An enum: its codec, a string by default, and the stored value of each member. */
export interface EnumSpec {
  readonly codecId?: string;
  readonly members: Readonly<Record<string, unknown>>;
}

export interface CollectionSpec {
  readonly unique?: readonly string[];
  readonly required?: readonly string[];
  readonly control?: ControlPolicy;
  readonly timeField?: string;
  /** The validator's whole `$jsonSchema`, in place of the one `required` gives. */
  readonly jsonSchema?: Record<string, unknown>;
}

export function jsonSchema(fields: readonly string[]) {
  return {
    bsonType: 'object',
    required: ['_id', ...fields],
    properties: Object.fromEntries([
      ['_id', { bsonType: 'objectId' }],
      ...fields.map((field) => [field, { bsonType: 'string' }]),
    ]),
    additionalProperties: false,
  };
}

/** The validator of a collection that stores one root model per entry of `fieldLists`. */
export function sharedJsonSchema(...fieldLists: readonly (readonly string[])[]) {
  return { bsonType: 'object', anyOf: fieldLists.map(jsonSchema) };
}

function validatorJsonSchemaOf(spec: CollectionSpec): Record<string, unknown> | undefined {
  return spec.jsonSchema ?? (spec.required === undefined ? undefined : jsonSchema(spec.required));
}

function valueObjectType(name: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: '__unbound__',
    entityKind: 'valueObject',
    entityName: name,
  };
}

function embedSpecOf(embed: string | EmbedSpec): EmbedSpec {
  return typeof embed === 'string' ? { field: embed, model: 'Embedded' } : embed;
}

function contractField(spec: FieldTypeSpec | undefined) {
  return {
    type:
      spec?.union !== undefined
        ? { kind: 'union', members: spec.union.map(valueObjectType) }
        : spec?.valueObject === undefined
          ? { kind: 'scalar', codecId: spec?.codecId ?? 'mongo/string@1' }
          : valueObjectType(spec.valueObject),
    nullable: spec?.nullable ?? false,
    ...(spec?.dict === true ? { dict: true } : {}),
    ...(spec?.many === true ? { many: { elementNullable: false } } : {}),
    ...(spec?.valueSet === undefined
      ? {}
      : {
          valueSet: {
            plane: 'domain',
            namespaceId: '__unbound__',
            entityKind: 'enum',
            entityName: spec.valueSet,
          },
        }),
  };
}

export function contract(
  seed: string,
  models: Readonly<Record<string, ModelSpec>>,
  collections: Readonly<Record<string, CollectionSpec>>,
  valueObjects: Readonly<Record<string, Readonly<Record<string, FieldTypeSpec>>>> = {},
  enums: Readonly<Record<string, EnumSpec>> = {},
): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          ...(Object.keys(enums).length === 0
            ? {}
            : {
                enum: Object.fromEntries(
                  Object.entries(enums).map(([name, spec]) => [
                    name,
                    {
                      codecId: spec.codecId ?? 'mongo/string@1',
                      members: Object.entries(spec.members).map(([member, value]) => ({
                        name: member,
                        value,
                      })),
                    },
                  ]),
                ),
              }),
          models: Object.fromEntries(
            Object.entries(models).map(([name, spec]) => [
              name,
              {
                fields: Object.fromEntries(
                  spec.fields.map((field) => [field, contractField(spec.types?.[field])]),
                ),
                relations: Object.fromEntries([
                  ...(spec.relations ?? []).map((relation) => [
                    relation,
                    {
                      to: { model: 'Other', namespace: '__unbound__' },
                      cardinality: 'N:1',
                      on: { localFields: ['otherId'], targetFields: ['_id'] },
                    },
                  ]),
                  ...Object.entries(spec.embeds ?? {}).map(([relation, embed]) => [
                    relation,
                    {
                      to: { model: embedSpecOf(embed).model, namespace: '__unbound__' },
                      cardinality: embedSpecOf(embed).cardinality ?? '1:N',
                    },
                  ]),
                ]),
                storage: {
                  ...(spec.collection === undefined ? {} : { collection: spec.collection }),
                  fields: Object.fromEntries(
                    spec.fields.map((field) => [field, { field: spec.storedAs?.[field] ?? field }]),
                  ),
                  ...(spec.embeds === undefined
                    ? {}
                    : {
                        relations: Object.fromEntries(
                          Object.entries(spec.embeds).map(([relation, embed]) => [
                            relation,
                            { field: embedSpecOf(embed).field },
                          ]),
                        ),
                      }),
                },
                ...(spec.base === undefined
                  ? {}
                  : { base: { namespace: '__unbound__', model: spec.base } }),
                ...(spec.owner === undefined ? {} : { owner: spec.owner }),
                ...(spec.discriminator === undefined
                  ? {}
                  : {
                      discriminator: { field: spec.discriminator },
                      variants: Object.fromEntries(
                        Object.entries(spec.variants ?? {}).map(([variant, value]) => [
                          value,
                          { namespace: '__unbound__', model: variant },
                        ]),
                      ),
                    }),
              },
            ]),
          ),
        },
      },
    },
    storage: {
      storageHash: createHash('sha256').update(seed).digest('hex'),
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            ...(Object.keys(valueObjects).length === 0
              ? {}
              : {
                  valueObject: Object.fromEntries(
                    Object.entries(valueObjects).map(([name, fields]) => [
                      name,
                      {
                        fields: Object.fromEntries(
                          Object.entries(fields).map(([field, type]) => [
                            field,
                            contractField(type),
                          ]),
                        ),
                      },
                    ]),
                  ),
                }),
            collection: Object.fromEntries(
              Object.entries(collections).map(([name, spec]) => [
                name,
                new MongoCollection({
                  indexes: (spec.unique ?? []).map((field) => ({
                    name: `${field}_1`,
                    keys: [{ field, direction: 1 as const }],
                    unique: true,
                  })),
                  ...(validatorJsonSchemaOf(spec) === undefined
                    ? {}
                    : {
                        validator: {
                          jsonSchema: validatorJsonSchemaOf(spec) ?? {},
                          validationLevel: 'strict' as const,
                          validationAction: 'error' as const,
                        },
                      }),
                  ...(spec.control === undefined ? {} : { control: spec.control }),
                  ...(spec.timeField === undefined
                    ? {}
                    : { options: { timeseries: { timeField: spec.timeField } } }),
                }),
              ]),
            ),
          },
        },
      },
    },
  } as unknown as MongoContract;
}

export function schemaCollection(
  name: string,
  spec: CollectionSpec & { readonly timeseries?: boolean } = {},
): MongoSchemaCollection {
  return new MongoSchemaCollection({
    name,
    indexes: (spec.unique ?? []).map(
      (field) =>
        new MongoSchemaIndex({ name: `${field}_1`, keys: [{ field, direction: 1 }], unique: true }),
    ),
    ...(validatorJsonSchemaOf(spec) === undefined
      ? {}
      : {
          validator: new MongoSchemaValidator({
            jsonSchema: validatorJsonSchemaOf(spec) ?? {},
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        }),
    ...(spec.timeseries
      ? { options: new MongoSchemaCollectionOptions({ timeseries: { timeField: 'at' } }) }
      : {}),
  });
}

export function plan(input: {
  readonly from: MongoContract | null;
  readonly to: MongoContract;
  readonly schema: readonly MongoSchemaCollection[];
  readonly statements?: readonly ResolvedMigrationStatement[];
  readonly policy?: MigrationOperationPolicy;
  /** The origin a migration package asserts; `db update` plans without one. */
  readonly origin?: PlanOrigin | null;
  /** The composed components, whose codecs and data types the planner reads; the MongoDB target by default. */
  readonly frameworkComponents?: Parameters<
    MongoMigrationPlanner['plan']
  >[0]['frameworkComponents'];
}) {
  return new MongoMigrationPlanner().plan({
    contract: input.to,
    schema: new MongoSchemaIR(input.schema, { fromDatabase: false }),
    policy: input.policy ?? ALL_CLASSES_POLICY,
    fromContract: input.from,
    origin: input.origin ?? null,
    statements: input.statements ?? [],
    frameworkComponents: input.frameworkComponents ?? [mongoTargetDescriptor],
    snapshotsImportPath: '../../snapshots',
  });
}

/** The operations of a plan with no unfilled placeholder. */
export function settledOperations(
  migration: PlannerProducedMongoMigration,
): readonly AnyMongoMigrationOperation[] {
  return migration.operations.map((operation) => {
    if (operation instanceof Promise) throw new Error('Expected no unfilled placeholder');
    return operation;
  });
}

/** The id, label and class of each operation of a plan, an unfilled placeholder by the operation it stands for. */
export async function listedOperations(migration: PlannerProducedMongoMigration) {
  const settled = await Promise.allSettled(migration.operations);
  return settled.map((entry) => {
    if (entry.status === 'fulfilled') {
      const { id, label, operationClass } = entry.value;
      return { id, label, operationClass };
    }
    const meta: unknown = Reflect.get(entry.reason, 'meta');
    return Reflect.get(meta ?? {}, 'operation');
  });
}

export function planned(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const operations = settledOperations(result.plan as PlannerProducedMongoMigration);
  return {
    labels: operations.map((operation) => operation.label),
    classes: operations.map((operation) => operation.operationClass),
    applied: result.appliedStatements.map((applied) => applied.operationIndexes),
    dataLoss: result.dataLoss,
  };
}

export function refusal(result: ReturnType<typeof plan>) {
  if (result.kind !== 'failure') throw new Error('Expected the plan to be refused');
  return result.conflicts.map(({ kind, summary, why }) => ({ kind, summary, why }));
}

export const renameModel = (from: string, to: string): ResolvedMigrationStatement => ({
  kind: 'rename',
  entity: 'model',
  from: { namespaceId: NS, model: from },
  to: { namespaceId: NS, model: to },
});

export const renameField = (
  fromModel: string,
  from: string,
  toModel: string,
  to: string,
): ResolvedMigrationStatement => ({
  kind: 'rename',
  entity: 'field',
  from: { namespaceId: NS, model: fromModel, field: from },
  to: { namespaceId: NS, model: toModel, field: to },
});

export const profiles = contract(
  'from',
  { Profile: { collection: 'profiles', fields: ['_id', 'name'] } },
  { profiles: { unique: ['name'], required: ['name'] } },
);
export const users = contract(
  'to',
  { User: { collection: 'users', fields: ['_id', 'name'] } },
  { users: { unique: ['name'], required: ['name'] } },
);
export const profilesSchema = [
  schemaCollection('profiles', { unique: ['name'], required: ['name'] }),
];
