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

type ValueObjectFieldSpec =
  | { readonly kind: 'status'; readonly nullable?: boolean; readonly many?: boolean }
  | { readonly kind: 'valueObject'; readonly name: string; readonly many?: boolean };

const publicId = asNamespaceId(UNBOUND_NAMESPACE_ID);
const jsonbColumn = { dataType: 'sqlite/text', codecId: 'sqlite/json@1', nullable: true };
const int4 = { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false };
const text = { kind: 'scalar', codecId: 'sqlite/text@1' } as const;
const listOf = { many: { elementNullable: false } } as const;

function reference(name: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: UNBOUND_NAMESPACE_ID,
    entityKind: 'valueObject',
    entityName: name,
  } as const;
}

function valueObjectFieldOf(spec: ValueObjectFieldSpec): ContractValueObjectField {
  if (spec.kind === 'valueObject') {
    return { nullable: false, type: reference(spec.name), ...(spec.many === true ? listOf : {}) };
  }
  return {
    nullable: spec.nullable ?? false,
    type: text,
    valueSet: {
      plane: 'storage',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'valueSet',
      entityName: 'Status',
    },
    ...(spec.many === true ? listOf : {}),
  };
}

/** `Ticket`, in table `ticket`, holds `Meta` in `meta` and a list of `Visit` in `visits`; enum `Status` has `values`. */
function ticketContract(
  values: Readonly<Record<string, string>>,
  valueObjects: Readonly<Record<string, Readonly<Record<string, ValueObjectFieldSpec>>>>,
  seed: string,
): Contract<SqlStorage> {
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
              ticket: new StorageTable({
                columns: { id: int4, meta: jsonbColumn, visits: jsonbColumn },
                primaryKey: { columns: ['id'], name: 'ticket_pk' },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
            },
            valueSet: { Status: { kind: 'valueSet', values: Object.values(values).sort() } },
            valueObject: Object.fromEntries(
              Object.entries(valueObjects).map(([name, members]) => [
                name,
                {
                  fields: Object.fromEntries(
                    Object.entries(members).map(([field, spec]) => [
                      field,
                      valueObjectFieldOf(spec),
                    ]),
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
          enum: {
            Status: {
              codecId: 'sqlite/text@1',
              members: Object.entries(values).map(([name, value]) => ({ name, value })),
            },
          },
          models: {
            Ticket: {
              fields: {
                id: { nullable: false, type: { kind: 'scalar', codecId: 'sqlite/integer@1' } },
                meta: { nullable: true, type: reference('Meta') },
                visits: { nullable: true, type: reference('Visit'), ...listOf },
              },
              relations: {},
              storage: {
                table: 'ticket',
                namespaceId: UNBOUND_NAMESPACE_ID,
                fields: {
                  id: { column: 'id' },
                  meta: { column: 'meta' },
                  visits: { column: 'visits' },
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

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[] = [],
) {
  return createSqliteMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: sqliteContractToSchema(from, sqliteTestTypes),
    policy: ALL_CLASSES,
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

/** The plan's calls as `migration.ts` writes them, without the contract arguments. */
function renderedCalls(result: ReturnType<typeof plan>): readonly string[] {
  const rendered = succeeded(result).plan.renderTypeScript((specifier) => specifier);
  return rendered.split('\n').flatMap((line) => {
    const call = /this\.(\w+)\(.*\)/.exec(line);
    return call === null ? [] : [call[0]];
  });
}

function storedValueCalls(result: ReturnType<typeof plan>): readonly string[] {
  return renderedCalls(result).filter((call) => /StoredValue|StoredKey/.test(call));
}

function renameValue(from: string, to: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: publicId, enum: 'Status', member: from },
    to: { namespaceId: publicId, enum: 'Status', member: to },
  };
}

const status = { kind: 'status' } as const;
const ACTIVE_ARCHIVED = { ACTIVE: 'active', ARCHIVED: 'archived' };
const ACTIVE = { ACTIVE: 'active' };
const ACTIVE_RETIRED = { ACTIVE: 'active', RETIRED: 'retired' };

function shapes(meta: Readonly<Record<string, ValueObjectFieldSpec>>) {
  return { Meta: meta, Visit: { meta: { kind: 'valueObject', name: 'Meta' } } } as const;
}

describe('SQLite planner, enum values inside value objects', () => {
  it('replaces a renamed value in a scalar member, in a list member, and in a nested value object in a list', () => {
    const valueObjects = shapes({ status, tags: { kind: 'status', many: true } });
    const statement = renameValue('ARCHIVED', 'RETIRED');
    const result = succeeded(
      plan(
        ticketContract(ACTIVE_ARCHIVED, valueObjects, 'from'),
        ticketContract(ACTIVE_RETIRED, valueObjects, 'to'),
        [statement],
      ),
    );
    expect(storedValueCalls(result)).toEqual([
      'this.replaceStoredValue({ table: "ticket", column: "meta", path: "$.status", from: "archived", to: "retired" })',
      'this.replaceStoredValue({ table: "ticket", column: "visits", path: "$[*].meta.status", from: "archived", to: "retired" })',
      'this.replaceStoredValue({ table: "ticket", column: "meta", path: "$.tags[*]", from: "archived", to: "retired" })',
      'this.replaceStoredValue({ table: "ticket", column: "visits", path: "$[*].meta.tags[*]", from: "archived", to: "retired" })',
    ]);
    expect(result.dataLoss).toEqual([]);
  });

  it('removes a value from a required member, from an optional one as JSON null, and from a list member, as one question about the enum value', async () => {
    const valueObjects = shapes({
      status,
      previous: { kind: 'status', nullable: true },
      tags: { kind: 'status', many: true },
    });
    const result = succeeded(
      plan(
        ticketContract(ACTIVE_ARCHIVED, valueObjects, 'from'),
        ticketContract(ACTIVE, valueObjects, 'to'),
      ),
    );
    expect(storedValueCalls(result)).toEqual([
      'this.removeStoredValue({ table: "ticket", column: "meta", path: "$.status", value: "archived", enumValue: { enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ table: "ticket", column: "visits", path: "$[*].meta.status", value: "archived", enumValue: { enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ table: "ticket", column: "meta", path: "$.previous", value: "archived", nullable: true, enumValue: { enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ table: "ticket", column: "visits", path: "$[*].meta.previous", value: "archived", nullable: true, enumValue: { enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ table: "ticket", column: "meta", path: "$.tags[*]", value: "archived", enumValue: { enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ table: "ticket", column: "visits", path: "$[*].meta.tags[*]", value: "archived", enumValue: { enum: "Status", member: "ARCHIVED" } })',
    ]);
    const subjects = new Set(result.dataLoss.map(({ subject }) => JSON.stringify(subject)));
    expect([...subjects]).toEqual([
      JSON.stringify({
        kind: 'enumValue',
        namespaceId: UNBOUND_NAMESPACE_ID,
        enum: 'Status',
        member: 'ARCHIVED',
      }),
    ]);
    expect(result.dataLoss).toHaveLength(6);
  });

  it('renames a value object field before it rewrites the enum value inside it, at the new path', () => {
    const statements: readonly ResolvedMigrationStatement[] = [
      {
        kind: 'rename',
        entity: 'valueObjectField',
        from: { namespaceId: publicId, valueObject: 'Meta', field: 'state' },
        to: { namespaceId: publicId, valueObject: 'Meta', field: 'status' },
      },
      renameValue('ARCHIVED', 'RETIRED'),
    ];
    expect(
      storedValueCalls(
        plan(
          ticketContract(ACTIVE_ARCHIVED, shapes({ state: status }), 'from'),
          ticketContract(ACTIVE_RETIRED, shapes({ status }), 'to'),
          statements,
        ),
      ),
    ).toEqual([
      'this.renameStoredKey({ table: "ticket", column: "meta", path: "$.state", to: "status" })',
      'this.renameStoredKey({ table: "ticket", column: "visits", path: "$[*].meta.state", to: "status" })',
      'this.replaceStoredValue({ table: "ticket", column: "meta", path: "$.status", from: "archived", to: "retired" })',
      'this.replaceStoredValue({ table: "ticket", column: "visits", path: "$[*].meta.status", from: "archived", to: "retired" })',
    ]);
  });
});
