import { type Contract, profileHash, type StorageHashBase } from '@internal/contract/types';
import type { OpFactoryCall } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn, type StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type {
  CodecControlHooks,
  FieldEventContext,
  SqlMigrationPlanOperation,
} from '../src/core/migrations/types';

const DATA_TYPE_OF_CODEC: Readonly<Record<string, string>> = {
  'cs/string@1': 'cs/string',
  'pg/text@1': 'pg/text',
  'pg/varchar@1': 'pg/varchar',
};

function dataTypeOf(codecId: string): string {
  const dataType = DATA_TYPE_OF_CODEC[codecId];
  if (dataType === undefined) throw new Error(`no data type listed for codec ${codecId}`);
  return dataType;
}

type Op = SqlMigrationPlanOperation<unknown>;

export function col(overrides: Partial<StorageColumn> & { codecId: string }): StorageColumn {
  return {
    dataType: dataTypeOf(overrides.codecId),
    nullable: false,
    many: false,
    ...overrides,
  };
}

export function table(columns: Record<string, StorageColumn>): StorageTable {
  return {
    columns,
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

export function contract(tables: Record<string, StorageTable>): Contract<SqlStorage> {
  const storage = new SqlStorage({
    storageHash: 'test' as StorageHashBase<string>,
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: tables },
      }),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage,
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

export function makeOp(id: string, label = id): OpFactoryCall {
  const op: Op = {
    id,
    label,
    operationClass: 'additive',
    invariantId: `inv:${id}`,
    target: { id: 'postgres' },
    precheck: [],
    execute: [{ description: label, sql: `-- ${id}` }],
    postcheck: [],
  };
  return {
    factoryName: id,
    operationClass: 'additive',
    label,
    renderTypeScript: () => `${id}()`,
    importRequirements: () => [],
    toOp: () => op,
  };
}

export interface RecordedCall {
  readonly event: 'added' | 'dropped' | 'altered';
  readonly namespaceId: string;
  readonly tableName: string;
  readonly fieldName: string;
  readonly priorCodecId: string | undefined;
  readonly newCodecId: string | undefined;
  readonly priorTablePresent: boolean;
  readonly newTablePresent: boolean;
}

export function recordingHook(
  opsPerCall: readonly OpFactoryCall[] | ((call: RecordedCall) => readonly OpFactoryCall[]),
): {
  readonly hook: CodecControlHooks;
  readonly calls: readonly RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const hook: CodecControlHooks = {
    onFieldEvent: (event, ctx: FieldEventContext) => {
      const recorded: RecordedCall = {
        event,
        namespaceId: ctx.namespaceId,
        tableName: ctx.tableName,
        fieldName: ctx.fieldName,
        priorCodecId: ctx.priorField?.codecId,
        newCodecId: ctx.newField?.codecId,
        priorTablePresent: ctx.priorTable !== undefined,
        newTablePresent: ctx.newTable !== undefined,
      };
      calls.push(recorded);
      return typeof opsPerCall === 'function' ? opsPerCall(recorded) : opsPerCall;
    },
  };
  return { hook, calls };
}
