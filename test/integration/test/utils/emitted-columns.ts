import { readFileSync } from 'node:fs';
import { join } from 'pathe';

export interface EmittedColumn {
  readonly default?: unknown;
}

interface EmittedContract {
  readonly storage: {
    readonly namespaces: {
      readonly public: {
        readonly entries: {
          readonly table: Record<string, { readonly columns: Record<string, EmittedColumn> }>;
        };
      };
    };
  };
}

/** The columns of the one table in the `contract.json` a project directory holds. */
export function emittedColumns(projectDir: string): Record<string, EmittedColumn> {
  const contractJson: EmittedContract = JSON.parse(
    readFileSync(join(projectDir, 'contract.json'), 'utf-8'),
  );
  const tables = Object.values(contractJson.storage.namespaces.public.entries.table);
  const [table, ...rest] = tables;
  if (table === undefined || rest.length > 0) {
    throw new Error(`expected one table, got ${tables.length}`);
  }
  return table.columns;
}
