import { toFieldName } from '@internal/family-sql/psl-infer';
import type { PslModel } from '@internal/framework-components/psl-ast';
import type { SqlTableIR } from '@internal/sql-schema-ir/types';
import { assertDefined } from '@internal/utils/assertions';
import { postgresError } from '../errors';

export type ResolvedColumnFieldName = {
  readonly fieldName: string;
  readonly fieldMap?: string | undefined;
};

export type TableColumnFieldNameMap = ReadonlyMap<string, ResolvedColumnFieldName>;

export type TopLevelNameResult = {
  readonly name: string;
  readonly map?: string | undefined;
};

export function buildFieldNamesByTable(
  tables: Record<string, SqlTableIR>,
): ReadonlyMap<string, TableColumnFieldNameMap> {
  const fieldNamesByTable = new Map<string, TableColumnFieldNameMap>();

  for (const table of Object.values(tables)) {
    const columns = Object.values(table.columns).map((column, index) => {
      const { name, map } = toFieldName(column.name);
      return {
        columnName: column.name,
        desiredFieldName: name,
        fieldMap: map,
        index,
      };
    });

    const assignmentOrder = [...columns].sort((left, right) => {
      const mapComparison =
        Number(left.fieldMap !== undefined) - Number(right.fieldMap !== undefined);
      if (mapComparison !== 0) {
        return mapComparison;
      }
      return left.index - right.index;
    });

    const usedFieldNames = new Set<string>();
    const tableFieldNames = new Map<string, ResolvedColumnFieldName>();

    for (const column of assignmentOrder) {
      const fieldName = createUniqueFieldName(column.desiredFieldName, usedFieldNames);
      usedFieldNames.add(fieldName);
      tableFieldNames.set(column.columnName, {
        fieldName,
        fieldMap: column.fieldMap,
      });
    }

    fieldNamesByTable.set(table.name, tableFieldNames);
  }

  return fieldNamesByTable;
}

export function resolveColumnFieldName(
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  tableName: string,
  columnName: string,
): string {
  return (
    fieldNamesByTable.get(tableName)?.get(columnName)?.fieldName ?? toFieldName(columnName).name
  );
}

export function createUniqueFieldName(
  desiredName: string,
  usedFieldNames: ReadonlySet<string>,
): string {
  if (!usedFieldNames.has(desiredName)) {
    return desiredName;
  }

  let counter = 2;
  while (usedFieldNames.has(`${desiredName}${counter}`)) {
    counter++;
  }
  return `${desiredName}${counter}`;
}

export function buildTopLevelNameMap(
  sources: Iterable<string>,
  normalize: (source: string) => TopLevelNameResult,
  kind: 'model' | 'enum',
  sourceKind: 'table' | 'enum type',
): Map<string, TopLevelNameResult> {
  const results = new Map<string, TopLevelNameResult>();
  const normalizedToSources = new Map<string, string[]>();

  for (const source of sources) {
    const normalized = normalize(source);
    results.set(source, normalized);
    normalizedToSources.set(normalized.name, [
      ...(normalizedToSources.get(normalized.name) ?? []),
      source,
    ]);
  }

  const duplicates = [...normalizedToSources.entries()].filter(
    ([, conflictingSources]) => conflictingSources.length > 1,
  );
  if (duplicates.length > 0) {
    const details = duplicates.map(
      ([normalizedName, conflictingSources]) =>
        `- ${kind} "${normalizedName}" from ${sourceKind}s ${conflictingSources
          .map((source) => `"${source}"`)
          .join(', ')}`,
    );
    throw postgresError(
      'CONTRACT.NAME_DUPLICATE',
      `PSL ${kind} name collisions detected:\n${details.join('\n')}`,
      { meta: { kind, names: duplicates.map(([normalizedName]) => normalizedName) } },
    );
  }

  return results;
}

export function topologicalSort(
  models: PslModel[],
  tables: Record<string, SqlTableIR>,
  modelNameMap: ReadonlyMap<string, string>,
): PslModel[] {
  const modelByName = new Map<string, PslModel>();
  for (const model of models) {
    modelByName.set(model.name, model);
  }

  const deps = new Map<string, Set<string>>();
  const tableToModel = new Map<string, string>();
  for (const tableName of Object.keys(tables)) {
    const modelName = modelNameMap.get(tableName);
    assertDefined(modelName, `topologicalSort: no model name mapped for table "${tableName}"`);
    tableToModel.set(tableName, modelName);
    deps.set(modelName, new Set());
  }

  for (const [tableName, table] of Object.entries(tables)) {
    const modelName = tableToModel.get(tableName);
    assertDefined(modelName, `topologicalSort: no model name recorded for table "${tableName}"`);
    const modelDeps = deps.get(modelName);
    assertDefined(
      modelDeps,
      `topologicalSort: no dependency set recorded for model "${modelName}"`,
    );
    for (const fk of table.foreignKeys) {
      const refModelName = tableToModel.get(fk.referencedTable);
      if (refModelName && refModelName !== modelName) {
        modelDeps.add(refModelName);
      }
    }
  }

  const result: PslModel[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const sortedNames = [...deps.keys()].sort();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);

    const nameDeps = deps.get(name);
    assertDefined(nameDeps, `topologicalSort: no dependency set recorded for model "${name}"`);
    const sortedDeps = [...nameDeps].sort();
    for (const dep of sortedDeps) {
      visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    const model = modelByName.get(name);
    assertDefined(model, `topologicalSort: no model block recorded for "${name}"`);
    result.push(model);
  }

  for (const name of sortedNames) {
    visit(name);
  }

  return result;
}
