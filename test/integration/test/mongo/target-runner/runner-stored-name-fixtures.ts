import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import { NS } from './runner-statements-fixtures';

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

export interface Spec {
  readonly collection?: string;
  /** Each field with its stored name. */
  readonly fields: Readonly<Record<string, string>>;
  /** The fields typed by the `Status` enum, and whether each holds a list. */
  readonly status?: Readonly<Record<string, 'one' | 'many'>>;
  readonly owner?: string;
  readonly embeds?: Readonly<Record<string, { readonly field: string; readonly model: string }>>;
}

export const STATUS_REF = {
  plane: 'domain',
  namespaceId: '__unbound__',
  entityKind: 'enum',
  entityName: 'Status',
};

/** A contract of the models given, with nullable string fields, the `Status` enum when members are given, and the `$jsonSchema` validator of each collection in `validators`. */
export function contract(
  storageHash: string,
  models: Readonly<Record<string, Spec>>,
  members: Readonly<Record<string, string | boolean>> = {},
  codecId = 'mongo/string@1',
  validators: Readonly<Record<string, Record<string, unknown>>> = {},
): MongoContract {
  const collections = [
    ...new Set(
      Object.values(models).flatMap(({ collection }) =>
        collection === undefined ? [] : [collection],
      ),
    ),
  ];
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'p1',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          enum: {
            Status: {
              codecId,
              members: Object.entries(members).map(([name, value]) => ({ name, value })),
            },
          },
          models: Object.fromEntries(
            Object.entries(models).map(([name, spec]) => [
              name,
              {
                fields: Object.fromEntries(
                  Object.keys(spec.fields).map((field) => [
                    field,
                    {
                      type: { kind: 'scalar', codecId },
                      nullable: true,
                      ...(spec.status?.[field] === undefined ? {} : { valueSet: STATUS_REF }),
                      ...(spec.status?.[field] === 'many'
                        ? { many: { elementNullable: false }, nullable: false }
                        : {}),
                    },
                  ]),
                ),
                relations: Object.fromEntries(
                  Object.entries(spec.embeds ?? {}).map(([relation, embed]) => [
                    relation,
                    { to: { model: embed.model, namespace: '__unbound__' }, cardinality: '1:N' },
                  ]),
                ),
                storage: {
                  ...(spec.collection === undefined ? {} : { collection: spec.collection }),
                  fields: Object.fromEntries(
                    Object.entries(spec.fields).map(([field, stored]) => [
                      field,
                      { field: stored },
                    ]),
                  ),
                  ...(spec.embeds === undefined
                    ? {}
                    : {
                        relations: Object.fromEntries(
                          Object.entries(spec.embeds).map(([relation, embed]) => [
                            relation,
                            { field: embed.field },
                          ]),
                        ),
                      }),
                },
                ...(spec.owner === undefined ? {} : { owner: spec.owner }),
              },
            ]),
          ),
        },
      },
    },
    storage: {
      storageHash,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            collection: Object.fromEntries(
              collections.map((name) => {
                const jsonSchema = validators[name];
                return [
                  name,
                  new MongoCollection(
                    jsonSchema === undefined
                      ? {}
                      : {
                          validator: {
                            jsonSchema,
                            validationLevel: 'strict',
                            validationAction: 'error',
                          },
                        },
                  ),
                ];
              }),
            ),
          },
        },
      },
    },
  } as unknown as MongoContract;
}

export const user = (collection: string, fields: Readonly<Record<string, string>>) =>
  ({ User: { collection, fields } }) as const;

export const ORIGIN = contract('from', user('users', { email: 'email', name: 'name' }));
