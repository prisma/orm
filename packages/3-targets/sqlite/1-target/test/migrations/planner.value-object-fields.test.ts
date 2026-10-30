import { createHash } from 'node:crypto';
import {
  asNamespaceId,
  type Contract,
  type ContractValueObjectField,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
  type ResolvedValueObjectFieldRenameStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import { stubLowerer } from './rename-table-fixtures';

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

type MemberSpec = 'scalar' | { readonly valueObject: string; readonly many?: boolean };

interface ColumnSpec {
  readonly field: string;
  readonly column?: string;
  readonly valueObject: string;
  readonly many?: boolean;
  readonly union?: boolean;
}

const jsonbColumn = { dataType: 'sqlite/text', codecId: 'sqlite/json@1', nullable: true };
const int4 = { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false };
const text = { kind: 'scalar', codecId: 'sqlite/text@1' } as const;

function reference(name: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: UNBOUND_NAMESPACE_ID,
    entityKind: 'valueObject',
    entityName: name,
  } as const;
}

function member(spec: MemberSpec): ContractValueObjectField {
  if (spec === 'scalar') return { nullable: false, type: text };
  return {
    nullable: false,
    type: reference(spec.valueObject),
    ...(spec.many === true ? { many: { elementNullable: false } } : {}),
  };
}

/** A contract whose model `Place`, in table `place`, holds the columns' value objects. */
function placeContract(
  valueObjects: Readonly<Record<string, Readonly<Record<string, MemberSpec>>>>,
  columns: readonly ColumnSpec[],
  seed: string,
): Contract<SqlStorage> {
  const columnOf = (spec: ColumnSpec) => spec.column ?? spec.field;
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(createHash('sha256').update(seed).digest('hex')),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              place: new StorageTable({
                columns: {
                  id: int4,
                  ...Object.fromEntries(columns.map((spec) => [columnOf(spec), jsonbColumn])),
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
            },
            valueObject: Object.fromEntries(
              Object.entries(valueObjects).map(([name, members]) => [
                name,
                {
                  fields: Object.fromEntries(
                    Object.entries(members).map(([field, spec]) => [field, member(spec)]),
                  ),
                },
              ]),
            ),
          },
        }),
      },
    }),
    roots: {},
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          models: {
            Place: {
              fields: {
                id: { nullable: false, type: { kind: 'scalar', codecId: 'sqlite/integer@1' } },
                ...Object.fromEntries(
                  columns.map((spec) => [
                    spec.field,
                    spec.union === true
                      ? {
                          nullable: true,
                          type: { kind: 'union', members: [text, reference(spec.valueObject)] },
                        }
                      : {
                          nullable: true,
                          type: reference(spec.valueObject),
                          ...(spec.many === true ? { many: { elementNullable: false } } : {}),
                        },
                  ]),
                ),
              },
              relations: {},
              storage: {
                table: 'place',
                namespaceId: UNBOUND_NAMESPACE_ID,
                fields: {
                  id: { column: 'id' },
                  ...Object.fromEntries(
                    columns.map((spec) => [spec.field, { column: columnOf(spec) }]),
                  ),
                },
              },
            },
          },
        },
      },
    },
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function rename(
  valueObject: string,
  from: string,
  to: string,
): ResolvedValueObjectFieldRenameStatement {
  const namespaceId = asNamespaceId(UNBOUND_NAMESPACE_ID);
  return {
    kind: 'rename',
    entity: 'valueObjectField',
    from: { namespaceId, valueObject, field: from },
    to: { namespaceId, valueObject, field: to },
  };
}

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[] = [],
  policy: MigrationOperationPolicy = ALL_CLASSES,
) {
  return createSqliteMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: sqliteContractToSchema(from, sqliteTestTypes),
    policy,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: sqliteTestComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

function succeeded(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  return result;
}

function conflictsOf(result: ReturnType<typeof plan>) {
  if (result.kind !== 'failure') throw new Error('expected the plan to fail');
  return result.conflicts;
}

function renderedCalls(result: ReturnType<typeof plan>): readonly string[] {
  const rendered = succeeded(result).plan.renderTypeScript((specifier) => specifier);
  return rendered.split('\n').flatMap((line) => {
    const call = /this\.(renameStoredKey|removeStoredKey)\(.*\)/.exec(line);
    return call === null ? [] : [call[0]];
  });
}

const GEO = { lat: 'scalar', lng: 'scalar' } as const;
const GEO_RENAMED = { latitude: 'scalar', lng: 'scalar' } as const;
const location = { field: 'location', valueObject: 'GeoPoint' };

describe('SQLite planner, value object fields', () => {
  it('renames the key in a column that holds the value object, and gives the statement its operation', () => {
    const statement = rename('GeoPoint', 'lat', 'latitude');
    const result = succeeded(
      plan(
        placeContract({ GeoPoint: GEO }, [location], 'from'),
        placeContract({ GeoPoint: GEO_RENAMED }, [location], 'to'),
        [statement],
      ),
    );
    expect(renderedCalls(result)).toEqual([
      'this.renameStoredKey({ table: "place", column: "location", path: "$.lat", to: "latitude" })',
    ]);
    expect(result.appliedStatements).toEqual([{ statement, operationIndexes: [0] }]);
    expect(result.dataLoss).toEqual([]);
  });

  it('renames the key in every element of a list column', () => {
    const stops = { field: 'stops', valueObject: 'GeoPoint', many: true };
    expect(
      renderedCalls(
        plan(
          placeContract({ GeoPoint: GEO }, [stops], 'from'),
          placeContract({ GeoPoint: GEO_RENAMED }, [stops], 'to'),
          [rename('GeoPoint', 'lat', 'latitude')],
        ),
      ),
    ).toEqual([
      'this.renameStoredKey({ table: "place", column: "stops", path: "$[*].lat", to: "latitude" })',
    ]);
  });

  it('renames an outer key before an inner one, writing the inner path with the new outer name', () => {
    const address = { field: 'address', valueObject: 'Address' };
    expect(
      renderedCalls(
        plan(
          placeContract(
            {
              GeoPoint: GEO,
              Address: {
                point: { valueObject: 'GeoPoint' },
                history: { valueObject: 'GeoPoint', many: true },
              },
            },
            [address],
            'from',
          ),
          placeContract(
            {
              GeoPoint: GEO_RENAMED,
              Address: {
                location: { valueObject: 'GeoPoint' },
                history: { valueObject: 'GeoPoint', many: true },
              },
            },
            [address],
            'to',
          ),
          [rename('GeoPoint', 'lat', 'latitude'), rename('Address', 'point', 'location')],
        ),
      ),
    ).toEqual([
      'this.renameStoredKey({ table: "place", column: "address", path: "$.point", to: "location" })',
      'this.renameStoredKey({ table: "place", column: "address", path: "$.location.lat", to: "latitude" })',
      'this.renameStoredKey({ table: "place", column: "address", path: "$.history[*].lat", to: "latitude" })',
    ]);
  });

  it('writes the key rename under the new name of a column the same plan renames', () => {
    const result = plan(
      placeContract({ GeoPoint: GEO }, [location], 'from'),
      placeContract({ GeoPoint: GEO_RENAMED }, [{ ...location, field: 'where' }], 'to'),
      [
        {
          kind: 'rename',
          entity: 'field',
          from: {
            namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
            model: 'Place',
            field: 'location',
          },
          to: { namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID), model: 'Place', field: 'where' },
        },
        rename('GeoPoint', 'lat', 'latitude'),
      ],
    );
    expect(renderedCalls(result)).toEqual([
      'this.renameStoredKey({ table: "place", column: "where", path: "$.lat", to: "latitude" })',
    ]);
  });

  it('removes a field the destination lacks, and names the value object field as the subject', async () => {
    const result = succeeded(
      plan(
        placeContract({ GeoPoint: GEO }, [location], 'from'),
        placeContract({ GeoPoint: { lat: 'scalar' } }, [location], 'to'),
      ),
    );
    expect(renderedCalls(result)).toEqual([
      'this.removeStoredKey({ table: "place", column: "location", path: "$.lng" })',
    ]);
    const ops = await Promise.all(result.plan.operations);
    expect(result.dataLoss).toEqual([
      {
        operationIndex: ops.findIndex((op) => op.label.startsWith('Remove key')),
        subject: {
          kind: 'valueObjectField',
          namespaceId: UNBOUND_NAMESPACE_ID,
          valueObject: 'GeoPoint',
          field: 'lng',
        },
        loss: 'drop',
        label: 'Remove key "lng" at path "$" in column "location" of "place"',
      },
    ]);
  });

  it('refuses a removal under a policy that does not allow destructive operations', () => {
    const conflicts = conflictsOf(
      plan(
        placeContract({ GeoPoint: GEO }, [location], 'from'),
        placeContract({ GeoPoint: { lat: 'scalar' } }, [location], 'to'),
        [],
        { allowedOperationClasses: ['additive', 'widening'] },
      ),
    );
    expect(conflicts.map(({ summary }) => summary)).toEqual([
      'Operation "Remove key "lng" at path "$" in column "location" of "place"" requires class "destructive", but policy allows only: additive, widening',
    ]);
  });

  it('refuses a rename through a value object that contains itself', () => {
    const items = { field: 'items', valueObject: 'NavItem', many: true };
    const nav = (label: Readonly<Record<string, MemberSpec>>) => ({
      NavItem: {
        children: { valueObject: 'NavItem', many: true },
        label: { valueObject: 'Label' },
      },
      Label: label,
    });
    const statement = rename('Label', 'text', 'caption');
    expect(
      conflictsOf(
        plan(
          placeContract(nav({ text: 'scalar' }), [items], 'from'),
          placeContract(nav({ caption: 'scalar' }), [items], 'to'),
          [statement],
        ),
      ),
    ).toMatchObject([{ kind: 'statementRefused', refusedStatement: statement }]);
  });

  it('refuses a rename in a column that holds a union of value objects', () => {
    const union = { ...location, union: true };
    expect(
      conflictsOf(
        plan(
          placeContract({ GeoPoint: GEO }, [union], 'from'),
          placeContract({ GeoPoint: GEO_RENAMED }, [union], 'to'),
          [rename('GeoPoint', 'lat', 'latitude')],
        ),
      ),
    ).toMatchObject([
      {
        summary: expect.stringContaining(
          'column "location" of "place" holds a union of value objects',
        ),
      },
    ]);
  });
});
