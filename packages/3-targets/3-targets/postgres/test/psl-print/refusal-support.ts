import type { Contract, ContractField } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import type { SqlPslPrintContext } from '@internal/family-sql/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { expect } from 'vitest';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { buildPostgresPslContract } from '../../src/core/psl-print/psl-contract';
import { testPrintContext } from './print-context';

export type Overrides = NonNullable<Parameters<typeof createSqlContract>[0]>;

export const PUBLIC = asNamespaceId('public');
export const INT_COLUMN = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } as const;
export const TEXT_COLUMN = { nativeType: 'text', codecId: 'pg/text@1', nullable: false } as const;
export const INT_FIELD: ContractField = {
  nullable: false,
  type: { kind: 'scalar', codecId: 'pg/int4@1' },
};
export const TEXT_FIELD: ContractField = {
  nullable: false,
  type: { kind: 'scalar', codecId: 'pg/text@1' },
};

export interface WidgetParts {
  /** Columns beside `id`. */
  readonly columns?: Record<string, unknown>;
  /** Domain fields beside `id`; each is stored in the column of the same name unless `storageFields` says otherwise. */
  readonly fields?: Record<string, ContractField>;
  readonly storageFields?: Record<string, { readonly column: string }>;
  readonly table?: Record<string, unknown>;
  readonly model?: Record<string, unknown>;
  readonly tables?: Record<string, unknown>;
  readonly models?: Record<string, unknown>;
  readonly entries?: Record<string, Record<string, unknown>>;
  readonly domain?: Record<string, unknown>;
  readonly storageNamespaces?: Record<string, unknown>;
  readonly domainNamespaces?: Record<string, unknown>;
  /** Named storage types, the `types { … }` block. */
  readonly storageTypes?: Record<string, unknown>;
  readonly contract?: Overrides;
}

/** One `Widget` model in `public`, stored in table `Widget`, with the roots the PSL source derives for it. */
export function widgetContract(parts: WidgetParts = {}): Overrides {
  const fields = { id: INT_FIELD, ...parts.fields };
  const storageFields =
    parts.storageFields ??
    Object.fromEntries(Object.keys(fields).map((name) => [name, { column: name }]));
  return {
    roots: { Widget: { namespace: PUBLIC, model: 'Widget' } },
    namespaces: {
      public: {
        models: blindCast<Record<string, never>, 'test models are checked by the serializer'>({
          Widget: {
            storage: { table: 'Widget', namespaceId: 'public', fields: storageFields },
            fields,
            relations: {},
            ...parts.model,
          },
          ...parts.models,
        }),
        ...parts.domain,
      },
      ...blindCast<Record<string, never>, 'test namespaces are checked by the serializer'>(
        parts.domainNamespaces ?? {},
      ),
    },
    storage: {
      ...(parts.storageTypes === undefined ? {} : { types: parts.storageTypes }),
      namespaces: {
        public: {
          id: 'public',
          entries: {
            table: {
              Widget: {
                columns: { id: INT_COLUMN, ...parts.columns },
                uniques: [],
                indexes: [],
                foreignKeys: [],
                primaryKey: { columns: ['id'] },
                ...parts.table,
              },
              ...parts.tables,
            },
            ...parts.entries,
          },
        },
        ...blindCast<Record<string, never>, 'test namespaces are checked by the serializer'>(
          parts.storageNamespaces ?? {},
        ),
      },
    },
    ...parts.contract,
  };
}

export function deserialize(overrides: Overrides): Contract<SqlStorage> {
  return blindCast<Contract<SqlStorage>, 'the Postgres serializer yields a SQL contract'>(
    new PostgresContractSerializer().deserializeContract(createSqlContract(overrides)),
  );
}

export function printing(
  contract: Contract<SqlStorage>,
  context: SqlPslPrintContext = testPrintContext(),
): () => unknown {
  return () => buildPostgresPslContract(contract, context);
}

export function printingWidget(
  parts: WidgetParts = {},
  context: SqlPslPrintContext = testPrintContext(),
): () => unknown {
  return printing(deserialize(widgetContract(parts)), context);
}

/** The contract with one storage namespace's entries replaced verbatim, bypassing entity hydration. */
export function withRawEntries(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  entries: Record<string, Record<string, unknown>>,
): Contract<SqlStorage> {
  const namespace = contract.storage.namespaces[namespaceId];
  return {
    ...contract,
    storage: blindCast<SqlStorage, 'a test namespace with entries the entity classes would reject'>(
      {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          [namespaceId]: { ...namespace, entries: { ...namespace?.entries, ...entries } },
        },
      },
    ),
  };
}

export function refusal(meta: Record<string, unknown>) {
  return expect.objectContaining({ code: 'CONTRACT.PRINT_UNSUPPORTED', meta });
}
