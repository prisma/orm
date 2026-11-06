import { asNamespaceId, type ControlPolicy } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  PlanOrigin,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';

export const ALL_CLASSES_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

export const NS = asNamespaceId('__unbound__');

export interface ModelSpec {
  readonly collection: string;
  readonly fields: readonly string[];
  /** The stored name of each field stored under a name other than its own. */
  readonly storedAs?: Readonly<Record<string, string>>;
  /** The stored name of each embed relation, keyed by relation name. */
  readonly embeds?: Readonly<Record<string, string>>;
  readonly relations?: readonly string[];
  readonly base?: string;
  readonly discriminator?: string;
  readonly variants?: Readonly<Record<string, string>>;
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

export function contract(
  seed: string,
  models: Readonly<Record<string, ModelSpec>>,
  collections: Readonly<Record<string, CollectionSpec>>,
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
          models: Object.fromEntries(
            Object.entries(models).map(([name, spec]) => [
              name,
              {
                fields: Object.fromEntries(spec.fields.map((field) => [field, {}])),
                relations: Object.fromEntries([
                  ...(spec.relations ?? []).map((relation) => [
                    relation,
                    {
                      to: { model: 'Other', namespace: '__unbound__' },
                      cardinality: 'N:1',
                      on: { localFields: ['otherId'], targetFields: ['_id'] },
                    },
                  ]),
                  ...Object.keys(spec.embeds ?? {}).map((relation) => [
                    relation,
                    { to: { model: 'Embedded', namespace: '__unbound__' }, cardinality: '1:N' },
                  ]),
                ]),
                storage: {
                  collection: spec.collection,
                  fields: Object.fromEntries(
                    spec.fields.map((field) => [field, { field: spec.storedAs?.[field] ?? field }]),
                  ),
                  ...(spec.embeds === undefined
                    ? {}
                    : {
                        relations: Object.fromEntries(
                          Object.entries(spec.embeds).map(([relation, field]) => [
                            relation,
                            { field },
                          ]),
                        ),
                      }),
                },
                ...(spec.base === undefined
                  ? {}
                  : { base: { namespace: '__unbound__', model: spec.base } }),
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
      storageHash: `storage-${seed}`,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
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
}) {
  return new MongoMigrationPlanner().plan({
    contract: input.to,
    schema: new MongoSchemaIR(input.schema, { fromDatabase: false }),
    policy: input.policy ?? ALL_CLASSES_POLICY,
    fromContract: input.from,
    origin: input.origin ?? null,
    statements: input.statements ?? [],
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
}

export function planned(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const operations = (result.plan as PlannerProducedMongoMigration).operations;
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
