import type { DeclaredIndexes } from './introspection';

type Loose = Readonly<Record<string, unknown>>;

function isLoose(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null;
}

function child(value: unknown, key: string): Loose | undefined {
  const found = isLoose(value) ? value[key] : undefined;
  return isLoose(found) ? found : undefined;
}

function tableIndexKey(tableName: string, indexName: string): string {
  return JSON.stringify([tableName, indexName]);
}

/** The indexes the contract handed to introspection declares, read from every contract space it holds. */
export function declaredIndexes(contract: unknown): DeclaredIndexes {
  const contracts =
    isLoose(contract) && Array.isArray(contract['contracts']) ? contract['contracts'] : [contract];
  const declared = new Set<string>();
  const declaredUnique = new Set<string>();
  for (const space of contracts) {
    for (const namespace of Object.values(child(child(space, 'storage'), 'namespaces') ?? {})) {
      for (const [tableName, table] of Object.entries(
        child(child(namespace, 'entries'), 'table') ?? {},
      )) {
        const indexes = isLoose(table) ? table['indexes'] : undefined;
        for (const index of Array.isArray(indexes) ? indexes : []) {
          if (!isLoose(index) || typeof index['name'] !== 'string') continue;
          const key = tableIndexKey(tableName, index['name']);
          declared.add(key);
          if (index['unique'] === true) declaredUnique.add(key);
        }
      }
    }
  }
  return {
    declaresIndex: (tableName, indexName) => declared.has(tableIndexKey(tableName, indexName)),
    declaresUniqueIndex: (tableName, indexName) =>
      declaredUnique.has(tableIndexKey(tableName, indexName)),
  };
}
