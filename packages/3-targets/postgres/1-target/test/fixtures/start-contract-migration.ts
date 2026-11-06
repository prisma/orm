import {
  type ColumnDefault,
  coreHash,
  type Contract as FrameworkContract,
  profileHash,
} from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type {
  ExecuteRequestLowerer,
  SqlControlAdapter,
} from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import { SqlStorage, type StorageColumnInput, StorageTable } from '@internal/sql-contract/types';
import type { DdlColumn } from '@internal/sql-relational-core/ast';
import type { SqlTextInput } from '@internal/sql-relational-core/contract-free';
import { blindCast } from '@internal/utils/casts';
import { applicationDomainOf } from '@repo/test-utils';
import { postgresDataTypes } from '../../src/core/data-types';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresTypeComponents } from '../postgres-type-lookups';

export type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/** A control stack whose adapter registers the Postgres codecs, which building a start schema needs, and lowers every AST to `LOWERED <n>`. */
export function codecControlStack(): ControlStack<'sql', 'postgres'> {
  let counter = 0;
  const lowerer: ExecuteRequestLowerer = {
    lower: () => ({ sql: 'UNUSED', params: [] }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async () => {
      counter += 1;
      return { sql: `LOWERED ${counter}`, params: [`p${counter}`] };
    },
  };
  return {
    target: { id: 'postgres' },
    adapter: {
      ...postgresTypeComponents[0],
      id: 'postgres-test',
      create: () => lowerer as unknown as SqlControlAdapter<'postgres'>,
      dataTypes: postgresDataTypes,
    },
    extensions: [],
  } as unknown as ControlStack<'sql', 'postgres'>;
}

/** A contract with one table `Box` (or `names.table`) whose int4 column `changed` (or `names.column`) has `changedDefault`. */
export function boxContract(
  changedDefault: ColumnDefault | undefined,
  namespaceId = 'public',
  names: { readonly table: string; readonly column: string } = { table: 'Box', column: 'changed' },
  changed: StorageColumnInput = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
): FrameworkContract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('box'),
    storage: new SqlStorage({
      storageHash: coreHash('box'),
      namespaces: {
        [namespaceId]: postgresCreateNamespace({
          id: namespaceId,
          entries: {
            table: {
              [names.table]: new StorageTable({
                columns: {
                  [names.column]:
                    changedDefault === undefined
                      ? changed
                      : { ...changed, default: changedDefault },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

export function serializedContract(contract: FrameworkContract<SqlStorage>) {
  return blindCast<
    { readonly storage: { readonly storageHash: string } },
    'a serialized contract carries its storage hash'
  >(new PostgresContractSerializer().serializeContract(contract));
}

/** A migration from `start` (or no start contract) to `end` that exposes `setDefault` and `alterColumnType`. */
export function exposedMigration(
  start: FrameworkContract<SqlStorage> | null,
  end: FrameworkContract<SqlStorage> = start ?? boxContract(undefined),
): ExposedMigration {
  const endJson = serializedContract(end);
  class ToEnd extends ExposedMigration {
    override readonly endContractJson = endJson;
  }
  if (start === null) return new ToEnd(codecControlStack());
  const startJson = serializedContract(start);
  class FromStart extends ToEnd {
    override readonly startContractJson = startJson;
  }
  return new FromStart(codecControlStack());
}

abstract class ExposedMigration extends PostgresMigration {
  override get operations(): readonly Promise<Op>[] {
    return [];
  }

  callSetDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: DdlColumn;
  }): Promise<Op> {
    return this.setDefault(options);
  }

  callAlterColumnType(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    readonly type: string;
    readonly using?: SqlTextInput;
  }): Promise<Op> {
    return this.alterColumnType(options);
  }
}
