import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import type { DdlNode } from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import mysqlControlTarget from '../../src/core/migrations/control-target';
import { mysqlCreateNamespace } from '../../src/core/mysql-database';
import { mysqlCodecRegistry } from '../../src/core/registry';

const codecsComponent = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'mysql',
  id: 'mysql-codecs',
  version: '0.0.1',
  types: { codecTypes: { codecDescriptors: Array.from(mysqlCodecRegistry.values()) } },
} as never;

/** The target, and a component carrying its codecs as the MySQL adapter does. */
export const frameworkComponents = [mysqlControlTarget, codecsComponent] as const;

export const int = { dataType: 'mysql/int', codecId: 'mysql/int@1', nullable: false } as const;
export const text = {
  dataType: 'sql/varchar',
  codecId: 'sql/varchar@1',
  nullable: false,
  typeParams: { length: 191 },
} as const;

export interface TableInput {
  readonly columns: Readonly<Record<string, unknown>>;
  readonly primaryKey?: { readonly columns: readonly string[] };
  readonly uniques?: readonly unknown[];
  readonly indexes?: readonly unknown[];
  readonly foreignKeys?: readonly unknown[];
  readonly checks?: readonly unknown[];
}

/** A MySQL contract holding `tables`, with a storage hash named after `name`. */
export function contractOf(
  name: string,
  tables: Readonly<Record<string, TableInput>>,
): Contract<SqlStorage> {
  return {
    target: 'mysql',
    targetFamily: 'sql',
    profileHash: profileHash(`profile-${name}`),
    storage: new SqlStorage({
      storageHash: coreHash(name),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: mysqlCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: Object.fromEntries(
              Object.entries(tables).map(([table, input]) => [
                table,
                { uniques: [], indexes: [], foreignKeys: [], ...input },
              ]),
            ),
          },
        } as never),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  } as unknown as Contract<SqlStorage>;
}

/** A lowerer that writes each DDL node as its kind and table, and each default clause as `DEFAULT <value>`. */
export const stubLowerer: ExecuteRequestLowerer = {
  lower() {
    throw new Error('not used');
  },
  async lowerToExecuteRequest(node) {
    const ddl = node as DdlNode & { readonly table?: string };
    return { sql: `${ddl.kind} ${ddl.table ?? ''}`, params: [] };
  },
  async renderColumnDefault(column) {
    return column.default === undefined
      ? ''
      : `DEFAULT ${column.default.kind === 'literal' ? JSON.stringify(column.default.value) : column.default.expression.text}`;
  },
};
