import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Absolute path to the playground's working directory under the package. */
export const PLAYGROUND_DIR = join(packageRoot, '.playground');

/**
 * Writes a default-postgres `prisma.config.ts` into {@link PLAYGROUND_DIR}
 * whose contract source is `absoluteSchemaPath`, and returns the config's path.
 * This is the "without a config, assume default postgres" path.
 *
 * The config lives in `.playground/` (NOT the OS temp dir, NOT the user's
 * directory) for two reasons: (1) its `@prisma/orm-postgres` import resolves through
 * the workspace `node_modules`, and (2) the language server discovers a
 * document's config by walking up from the document's own path, so the schema
 * the editor opens must live at or under this directory. Callers therefore
 * stage the schema into `.playground/` before generating the config.
 *
 * The config mirrors the canonical postgres + PSL recipe. The language server
 * never invokes `load`, but it does exercise the pipeline for interpreter
 * diagnostics via the provider's `interpret` capability over cached artifacts.
 */
export async function generateDefaultPostgresConfig(absoluteSchemaPath: string): Promise<string> {
  await mkdir(PLAYGROUND_DIR, { recursive: true });
  const configPath = join(PLAYGROUND_DIR, 'prisma.config.ts');
  const json = JSON.stringify(absoluteSchemaPath);
  const contents = `import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: ${json},
    output: 'output',
    extensions: [],
  }),
});
`;
  await writeFile(configPath, contents, 'utf8');
  return configPath;
}
