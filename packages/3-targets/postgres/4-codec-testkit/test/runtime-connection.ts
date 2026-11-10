import postgresRuntimeDriverDescriptor from '@internal/driver-postgres/runtime';
import postgresRuntimeTargetDescriptor from '@internal/target-postgres/runtime';
import type { ConformanceConnection } from '../src/index';

/** A connection through the runtime driver with the session settings the PostgreSQL target declares, as a runtime stack creates it, whose rows carry the wire values `fromWire` reads. */
export async function connectRuntimeDriver(
  url: string,
): Promise<{ readonly connection: ConformanceConnection; close(): Promise<void> }> {
  const driver = postgresRuntimeDriverDescriptor.create(
    undefined,
    postgresRuntimeTargetDescriptor.sessionSettings,
  );
  await driver.connect({ kind: 'url', url });
  return {
    connection: {
      async query(sql, params) {
        const rows: Record<string, unknown>[] = [];
        for await (const row of driver.query<Record<string, unknown>>({
          sql,
          params: [...(params ?? [])],
        })) {
          rows.push(row);
        }
        return rows;
      },
    },
    close: () => driver.close(),
  };
}
