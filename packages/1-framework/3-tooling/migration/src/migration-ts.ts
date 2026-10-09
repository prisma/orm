/**
 * Utilities for reading/writing `migration.ts` files.
 *
 * Rendering migration.ts source is the target's responsibility — the CLI
 * obtains source strings from a planner's `plan.renderTypeScript()`. The
 * helper here is limited to file I/O: writing the returned source with the
 * right executable bit and probing for existence.
 */

import { stat, writeFile } from 'node:fs/promises';
import { join } from 'pathe';
import { format } from 'prettier';

const MIGRATION_TS_FILE = 'migration.ts';

/**
 * Writes a pre-rendered `migration.ts` source string to the given package
 * directory. If the source begins with a shebang, the file is written with
 * executable permissions (0o755) so it can be run directly via
 * `./migration.ts` — the rendered scaffold ends with
 * `MigrationCLI.run(import.meta.url, M)` from
 * `@internal/cli/migration-cli` (re-exported by the postgres facade),
 * which guards on the entrypoint and serializes when the file is the main
 * module.
 *
 * The source is run through prettier before writing so migration renderers
 * can produce structurally-correct but loosely-indented source and rely on
 * a single canonical format on disk. Matches what `@internal/emitter`
 * already does for generated `contract.d.ts`.
 */
export async function writeMigrationTs(packageDir: string, content: string): Promise<void> {
  const formatted = await formatMigrationTs(content);
  const isExecutable = formatted.startsWith('#!');
  await writeFile(
    join(packageDir, MIGRATION_TS_FILE),
    formatted,
    isExecutable ? { mode: 0o755 } : undefined,
  );
}

/** `source` as `writeMigrationTs` writes it: formatted by prettier. */
export async function formatMigrationTs(source: string): Promise<string> {
  return format(source, {
    parser: 'typescript',
    singleQuote: true,
    semi: true,
    printWidth: 100,
  });
}

/**
 * Checks whether a migration.ts file exists in the package directory.
 */
export async function hasMigrationTs(packageDir: string): Promise<boolean> {
  try {
    const s = await stat(join(packageDir, MIGRATION_TS_FILE));
    return s.isFile();
  } catch {
    return false;
  }
}
