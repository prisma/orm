import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Absolute path to the playground's working directory under the package. */
export const PLAYGROUND_DIR = join(packageRoot, '.playground');

/**
 * Absolute path to the gitignored multi-file scratch project the playground
 * always opens. Seeded once on first creation; an existing directory (and
 * every edit inside it) is left untouched across restarts.
 */
export const SCRATCH_DIR = join(PLAYGROUND_DIR, 'scratch');

/**
 * The scratch project's seed files: two directive-carrying files forming a
 * cross-file relation (`Order.customer` -> `Customer`) and a namespace
 * (`catalog`) reopened across both, plus one directive-less file that
 * demonstrates membership exclusion — it matches the glob but carries no
 * `// use prisma-8` directive, so it is quietly not part of the schema
 * (design-decisions.md entry 2).
 */
const SEED_FILES: Record<string, string> = {
  'customer.prisma': `// use prisma-8

model Customer {
  id     Int     @id
  name   String
  orders Order[]
}

namespace catalog {
  model Product {
    id   Int    @id
    name String
  }
}
`,
  'order.prisma': `// use prisma-8

model Order {
  id         Int      @id
  customer   Customer @relation(fields: [customerId], references: [id])
  customerId Int
}

namespace catalog {
  model Category {
    id   Int    @id
    name String
  }
}
`,
  'draft.prisma': `// This file matches the scratch glob but carries no "// use prisma-8"
// directive, so it is excluded from the schema — add the directive above
// to bring it in.

model Draft {
  id Int @id
}
`,
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isEmptyDir(path: string): Promise<boolean> {
  const entries = await readdir(path);
  return entries.length === 0;
}

async function seedScratchProject(): Promise<void> {
  await mkdir(SCRATCH_DIR, { recursive: true });
  for (const [name, contents] of Object.entries(SEED_FILES)) {
    await writeFile(join(SCRATCH_DIR, name), contents, 'utf8');
  }
}

/**
 * Writes the scratch project's `prisma.config.ts` into {@link PLAYGROUND_DIR}
 * with a glob contract source covering every `.prisma` file under
 * {@link SCRATCH_DIR}, and returns the config's path. Regenerated every run
 * (its content is deterministic and carries no user data); the scratch files
 * themselves are seeded only once, by {@link ensureScratchProject}.
 *
 * The config lives in `.playground/` (NOT the OS temp dir, NOT the user's
 * directory) for two reasons: (1) its `@prisma/orm-postgres` import resolves
 * through the workspace `node_modules`, and (2) the language server discovers
 * a document's config by walking up from the document's own path, so the
 * scratch project must live at or under this directory.
 *
 * The config mirrors the canonical postgres + PSL recipe. The language server
 * never invokes `load`, but it does exercise the pipeline for interpreter
 * diagnostics via the provider's `interpret` capability over cached artifacts.
 */
async function generateScratchProjectConfig(): Promise<string> {
  await mkdir(PLAYGROUND_DIR, { recursive: true });
  const configPath = join(PLAYGROUND_DIR, 'prisma.config.ts');
  const contents = `import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './scratch/**/*.prisma',
    output: 'output',
    extensions: [],
  }),
});
`;
  await writeFile(configPath, contents, 'utf8');
  return configPath;
}

/**
 * Ensures the scratch project exists (seeding it on first creation only,
 * never overwriting an existing one) and its config is up to date. Returns
 * the config path and every member file currently under {@link SCRATCH_DIR},
 * read fresh so added/removed/edited files are reflected on every restart.
 *
 * An entirely empty directory (created but never populated) is seeded just
 * like a missing one — there is nothing in it to preserve, so there is no
 * difference from a first run. A directory that exists and has *something*
 * in it but zero `.prisma` files (every schema file was deleted, leaving
 * other content, or a non-`.prisma` file was placed there) is left alone:
 * seeding it would write files into a directory whose contents the caller
 * evidently manages by hand. That case comes back with an empty `members`
 * list; the caller (`cli.ts`) turns it into an actionable startup error
 * instead of the browser discovering it as an empty sidebar.
 */
export async function ensureScratchProject(): Promise<{
  readonly configPath: string;
  readonly members: readonly { readonly path: string; readonly text: string }[];
}> {
  const scratchDirExists = await pathExists(SCRATCH_DIR);
  if (!scratchDirExists || (await isEmptyDir(SCRATCH_DIR))) {
    await seedScratchProject();
  }
  const configPath = await generateScratchProjectConfig();
  const entries = await readdir(SCRATCH_DIR, { recursive: true, withFileTypes: true });
  const relativePaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.prisma'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const members = await Promise.all(
    relativePaths.map(async (path) => ({ path, text: await readFile(path, 'utf8') })),
  );
  return { configPath, members };
}
