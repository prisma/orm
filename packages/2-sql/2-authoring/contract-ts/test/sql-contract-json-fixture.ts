import { type ContractModelBase, UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { applicationDomainOf } from '@repo/test-utils';
import { storageWithNamespacedTables } from './storage-with-namespaced-tables';

function normalizeModels(
  models: Record<string, ContractModelBase>,
): Record<string, ContractModelBase> {
  return Object.fromEntries(
    Object.entries(models).map(([name, model]) => [
      name,
      {
        ...model,
        fields: Object.fromEntries(
          Object.entries(model.fields).map(([fieldName, field]) => [
            fieldName,
            { ...field, many: field.many ?? false },
          ]),
        ),
        relations: model.relations ?? {},
      },
    ]),
  ) as Record<string, ContractModelBase>;
}

const defaultTables = {
  User: {
    columns: {
      id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false, many: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  },
};

export function validSqlContractJson(overrides: Record<string, unknown> = {}) {
  const { models, domain, storage, ...rest } = overrides;
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: 'test',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain:
      domain ??
      applicationDomainOf({
        models: normalizeModels((models ?? {}) as Record<string, ContractModelBase>),
        namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
      }),
    storage:
      storage ??
      storageWithNamespacedTables({
        storageHash: 'test',
        tables: defaultTables,
      }),
    ...rest,
  };
}

export function withContractModels(
  base: Record<string, unknown>,
  models: Record<string, object>,
  patch: Record<string, unknown> = {},
) {
  const { domain: _domain, models: _models, ...rest } = { ...base, ...patch };
  return validSqlContractJson({
    ...rest,
    models: normalizeModels(models as Record<string, ContractModelBase>),
  });
}

export function domainModelsRecord(
  contract: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const domain = contract['domain'] as {
    namespaces: Record<string, { models: Record<string, Record<string, unknown>> }>;
  };
  return domain.namespaces[UNBOUND_DOMAIN_NAMESPACE_ID]!.models;
}

export function sqlStorageFixture(tables: Record<string, unknown>) {
  return {
    storageHash: 'test',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: tables },
      },
    },
  };
}
