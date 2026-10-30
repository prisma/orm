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
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import { stubLowerer } from './rename-table-fixtures';

export const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

export type MemberSpec =
  | 'scalar'
  | { readonly valueObject: string; readonly many?: boolean }
  | { readonly field: ContractValueObjectField };

export interface ColumnSpec {
  readonly field: string;
  readonly column?: string;
  readonly valueObject: string;
  readonly many?: boolean;
  readonly union?: boolean;
}

const jsonbColumn = { dataType: 'sqlite/text', codecId: 'sqlite/json@1', nullable: true };
const int4 = { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false };
export const text = { kind: 'scalar', codecId: 'sqlite/text@1' } as const;

export function reference(name: string) {
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
  if ('field' in spec) return spec.field;
  return {
    nullable: false,
    type: reference(spec.valueObject),
    ...(spec.many === true ? { many: { elementNullable: false } } : {}),
  };
}

/** A contract whose model `Place`, in table `place`, holds the columns' value objects. */
export function placeContract(
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

export function rename(
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

export function plan(
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

export function succeeded(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  return result;
}

export function conflictsOf(result: ReturnType<typeof plan>) {
  if (result.kind !== 'failure') throw new Error('expected the plan to fail');
  return result.conflicts;
}

export function renderedCalls(result: ReturnType<typeof plan>): readonly string[] {
  const rendered = succeeded(result).plan.renderTypeScript((specifier) => specifier);
  return rendered.split('\n').flatMap((line) => {
    const call = /this\.(renameStoredKey|removeStoredKey|fillStoredKey)\(.*\)/.exec(line);
    return call === null ? [] : [call[0]];
  });
}
