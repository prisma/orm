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
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { stubLowerer } from './rename-table-fixtures';

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

type MemberSpec =
  | { readonly kind: 'status'; readonly nullable?: boolean; readonly many?: boolean }
  | { readonly kind: 'valueObject'; readonly name: string; readonly many?: boolean };

const publicId = asNamespaceId('public');
const jsonbColumn = { dataType: 'pg/jsonb', codecId: 'pg/jsonb@1', nullable: true };
const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
const text = { kind: 'scalar', codecId: 'pg/text@1' } as const;
const listOf = { many: { elementNullable: false } } as const;

function reference(name: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: 'public',
    entityKind: 'valueObject',
    entityName: name,
  } as const;
}

function memberOf(spec: MemberSpec): ContractValueObjectField {
  if (spec.kind === 'valueObject') {
    return { nullable: false, type: reference(spec.name), ...(spec.many === true ? listOf : {}) };
  }
  return {
    nullable: spec.nullable ?? false,
    type: text,
    valueSet: {
      plane: 'storage',
      namespaceId: 'public',
      entityKind: 'valueSet',
      entityName: 'Status',
    },
    ...(spec.many === true ? listOf : {}),
  };
}

/** `Ticket`, in table `ticket`, holds `Meta` in `meta` and a list of `Visit` in `visits`; enum `Status` has `values`. */
function ticketContract(
  values: Readonly<Record<string, string>>,
  valueObjects: Readonly<Record<string, Readonly<Record<string, MemberSpec>>>>,
  seed: string,
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(createHash('sha256').update(seed).digest('hex')),
      namespaces: {
        public: postgresCreateNamespace({
          id: 'public',
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
                    Object.entries(members).map(([field, spec]) => [field, memberOf(spec)]),
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
        public: {
          enum: {
            Status: {
              codecId: 'pg/text@1',
              members: Object.entries(values).map(([name, value]) => ({ name, value })),
            },
          },
          models: {
            Ticket: {
              fields: {
                id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
                meta: { nullable: true, type: reference('Meta') },
                visits: { nullable: true, type: reference('Visit'), ...listOf },
              },
              relations: {},
              storage: {
                table: 'ticket',
                namespaceId: 'public',
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
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, postgresTypeComponents),
    policy: ALL_CLASSES,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: postgresTypeComponents,
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

function shapes(meta: Readonly<Record<string, MemberSpec>>) {
  return { Meta: meta, Visit: { meta: { kind: 'valueObject', name: 'Meta' } } } as const;
}

describe('Postgres planner, enum values inside value objects', () => {
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
      'this.replaceStoredValue({ schema: "public", table: "ticket", column: "meta", path: "$.status", from: "archived", to: "retired" })',
      'this.replaceStoredValue({ schema: "public", table: "ticket", column: "visits", path: "$[*].meta.status", from: "archived", to: "retired" })',
      'this.replaceStoredValue({ schema: "public", table: "ticket", column: "meta", path: "$.tags[*]", from: "archived", to: "retired" })',
      'this.replaceStoredValue({ schema: "public", table: "ticket", column: "visits", path: "$[*].meta.tags[*]", from: "archived", to: "retired" })',
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
      'this.removeStoredValue({ schema: "public", table: "ticket", column: "meta", path: "$.status", value: "archived", enumValue: { namespaceId: "public", enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ schema: "public", table: "ticket", column: "visits", path: "$[*].meta.status", value: "archived", enumValue: { namespaceId: "public", enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ schema: "public", table: "ticket", column: "meta", path: "$.previous", value: "archived", nullable: true, enumValue: { namespaceId: "public", enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ schema: "public", table: "ticket", column: "visits", path: "$[*].meta.previous", value: "archived", nullable: true, enumValue: { namespaceId: "public", enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ schema: "public", table: "ticket", column: "meta", path: "$.tags[*]", value: "archived", enumValue: { namespaceId: "public", enum: "Status", member: "ARCHIVED" } })',
      'this.removeStoredValue({ schema: "public", table: "ticket", column: "visits", path: "$[*].meta.tags[*]", value: "archived", enumValue: { namespaceId: "public", enum: "Status", member: "ARCHIVED" } })',
    ]);
    const subjects = new Set(result.dataLoss.map(({ subject }) => JSON.stringify(subject)));
    expect([...subjects]).toEqual([
      JSON.stringify({
        kind: 'enumValue',
        namespaceId: 'public',
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
      'this.renameStoredKey({ schema: "public", table: "ticket", column: "meta", path: "$.state", to: "status" })',
      'this.renameStoredKey({ schema: "public", table: "ticket", column: "visits", path: "$[*].meta.state", to: "status" })',
      'this.replaceStoredValue({ schema: "public", table: "ticket", column: "meta", path: "$.status", from: "archived", to: "retired" })',
      'this.replaceStoredValue({ schema: "public", table: "ticket", column: "visits", path: "$[*].meta.status", from: "archived", to: "retired" })',
    ]);
  });
});
