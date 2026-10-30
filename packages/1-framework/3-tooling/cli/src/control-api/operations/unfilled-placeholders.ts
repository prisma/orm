import { readFile } from 'node:fs/promises';
import type { PerSpacePlan } from '@internal/migration-tools/aggregate';
import { join } from 'pathe';

const PLACEHOLDER_CALL = /(?<![\w$.])placeholder\s*\(/;

/**
 * The directory of the first migration to apply whose `migration.ts` still calls `placeholder(...)`.
 * `migration plan` writes such a migration with an empty `ops.json`, and `node migration.ts` writes
 * none until every placeholder is filled, so only a migration with no operations is read.
 */
export async function migrationWithUnfilledPlaceholders(
  plans: ReadonlyMap<string, PerSpacePlan>,
  applyOrder: readonly string[],
  migrationsDir: string,
): Promise<string | undefined> {
  for (const spaceId of applyOrder) {
    for (const edge of plans.get(spaceId)?.migrationEdges ?? []) {
      if (edge.operationCount !== 0) continue;
      const directory = join(migrationsDir, spaceId, edge.dirName);
      if (PLACEHOLDER_CALL.test(await migrationSource(directory))) return directory;
    }
  }
  return undefined;
}

async function migrationSource(directory: string): Promise<string> {
  try {
    return await readFile(join(directory, 'migration.ts'), 'utf-8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  }
}
