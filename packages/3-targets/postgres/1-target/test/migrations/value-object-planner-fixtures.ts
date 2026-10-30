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
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresTypeComponents } from '../postgres-type-lookups';
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

const jsonbColumn = { dataType: 'pg/jsonb', codecId: 'pg/jsonb@1', nullable: true };
const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
export const text = { kind: 'scalar', codecId: 'pg/text@1' } as const;

export function reference(name: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: 'public',
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
              place: new StorageTable({
                columns: {
                  id: int4,
                  ...Object.fromEntries(columns.map((spec) => [columnOf(spec), jsonbColumn])),
                },
                primaryKey: { columns: ['id'], name: 'place_pk' },
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
        public: {
          models: {
            Place: {
              fields: {
                id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
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
                namespaceId: 'public',
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
  const namespaceId = asNamespaceId('public');
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
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, postgresTypeComponents),
    policy,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: postgresTypeComponents,
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
