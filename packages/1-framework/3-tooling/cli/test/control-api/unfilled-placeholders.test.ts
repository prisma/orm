import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { PerSpacePlan } from '@internal/migration-tools/aggregate';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationWithUnfilledPlaceholders } from '../../src/control-api/operations/unfilled-placeholders';

const FILLED = `import { Migration, MigrationCLI, placeholder } from '@internal/sqlite/migration';
export default class M extends Migration {
  override get operations() {
    return [this.fillStoredKey({ table: 'user', column: 'address', path: '$.country', value: 'NO' })];
  }
}`;
const UNFILLED = FILLED.replace("'NO'", "placeholder('Address.country:value')");

function plan(edges: readonly { dirName: string; operationCount: number }[]): PerSpacePlan {
  return { migrationEdges: edges } as unknown as PerSpacePlan;
}

describe('migrationWithUnfilledPlaceholders', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-unfilled-placeholders-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  async function migration(dirName: string, source: string | undefined): Promise<void> {
    await mkdir(join(migrationsDir, 'app', dirName), { recursive: true });
    if (source !== undefined) {
      await writeFile(join(migrationsDir, 'app', dirName, 'migration.ts'), source);
    }
  }

  it('names a migration with no operations whose migration.ts calls placeholder', async () => {
    await migration('1_init', FILLED);
    await migration('2_country', UNFILLED);
    const plans = new Map([
      [
        'app',
        plan([
          { dirName: '1_init', operationCount: 0 },
          { dirName: '2_country', operationCount: 0 },
        ]),
      ],
    ]);
    expect(await migrationWithUnfilledPlaceholders(plans, ['app'], migrationsDir)).toBe(
      join(migrationsDir, 'app', '2_country'),
    );
  });

  it('skips a migration with operations, an imported but unused placeholder, and no migration.ts', async () => {
    await migration('1_filled', FILLED);
    await migration('2_emitted', UNFILLED);
    await migration('3_bare', undefined);
    const plans = new Map([
      [
        'app',
        plan([
          { dirName: '1_filled', operationCount: 0 },
          { dirName: '2_emitted', operationCount: 3 },
          { dirName: '3_bare', operationCount: 0 },
        ]),
      ],
    ]);
    expect(await migrationWithUnfilledPlaceholders(plans, ['app'], migrationsDir)).toBeUndefined();
  });
});
