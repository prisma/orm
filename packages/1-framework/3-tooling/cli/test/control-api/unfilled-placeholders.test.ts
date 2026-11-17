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

  describe('reads the code of migration.ts, not its text', () => {
    async function unfilled(source: string): Promise<string | undefined> {
      await migration('1_country', source);
      return migrationWithUnfilledPlaceholders(
        new Map([['app', plan([{ dirName: '1_country', operationCount: 0 }])]]),
        ['app'],
        migrationsDir,
      );
    }
    const named = join('app', '1_country');

    it.each([
      [
        'a comment',
        FILLED.replace("'NO'", "'NO' /* fill placeholder('x') later */ // placeholder("),
      ],
      ['a string', FILLED.replace("'NO'", '"call placeholder(here)"')],
      ['a template string', FILLED.replace("'NO'", `\`placeholder(${'$'}{1})\``)],
      [
        'a function of its own named placeholder',
        `import { Migration } from '@internal/sqlite/migration';
import { placeholder } from './helpers';
function local() { return placeholder('x'); }
export default class M extends Migration {}`,
      ],
      ['a method named placeholder', FILLED.replace("'NO'", "this.placeholder('x')")],
    ])('finds no placeholder in %s', async (_, source) => {
      expect(await unfilled(source)).toBeUndefined();
    });

    it.each([
      [
        'an import under another name',
        UNFILLED.replace('placeholder }', 'placeholder as fill }').replace(
          "placeholder('Address",
          "fill('Address",
        ),
      ],
      [
        'a namespace import',
        `import * as m from '@prisma/orm-postgres/migration';
export default class M extends m.Migration {
  override get operations() { return [this.fillStoredKey({ value: m.placeholder('x') })]; }
}`,
      ],
      ['a template expression', FILLED.replace("'NO'", `\`${'$'}{placeholder('x')}\``)],
    ])('finds a placeholder called through %s', async (_, source) => {
      expect(await unfilled(source)).toBe(join(migrationsDir, named));
    });
  });
});
