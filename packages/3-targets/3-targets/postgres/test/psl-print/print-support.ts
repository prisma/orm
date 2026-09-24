import type {
  ApplicationDomainNamespace,
  Contract,
  ContractField,
  ContractRelation,
  ExecutionMutationDefault,
} from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import type { PslAttribute, PslField, PslModel } from '@internal/framework-components/psl-ast';
import type { SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { buildPostgresPslContract } from '../../src/core/psl-print/psl-contract';
import { testPrintContext } from './print-context';

export const INT_COLUMN = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } as const;
export const TEXT_COLUMN = { nativeType: 'text', codecId: 'pg/text@1', nullable: false } as const;

export function attributeText(attribute: PslAttribute): string {
  const prefix = attribute.target === 'model' ? '@@' : '@';
  if (attribute.args.length === 0) return `${prefix}${attribute.name}`;
  const args = attribute.args
    .map((arg) => (arg.kind === 'positional' ? arg.value : `${arg.name}: ${arg.value}`))
    .join(', ');
  return `${prefix}${attribute.name}(${args})`;
}

export function fieldText(field: PslField): string {
  const type =
    field.typeConstructor === undefined
      ? field.typeName
      : `${field.typeConstructor.path.join('.')}(${field.typeConstructor.args
          .map((arg) => (arg.kind === 'positional' ? arg.value : `${arg.name}: ${arg.value}`))
          .join(', ')})`;
  const suffix = field.list ? '[]' : field.optional ? '?' : '';
  return [`${field.name} ${type}${suffix}`, ...field.attributes.map(attributeText)].join(' ');
}

interface ModelInput {
  readonly table: string;
  readonly fields: Record<string, { readonly column: string }>;
  readonly relations?: Record<string, ContractRelation>;
}

const INT_FIELD: ContractField = {
  nullable: false,
  type: { kind: 'scalar', codecId: 'pg/int4@1' },
};

export interface ColumnShape {
  readonly [key: string]: unknown;
  readonly nativeType: string;
  readonly codecId: string;
  readonly nullable: boolean;
  readonly many?: boolean;
  readonly typeParams?: Record<string, unknown>;
}

interface TableShape {
  readonly [key: string]: unknown;
  readonly columns: Record<string, ColumnShape>;
}

/** The domain field the PSL source derives for a scalar column. */
export function domainFieldOf(column: ColumnShape | undefined): ContractField {
  if (column === undefined) return INT_FIELD;
  return {
    nullable: column.nullable,
    type: {
      kind: 'scalar',
      codecId: column.codecId,
      ...(column.typeParams === undefined ? {} : { typeParams: column.typeParams }),
    },
    ...(column.many === true ? { many: true } : {}),
  };
}

/** The roots the PSL source derives: one per model, keyed by its table. */
function rootsOf(models: Record<string, ModelInput>) {
  return Object.fromEntries(
    Object.entries(models).map(([name, model]) => [
      model.table,
      { namespace: asNamespaceId('public'), model: name },
    ]),
  );
}

export function buildModels(input: {
  readonly models: Record<string, ModelInput>;
  readonly tables: Record<string, TableShape>;
  readonly execution?: {
    readonly mutations: { readonly defaults: readonly ExecutionMutationDefault[] };
  };
}): readonly PslModel[] {
  const domainNamespace: ApplicationDomainNamespace = {
    models: Object.fromEntries(
      Object.entries(input.models).map(([name, model]) => [
        name,
        {
          storage: { table: model.table, namespaceId: 'public', fields: model.fields },
          fields: Object.fromEntries(
            Object.entries(model.fields).map(([fieldName, { column }]) => [
              fieldName,
              domainFieldOf(input.tables[model.table]?.columns[column]),
            ]),
          ),
          relations: model.relations ?? {},
        },
      ]),
    ),
  };
  const overrides = {
    roots: rootsOf(input.models),
    namespaces: { public: domainNamespace },
    storage: { namespaces: { public: { id: 'public', entries: { table: input.tables } } } },
  };
  const json =
    input.execution === undefined
      ? createSqlContract(overrides)
      : createSqlContract({ ...overrides, execution: input.execution });
  const contract = new PostgresContractSerializer().deserializeContract(json);
  const ast = buildPostgresPslContract(
    blindCast<Contract<SqlStorage>, 'the Postgres serializer yields a SQL contract'>(contract),
    testPrintContext(),
  );
  return ast.namespaces.flatMap((namespace) => namespace.models);
}

export function table(input: {
  readonly columns: Record<string, ColumnShape>;
  readonly primaryKey?: { readonly columns: readonly string[] };
  readonly uniques?: readonly unknown[];
  readonly indexes?: readonly unknown[];
  readonly foreignKeys?: readonly unknown[];
  readonly checks?: readonly unknown[];
}): TableShape {
  return {
    columns: input.columns,
    uniques: input.uniques ?? [],
    indexes: input.indexes ?? [],
    foreignKeys: input.foreignKeys ?? [],
    ...(input.checks === undefined ? {} : { checks: input.checks }),
    ...(input.primaryKey === undefined ? {} : { primaryKey: input.primaryKey }),
  };
}

export function oneModel(
  columns: Record<string, ColumnShape>,
  fields: Record<string, { column: string }>,
) {
  return buildModels({
    models: { Widget: { table: 'Widget', fields } },
    tables: { Widget: table({ columns, primaryKey: { columns: ['id'] } }) },
  })[0];
}
