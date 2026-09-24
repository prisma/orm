import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';
import type { ImportSpecifierResolver } from '@internal/framework-components/emission';
import { detect } from 'package-manager-detector/detect';
import { basename, dirname, isAbsolute, join } from 'pathe';
import type { PackageManager } from '../commands/init/detect-package-manager';
import { formatRunCommand } from '../commands/init/detect-package-manager';
import {
  errorInitInvalidManifest,
  errorInitInvalidTsconfig,
  errorInitPrisma7ConfigCollision,
  errorInitWriteFailed,
} from '../commands/init/errors';
import {
  mergeGitattributes,
  requiredGitattributesLines,
} from '../commands/init/hygiene-gitattributes';
import { mergeGitignore } from '../commands/init/hygiene-gitignore';
import {
  ensureEsmModuleType,
  mergePackageScripts,
  REQUIRED_SCRIPTS,
} from '../commands/init/hygiene-package-scripts';
import {
  rewritePrisma7ConfigImport,
  rewritePrismaScripts,
} from '../commands/init/prisma7-side-by-side';
import { findStaleArtifacts, removeDependency } from '../commands/init/reinit-cleanup';
import { legacySkillDirs } from '../commands/init/skill-sources';
import {
  configFile,
  dbFile,
  prisma7ConfigFile,
  scaffoldSpecifierResolverFor,
  starterSchema,
} from '../commands/init/templates/code-templates';
import { envExampleContent, envFileContent } from '../commands/init/templates/env';
import {
  prisma7QuickReferenceMd,
  quickReferenceMd,
} from '../commands/init/templates/quick-reference';
import { minimalProjectReadmeMd } from '../commands/init/templates/readme';
import {
  defaultTsConfig,
  mergeTsConfig,
  TsConfigParseError,
} from '../commands/init/templates/tsconfig';
import type { ResolvedInitInputs } from './init-inputs';

interface FileEntry {
  readonly path: string;
  readonly content: string;
  /** Said after the file is written, where a merge is worth reporting. */
  readonly note?: string;
}

interface RenameEntry {
  readonly from: string;
  readonly to: string;
  /** The file's content after the rename, with its imports rewritten. */
  readonly content: string;
}

export const CONFIG_FILE = 'prisma.config.ts';
const QUICK_REFERENCE_FILE = 'prisma-8.md';
const ENV_EXAMPLE_FILE = '.env.example';

/**
 * The generated files a run replaces outright, in the order it writes them.
 * Everything else the scaffold touches it merges (`tsconfig.json`,
 * `package.json`, the git files) or keeps (`.env`, `README.md`), so replacing
 * one of these is the destructive act consent is asked for.
 *
 * `.env.example` is written the same way but deliberately left out: it is a
 * conventional filename in projects that have never seen Prisma ORM, and a
 * consent token demanded for it would fire on first runs. The scaffold warns
 * when it replaces one instead.
 */
export function generatedFilesInitReplaces(schemaPath: string): readonly string[] {
  return [schemaPath, CONFIG_FILE, join(dirname(schemaPath), 'db.ts'), QUICK_REFERENCE_FILE];
}

/**
 * The same list for the Prisma 7 path, where the schema is the user's and
 * init's files live under Prisma 8's own directory.
 */
export function generatedFilesPrisma7PathReplaces(): readonly string[] {
  return [CONFIG_FILE, join(DEFAULT_CONTRACT_SOURCE_DIR, 'db.ts'), QUICK_REFERENCE_FILE];
}

const MANAGERS: ReadonlySet<string> = new Set<PackageManager>([
  'pnpm',
  'npm',
  'yarn',
  'bun',
  'deno',
]);

function isPackageManager(name: string): name is PackageManager {
  return MANAGERS.has(name);
}

/**
 * The manager the scaffolded quick reference and README name in their example
 * commands. It resolves the way the engine's package operations resolve theirs
 * — the project at `cwd` first, then the manager that invoked this process —
 * so the documentation `init` writes names the manager `init` drove. The
 * capability itself reports no manager back on success, which is why this is
 * worked out a second time here.
 */
export async function resolveScaffoldPackageManager(ctx: {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<PackageManager> {
  const detected = await detect({ cwd: ctx.cwd });
  if (detected !== null && isPackageManager(detected.name)) {
    return detected.name;
  }
  const invoking = ctx.env['npm_config_user_agent']?.split('/')[0];
  return invoking !== undefined && isPackageManager(invoking) ? invoking : 'npm';
}

/** What the scaffold phase produced, and what the rest of the run reads. */
export interface ScaffoldOutcome {
  readonly filesWritten: string[];
  readonly filesDeleted: string[];
  /** The Prisma 7 config moved out of Prisma 8's way, when the side-by-side plan asked for it. */
  readonly filesRenamed: { readonly from: string; readonly to: string }[];
  /** `package.json` scripts now invoking `prisma7` instead of `prisma`. */
  readonly scriptsRewritten: readonly string[];
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
  /** The project already pins `@types/node` itself, so the install leaves it alone. */
  readonly hasTypesNode: boolean;
  /** Resolves the package names the scaffolded files import — and install. */
  readonly resolveImportSpecifier: ImportSpecifierResolver;
}

/**
 * True when the parsed manifest declares `name` directly in `dependencies` or
 * `devDependencies`. Transitive presence is deliberately ignored: detecting it
 * needs the lockfile, and the realistic risk is a direct pin being clobbered.
 */
function hasDirectDep(parsed: Record<string, unknown>, name: string): boolean {
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const value = parsed[field];
    if (value !== null && typeof value === 'object' && name in value) {
      return true;
    }
  }
  return false;
}

/**
 * npm package names are lowercase and URL-safe; `basename(cwd)` happily
 * returns "My Project" or ".hidden", both of which npm refuses to read.
 */
function sanitisePackageName(raw: string): string {
  const lowered = raw.toLowerCase().replace(/[^a-z0-9._~-]/g, '-');
  const trimmed = lowered.replace(/^[._-]+/, '').replace(/-+/g, '-');
  return trimmed.length > 0 ? trimmed : 'my-app';
}

/**
 * The manifest `init` writes for a directory that has none. Private, so a
 * stray publish cannot leak the placeholder, and ESM so the scaffolded import
 * attributes load under Node's loader.
 */
export function defaultPackageJsonContent(rawName: string): string {
  return `${JSON.stringify(
    { name: sanitisePackageName(rawName), version: '0.0.0', private: true, type: 'module' },
    null,
    2,
  )}\n`;
}

function hasProjectManifest(cwd: string): boolean {
  return (
    existsSync(join(cwd, 'package.json')) ||
    existsSync(join(cwd, 'deno.json')) ||
    existsSync(join(cwd, 'deno.jsonc'))
  );
}

interface ScaffoldPlan {
  readonly renames: readonly RenameEntry[];
  readonly scriptsRewritten: readonly string[];
  readonly files: readonly FileEntry[];
  readonly filesToDelete: readonly string[];
  readonly dirsToDelete: readonly string[];
  readonly warnings: readonly string[];
  readonly hasTypesNode: boolean;
}

/**
 * Computes every write before touching disk: reads and parses each file the
 * scaffold merges with, so a malformed manifest or tsconfig fails with the
 * user's project byte-identical to how it started.
 */
function planScaffold(ctx: {
  readonly cwd: string;
  readonly inputs: ResolvedInitInputs;
  readonly packageManager: PackageManager;
  readonly resolveImportSpecifier: ImportSpecifierResolver;
}): ScaffoldPlan {
  const { cwd, inputs, packageManager, resolveImportSpecifier } = ctx;
  const warnings: string[] = [];
  const source = inputs.contractSource;
  // Prisma 8's files never go under the Prisma 7 schema's directory: that
  // directory is Prisma 7's, and nothing in it is written or deleted.
  const outputDir =
    source.kind === 'prisma7-schema' ? DEFAULT_CONTRACT_SOURCE_DIR : dirname(inputs.schemaPath);
  const configContractPath = isAbsolute(inputs.schemaPath)
    ? inputs.schemaPath
    : `./${inputs.schemaPath}`;
  const runPrefix = formatRunCommand(packageManager, 'prisma', '').trimEnd();

  const renames = planConfigRename(cwd, inputs, warnings);

  const files: FileEntry[] =
    source.kind === 'starter'
      ? [
          {
            path: inputs.schemaPath,
            content: starterSchema(inputs.target, source.authoring, resolveImportSpecifier),
          },
          {
            path: CONFIG_FILE,
            content: configFile(inputs.target, configContractPath, resolveImportSpecifier),
          },
          {
            path: join(outputDir, 'db.ts'),
            content: dbFile(inputs.target, resolveImportSpecifier),
          },
          {
            path: QUICK_REFERENCE_FILE,
            content: quickReferenceMd(
              inputs.target,
              source.authoring,
              inputs.schemaPath,
              runPrefix,
              resolveImportSpecifier,
            ),
          },
        ]
      : [
          {
            path: CONFIG_FILE,
            content: prisma7ConfigFile(
              inputs.target,
              source.schemaPath,
              outputDir,
              resolveImportSpecifier,
            ),
          },
          {
            path: join(outputDir, 'db.ts'),
            content: dbFile(inputs.target, resolveImportSpecifier),
          },
          {
            path: QUICK_REFERENCE_FILE,
            content: prisma7QuickReferenceMd(
              inputs.target,
              source.schemaPath,
              outputDir,
              runPrefix,
              source.prisma7Config,
              resolveImportSpecifier,
            ),
          },
        ];
  files.push({ path: ENV_EXAMPLE_FILE, content: envExampleContent(inputs.target) });

  if (existsSync(join(cwd, ENV_EXAMPLE_FILE))) {
    warnings.push(
      `${ENV_EXAMPLE_FILE} already existed and was replaced with the Prisma ORM template.`,
    );
  }

  const filesToDelete = inputs.reinit ? [...findStaleArtifacts(cwd, outputDir)] : [];
  const dirsToDelete = legacySkillDirs().filter((rel) => existsSync(join(cwd, rel)));

  if (inputs.writeEnv) {
    if (existsSync(join(cwd, '.env'))) {
      warnings.push(
        '.env already exists; leaving it untouched. Compare with .env.example for any new keys.',
      );
    } else {
      files.push({ path: '.env', content: envFileContent(inputs.target) });
    }
  }

  const tsconfigPath = join(cwd, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    const existing = readFileSync(tsconfigPath, 'utf-8');
    let merged: string;
    try {
      merged = mergeTsConfig(existing);
    } catch (error) {
      if (error instanceof TsConfigParseError) {
        throw errorInitInvalidTsconfig({ path: 'tsconfig.json', cause: error.message });
      }
      throw error;
    }
    files.push({
      path: 'tsconfig.json',
      content: merged,
      note: 'Updated tsconfig.json with required compiler options.',
    });
  } else {
    files.push({ path: 'tsconfig.json', content: defaultTsConfig() });
  }

  const gitignorePath = join(cwd, '.gitignore');
  const nextGitignore = mergeGitignore(
    existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : undefined,
  );
  if (nextGitignore !== null) {
    files.push({ path: '.gitignore', content: nextGitignore });
  }

  const gitattributesPath = join(cwd, '.gitattributes');
  const nextGitattributes = mergeGitattributes(
    existsSync(gitattributesPath) ? readFileSync(gitattributesPath, 'utf-8') : undefined,
    requiredGitattributesLines(outputDir, inputs.target),
  );
  if (nextGitattributes !== null) {
    files.push({ path: '.gitattributes', content: nextGitattributes });
  }

  const manifestPath = join(cwd, 'package.json');
  const manifestExisted = existsSync(manifestPath);
  const synthesiseManifest = !manifestExisted && !hasProjectManifest(cwd);
  let parsedManifest: Record<string, unknown> | null = null;
  let scriptsRewritten: readonly string[] = [];
  if (manifestExisted || synthesiseManifest) {
    const raw = manifestExisted
      ? readFileSync(manifestPath, 'utf-8')
      : defaultPackageJsonContent(basename(cwd));
    try {
      parsedManifest = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw errorInitInvalidManifest({ path: 'package.json', cause: error.message });
      }
      throw error;
    }

    let working = raw;
    let changed = synthesiseManifest;
    if (inputs.removePreviousFacade !== null) {
      const next = removeDependency(working, inputs.removePreviousFacade);
      if (next !== null) {
        working = next;
        changed = true;
      }
    }
    if (inputs.sideBySide !== null) {
      const next = rewritePrismaScripts(
        working,
        REQUIRED_SCRIPTS.map((script) => script.name),
      );
      if (next !== null) {
        working = next.content;
        scriptsRewritten = next.names;
        changed = true;
      }
    }
    const { content: withScripts, warnings: scriptWarnings } = mergePackageScripts(working);
    if (withScripts !== null) {
      working = withScripts;
      changed = true;
    }
    const { content: withType, warning: typeWarning } = ensureEsmModuleType(working);
    if (withType !== null) {
      working = withType;
      changed = true;
    }
    if (changed) {
      files.push({ path: 'package.json', content: working });
    }
    warnings.push(...scriptWarnings);
    if (typeWarning !== null) {
      warnings.push(typeWarning);
    }
    if (synthesiseManifest) {
      warnings.push(
        'No package.json found in the target directory; created a minimal one. Edit `name` / `version` to taste.',
      );
    }
  }

  // The README describes a fresh scaffold; a Prisma 7 project has its own.
  if (source.kind === 'starter' && existsSync(join(cwd, 'src/index.ts'))) {
    if (existsSync(join(cwd, 'README.md'))) {
      warnings.push('README.md already exists; leaving it untouched.');
    } else {
      const declaredName =
        parsedManifest !== null && typeof parsedManifest['name'] === 'string'
          ? parsedManifest['name']
          : basename(cwd);
      files.push({
        path: 'README.md',
        content: minimalProjectReadmeMd(
          inputs.target,
          inputs.schemaPath,
          sanitisePackageName(declaredName),
          packageManager,
        ),
      });
    }
  }

  return {
    renames,
    scriptsRewritten,
    files,
    filesToDelete,
    dirsToDelete,
    warnings,
    hasTypesNode: parsedManifest !== null && hasDirectDep(parsedManifest, '@types/node'),
  };
}

/**
 * The Prisma 7 config moves to `prisma7.config.<same extension>` with its
 * `prisma/config` import pointed at the Prisma 7 package. Planned like every
 * other write: a target that already exists fails here, before anything
 * lands on disk.
 */
function planConfigRename(
  cwd: string,
  inputs: ResolvedInitInputs,
  warnings: string[],
): RenameEntry[] {
  const rename = inputs.sideBySide?.renameConfig ?? null;
  if (rename === null) {
    return [];
  }
  const to = `prisma7.config.${rename.extension}`;
  if (existsSync(join(cwd, to))) {
    throw errorInitPrisma7ConfigCollision({ prismaConfigPath: rename.from, prisma7ConfigPath: to });
  }
  const rewritten = rewritePrisma7ConfigImport(readFileSync(join(cwd, rename.from), 'utf-8'));
  if (!rewritten.found) {
    warnings.push(
      `${rename.from} does not import 'prisma/config', so it was renamed to ${to} with its imports unchanged. If it imports the Prisma 7 config helper another way, point that import at '@prisma/prisma7/config'.`,
    );
  }
  return [{ from: rename.from, to, content: rewritten.content }];
}

/**
 * Plans every write, then performs them. Everything that can fail on the
 * user's existing files fails during planning, so a failure leaves the project
 * as it was; after the first write, the scaffold is on disk to keep, and a
 * write that fails partway names the files that already landed.
 */
export function scaffoldProject(ctx: {
  readonly cwd: string;
  readonly inputs: ResolvedInitInputs;
  readonly packageManager: PackageManager;
}): ScaffoldOutcome {
  const resolveImportSpecifier = scaffoldSpecifierResolverFor(ctx.inputs.target);
  const plan = planScaffold({ ...ctx, resolveImportSpecifier });

  const filesWritten: string[] = [];
  const filesDeleted: string[] = [];
  const filesRenamed: { readonly from: string; readonly to: string }[] = [];
  const notes: string[] = [];

  // The rename comes first so the config written below lands on a free name.
  for (const rename of plan.renames) {
    try {
      writeFileSync(join(ctx.cwd, rename.to), rename.content, 'utf-8');
      unlinkSync(join(ctx.cwd, rename.from));
    } catch (error) {
      throw errorInitWriteFailed({
        path: rename.to,
        cause: error instanceof Error ? error.message : String(error),
        filesWritten,
        filesRenamed,
      });
    }
    filesRenamed.push({ from: rename.from, to: rename.to });
  }

  for (const file of plan.files) {
    const target = join(ctx.cwd, file.path);
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, 'utf-8');
    } catch (error) {
      throw errorInitWriteFailed({
        path: file.path,
        cause: error instanceof Error ? error.message : String(error),
        filesWritten,
        filesRenamed,
      });
    }
    filesWritten.push(file.path);
    if (file.note !== undefined) {
      notes.push(file.note);
    }
  }

  // Deleting after the writes cannot remove a file this run produced: no
  // scaffolded name is a stale contract artifact. A file that vanished
  // between the plan and now is the end state we wanted anyway.
  for (const rel of plan.filesToDelete) {
    const target = join(ctx.cwd, rel);
    if (!existsSync(target)) {
      continue;
    }
    try {
      unlinkSync(target);
      filesDeleted.push(rel);
    } catch (error) {
      if (!(error instanceof Error && Reflect.get(error, 'code') === 'ENOENT')) {
        throw error;
      }
    }
  }

  for (const rel of plan.dirsToDelete) {
    rmSync(join(ctx.cwd, rel), { recursive: true, force: true });
    filesDeleted.push(rel);
  }

  return {
    filesWritten,
    filesDeleted,
    filesRenamed,
    scriptsRewritten: plan.scriptsRewritten,
    warnings: plan.warnings,
    notes,
    hasTypesNode: plan.hasTypesNode,
    resolveImportSpecifier,
  };
}
