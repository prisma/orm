import {
  asNamespaceId,
  type Contract,
  type ContractField,
  type ContractValueObjectField,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import type {
  ResolvedEnumValueRenameStatement,
  ResolvedValueObjectFieldRenameStatement,
} from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { planEnumValueRewrites } from '../src/core/migrations/enum-value-planning';
import type { SchemaTables } from '../src/core/migrations/schema-tables';

type ValueObjectFieldSpec =
  | { readonly kind: 'status'; readonly nullable?: boolean; readonly many?: boolean }
  | { readonly kind: 'scalar' }
  | { readonly kind: 'valueObject'; readonly name: string; readonly many?: boolean };

interface ColumnSpec {
  readonly field: string;
  readonly valueObject?: string;
  readonly many?: boolean;
  readonly union?: boolean;
}

const NAMESPACE = 'app';
const textType = { kind: 'scalar', codecId: 'test/text@1' } as const;
const listOf = { many: { elementNullable: false } } as const;

function valueObjectType(name: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: NAMESPACE,
    entityKind: 'valueObject',
    entityName: name,
  } as const;
}

function valueObjectFieldOf(spec: ValueObjectFieldSpec): ContractValueObjectField {
  if (spec.kind === 'scalar') return { nullable: false, type: textType };
  if (spec.kind === 'valueObject') {
    return {
      nullable: false,
      type: valueObjectType(spec.name),
      ...(spec.many === true ? listOf : {}),
    };
  }
  return {
    nullable: spec.nullable ?? false,
    type: textType,
    valueSet: {
      plane: 'storage',
      namespaceId: NAMESPACE,
      entityKind: 'valueSet',
      entityName: 'Status',
    },
    ...(spec.many === true ? listOf : {}),
  };
}

function fieldOf(spec: ColumnSpec): ContractField {
  if (spec.valueObject === undefined) {
    return {
      nullable: true,
      type: textType,
      valueSet: {
        plane: 'domain',
        namespaceId: NAMESPACE,
        entityKind: 'enum',
        entityName: 'Status',
      },
    };
  }
  const reference = valueObjectType(spec.valueObject);
  if (spec.union === true) {
    return { nullable: true, type: { kind: 'union', members: [textType, reference] } };
  }
  return { nullable: true, type: reference, ...(spec.many === true ? listOf : {}) };
}

/** A contract whose model `Ticket`, in table `ticket`, holds the columns, with enum `Status`. */
function contractWith(options: {
  readonly members: Readonly<Record<string, string>>;
  readonly valueObjects: Readonly<Record<string, Readonly<Record<string, ValueObjectFieldSpec>>>>;
  readonly columns: readonly ColumnSpec[];
}): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [NAMESPACE]: createTestSqlNamespace({
          id: NAMESPACE,
          entries: {
            valueObject: Object.fromEntries(
              Object.entries(options.valueObjects).map(([name, members]) => [
                name,
                {
                  fields: Object.fromEntries(
                    Object.entries(members).map(([member, spec]) => [
                      member,
                      valueObjectFieldOf(spec),
                    ]),
                  ),
                },
              ]),
            ),
            table: {
              ticket: new StorageTable({
                columns: Object.fromEntries(
                  options.columns.map((column) => [
                    column.field,
                    {
                      dataType: column.valueObject === undefined ? 'test/text' : 'test/json',
                      codecId: column.valueObject === undefined ? 'test/text@1' : 'test/json@1',
                      nullable: true,
                    },
                  ]),
                ),
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
            },
          },
        }),
      },
    }),
    domain: {
      namespaces: {
        [NAMESPACE]: {
          enum: {
            Status: {
              codecId: 'test/text@1',
              members: Object.entries(options.members).map(([name, value]) => ({ name, value })),
            },
          },
          models: {
            Ticket: {
              fields: Object.fromEntries(
                options.columns.map((column) => [column.field, fieldOf(column)]),
              ),
              relations: {},
              storage: {
                table: 'ticket',
                namespaceId: NAMESPACE,
                fields: Object.fromEntries(
                  options.columns.map((column) => [column.field, { column: column.field }]),
                ),
              },
            },
          },
        },
      },
    },
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const allTables: SchemaTables = {
  hasTable: () => true,
  hasColumn: () => true,
  tablesNamed: () => [],
  columnsNamed: () => [],
  namespacesWithTable: () => [],
  hasNamespace: () => true,
};

const noCodecs = { descriptorFor: () => undefined };

function renameValue(from: string, to: string): ResolvedEnumValueRenameStatement {
  const namespaceId = asNamespaceId(NAMESPACE);
  return {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId, enum: 'Status', member: from },
    to: { namespaceId, enum: 'Status', member: to },
  };
}

function renameMember(
  valueObject: string,
  from: string,
  to: string,
): ResolvedValueObjectFieldRenameStatement {
  const namespaceId = asNamespaceId(NAMESPACE);
  return {
    kind: 'rename',
    entity: 'valueObjectField',
    from: { namespaceId, valueObject, field: from },
    to: { namespaceId, valueObject, field: to },
  };
}

function plan(
  from: Parameters<typeof contractWith>[0],
  to: Parameters<typeof contractWith>[0],
  statements: Parameters<typeof planEnumValueRewrites>[0]['statements'] = [],
) {
  return planEnumValueRewrites({
    statements,
    fromContract: contractWith(from),
    contract: contractWith(to),
    tables: allTables,
    codecs: noCodecs,
  });
}

function places(result: ReturnType<typeof planEnumValueRewrites>) {
  if (!result.ok) throw new Error(`expected rewrites, got: ${result.failure.summary}`);
  return result.value.map(({ column, codecRef, many, member, from, to }) => ({
    column,
    codecRef,
    many,
    member,
    from,
    to,
  }));
}

function refusal(result: ReturnType<typeof planEnumValueRewrites>) {
  if (result.ok) throw new Error('expected a refusal');
  return result.failure;
}

const ACTIVE_ARCHIVED = { ACTIVE: 'active', ARCHIVED: 'archived' };
const ACTIVE = { ACTIVE: 'active' };
const meta = { field: 'meta', valueObject: 'Meta' };
const status = { kind: 'status' } as const;

describe('planEnumValueRewrites, members of value objects', () => {
  it('removes a value from a required member of a value object column, as a JSON value at its path', () => {
    const valueObjects = { Meta: { status } };
    expect(
      places(
        plan(
          { members: ACTIVE_ARCHIVED, valueObjects, columns: [meta] },
          { members: ACTIVE, valueObjects, columns: [meta] },
        ),
      ),
    ).toEqual([
      {
        column: 'meta',
        codecRef: undefined,
        many: false,
        member: { path: '$.status', nullable: false },
        from: 'archived',
        to: undefined,
      },
    ]);
  });

  it('removes a value from an optional member, which takes JSON null, and from each element of a list member', () => {
    const valueObjects = {
      Meta: {
        status: { kind: 'status', nullable: true },
        tags: { kind: 'status', many: true },
      },
    } as const;
    expect(
      places(
        plan(
          { members: ACTIVE_ARCHIVED, valueObjects, columns: [meta] },
          { members: ACTIVE, valueObjects, columns: [meta] },
        ),
      ).map(({ member }) => member),
    ).toEqual([
      { path: '$.status', nullable: true },
      { path: '$.tags[*]', nullable: false },
    ]);
  });

  it('replaces a renamed value in the column the enum types and in the members of value objects, nested and in lists', () => {
    const valueObjects = {
      Meta: { status },
      Visit: { meta: { kind: 'valueObject', name: 'Meta' } },
    } as const;
    const columns = [
      { field: 'status' },
      meta,
      { field: 'visits', valueObject: 'Visit', many: true },
    ];
    expect(
      places(
        plan(
          { members: ACTIVE_ARCHIVED, valueObjects, columns },
          { members: { ACTIVE: 'active', RETIRED: 'retired' }, valueObjects, columns },
          [renameValue('ARCHIVED', 'RETIRED')],
        ),
      ),
    ).toEqual([
      {
        column: 'status',
        codecRef: { codecId: 'test/text@1' },
        many: false,
        member: undefined,
        from: 'archived',
        to: 'retired',
      },
      {
        column: 'meta',
        codecRef: undefined,
        many: false,
        member: { path: '$.status', nullable: false },
        from: 'archived',
        to: 'retired',
      },
      {
        column: 'visits',
        codecRef: undefined,
        many: false,
        member: { path: '$[*].meta.status', nullable: false },
        from: 'archived',
        to: 'retired',
      },
    ]);
  });

  it('writes the path with the destination names when the same plan renames the member', () => {
    expect(
      places(
        plan(
          { members: ACTIVE_ARCHIVED, valueObjects: { Meta: { state: status } }, columns: [meta] },
          { members: ACTIVE, valueObjects: { Meta: { status } }, columns: [meta] },
          [renameMember('Meta', 'state', 'status')],
        ),
      ).map(({ member }) => member),
    ).toEqual([{ path: '$.status', nullable: false }]);
  });

  it('plans nothing for a member of another value set, or when no value changes', () => {
    const valueObjects = { Meta: { note: { kind: 'scalar' } } } as const;
    expect(
      places(
        plan(
          { members: ACTIVE_ARCHIVED, valueObjects, columns: [meta] },
          { members: ACTIVE, valueObjects, columns: [meta] },
        ),
      ),
    ).toEqual([]);
    const union = { field: 'meta', valueObject: 'Meta', union: true };
    expect(
      places(
        plan(
          { members: ACTIVE, valueObjects: { Meta: { status } }, columns: [union] },
          { members: ACTIVE, valueObjects: { Meta: { status } }, columns: [union] },
        ),
      ),
    ).toEqual([]);
  });

  it('refuses a removal when a column holds a union of value objects with the member', () => {
    const union = { field: 'meta', valueObject: 'Meta', union: true };
    const result = plan(
      { members: ACTIVE_ARCHIVED, valueObjects: { Meta: { status } }, columns: [union] },
      { members: ACTIVE, valueObjects: { Meta: { status } }, columns: [union] },
    );
    expect(refusal(result)).toEqual({
      kind: 'unsupportedOperation',
      summary:
        'Cannot remove enum value "Status.ARCHIVED": column "meta" of "ticket" holds a union of value objects',
      why: 'The plan rewrites an enum value inside JSON only in a column that holds a value object or a list of them. Write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the JSON of column "meta" of "ticket" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
    });
  });

  it('refuses a rename statement when a column holds a union of value objects with the member, as the statement', () => {
    const union = { field: 'meta', valueObject: 'Meta', union: true };
    const statement = renameValue('ARCHIVED', 'RETIRED');
    const result = plan(
      { members: ACTIVE_ARCHIVED, valueObjects: { Meta: { status } }, columns: [union] },
      {
        members: { ACTIVE: 'active', RETIRED: 'retired' },
        valueObjects: { Meta: { status } },
        columns: [union],
      },
      [statement],
    );
    expect(refusal(result)).toEqual({
      kind: 'statementRefused',
      summary:
        'Cannot rename enum value "Status.ARCHIVED" to "Status.RETIRED": column "meta" of "ticket" holds a union of value objects',
      why: 'The plan rewrites an enum value inside JSON only in a column that holds a value object or a list of them. Write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the JSON of column "meta" of "ticket" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
      refusedStatement: statement,
    });
  });

  it('refuses a removal when a column holds the member inside a value object that contains itself', () => {
    const valueObjects = {
      NavItem: { status, children: { kind: 'valueObject', name: 'NavItem', many: true } },
    } as const;
    const items = { field: 'items', valueObject: 'NavItem', many: true };
    expect(
      refusal(
        plan(
          { members: ACTIVE_ARCHIVED, valueObjects, columns: [items] },
          { members: ACTIVE, valueObjects, columns: [items] },
        ),
      ).summary,
    ).toBe(
      'Cannot remove enum value "Status.ARCHIVED": column "items" of "ticket" holds it inside value object "NavItem", which contains itself, so the JSON can hold it at any depth',
    );
  });
});
