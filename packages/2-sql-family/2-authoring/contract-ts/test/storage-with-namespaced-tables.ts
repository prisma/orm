import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';

type LegacyStorage = Record<string, unknown> & {
  readonly tables?: Readonly<Record<string, unknown>> | null;
};

export function storageWithNamespacedTables(storage: LegacyStorage): Record<string, unknown> {
  const { tables, ...rest } = storage;
  if (tables === undefined) {
    return storage;
  }
  return {
    ...rest,
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: tables },
      },
    },
  };
}
