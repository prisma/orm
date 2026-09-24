import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { evaluateConfigModule } from '@internal/config-loader';
import { join, resolve } from 'pathe';

/**
 * What `init` learned about the config file an earlier Prisma CLI reads.
 *
 * - `prisma8`: `prisma.config.*` carries the `$prismaConfig` marker, so it is
 *   init's own file and no Prisma 7 config occupies that name.
 * - `prisma7`: the file evaluated to an object without the marker; only its
 *   `schema` field is read.
 * - `unreadable`: the file exists but did not evaluate; detection continues
 *   with the `schema` of a Prisma 7 `prisma7.config.*` beside it, else the
 *   default schema path.
 * - `collision`: a Prisma 7 `prisma.config.*` sits beside a `prisma7.config.*`,
 *   so init could not rename the former onto the latter.
 */
export type Prisma7ConfigDetection =
  | { readonly kind: 'none' }
  | { readonly kind: 'prisma8'; readonly path: string }
  | { readonly kind: 'prisma7'; readonly path: string; readonly schema: string | undefined }
  | {
      readonly kind: 'unreadable';
      readonly path: string;
      readonly why: string;
      /** A `prisma7.config.*` beside it, which makes the unreadable file Prisma 8's. */
      readonly prisma7ConfigPath: string | undefined;
      /** The `schema` field of `prisma7ConfigPath`, when that file evaluates as a Prisma 7 config. */
      readonly schema: string | undefined;
    }
  | {
      readonly kind: 'collision';
      readonly prismaConfigPath: string;
      readonly prisma7ConfigPath: string;
    };

/**
 * The schema at the resolved path. `datasource` means the text carries a
 * `datasource` block, which is what makes it a Prisma 7 schema; `provider` is
 * the block's string literal, or `undefined` when the block spells it any
 * other way.
 */
export type Prisma7SchemaDetection =
  | { readonly kind: 'absent'; readonly path: string }
  | { readonly kind: 'no-datasource'; readonly path: string }
  | { readonly kind: 'datasource'; readonly path: string; readonly provider: string | undefined };

/**
 * The `prisma` package the project declares. `earlier` is a major below 8,
 * read from `node_modules` when installed and from the declared range
 * otherwise. `side-by-side` means `@prisma/prisma7` is already declared, so
 * the guide's first section is done.
 */
export type Prisma7CliDetection =
  | { readonly kind: 'none' }
  | { readonly kind: 'side-by-side' }
  | {
      readonly kind: 'earlier';
      readonly version: string;
      readonly major: number;
      readonly source: 'installed' | 'declared';
      readonly clientVersion: string | undefined;
    };

export interface Prisma7Detection {
  readonly config: Prisma7ConfigDetection;
  readonly schema: Prisma7SchemaDetection;
  readonly schemaPathSource: 'flag' | 'config' | 'default';
  readonly cli: Prisma7CliDetection;
  readonly warnings: readonly string[];
}

export const PRISMA7_DEFAULT_SCHEMA_PATH = 'prisma/schema.prisma';

const CONFIG_EXTENSIONS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'] as const;

const PRISMA7_CLI_PACKAGE = '@prisma/prisma7';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findConfigFile(cwd: string, stem: string): string | undefined {
  return CONFIG_EXTENSIONS.map((extension) => `${stem}.${extension}`).find((name) =>
    existsSync(join(cwd, name)),
  );
}

type EvaluatedConfig =
  | { readonly kind: 'prisma8' }
  | { readonly kind: 'prisma7'; readonly schema: string | undefined }
  | { readonly kind: 'unreadable'; readonly why: string };

async function evaluateConfig(cwd: string, path: string): Promise<EvaluatedConfig> {
  const evaluated = await evaluateConfigModule(path, { cwd });
  if (!evaluated.ok) {
    return { kind: 'unreadable', why: evaluated.failure.why ?? evaluated.failure.message };
  }
  const exported = evaluated.value;
  if (!isRecord(exported) || Object.hasOwn(exported, '__esModule')) {
    return { kind: 'unreadable', why: `${path} has no object default export` };
  }
  if (exported['$prismaConfig'] !== undefined) {
    return { kind: 'prisma8' };
  }
  const schema = exported['schema'];
  return { kind: 'prisma7', schema: typeof schema === 'string' ? schema : undefined };
}

async function schemaDeclaredBy(
  cwd: string,
  path: string | undefined,
): Promise<string | undefined> {
  if (path === undefined) {
    return undefined;
  }
  const evaluated = await evaluateConfig(cwd, path);
  return evaluated.kind === 'prisma7' ? evaluated.schema : undefined;
}

async function detectConfig(cwd: string): Promise<Prisma7ConfigDetection> {
  const prismaConfigPath = findConfigFile(cwd, 'prisma.config');
  const prisma7ConfigPath = findConfigFile(cwd, 'prisma7.config');

  if (prismaConfigPath !== undefined) {
    const evaluated = await evaluateConfig(cwd, prismaConfigPath);
    if (evaluated.kind === 'prisma7' && prisma7ConfigPath !== undefined) {
      return { kind: 'collision', prismaConfigPath, prisma7ConfigPath };
    }
    if (evaluated.kind === 'unreadable') {
      return {
        ...evaluated,
        path: prismaConfigPath,
        prisma7ConfigPath,
        schema: await schemaDeclaredBy(cwd, prisma7ConfigPath),
      };
    }
    if (evaluated.kind === 'prisma7') {
      return { ...evaluated, path: prismaConfigPath };
    }
    if (prisma7ConfigPath === undefined) {
      return { kind: 'prisma8', path: prismaConfigPath };
    }
  }

  if (prisma7ConfigPath === undefined) {
    return { kind: 'none' };
  }
  const evaluated = await evaluateConfig(cwd, prisma7ConfigPath);
  if (evaluated.kind === 'prisma8') {
    return { kind: 'none' };
  }
  if (evaluated.kind === 'unreadable') {
    return {
      ...evaluated,
      path: prisma7ConfigPath,
      prisma7ConfigPath: undefined,
      schema: undefined,
    };
  }
  return { ...evaluated, path: prisma7ConfigPath };
}

function stripLineComments(text: string): string {
  return text.replace(/\/\/[^\n]*/g, '');
}

function findProvider(text: string): { readonly provider: string | undefined } | undefined {
  const block = /datasource\s+\w+\s*\{([^}]*)\}/.exec(stripLineComments(text));
  if (block === null) {
    return undefined;
  }
  const provider = /\bprovider\s*=\s*"([^"]*)"/.exec(block[1] ?? '');
  return { provider: provider?.[1] };
}

function prismaFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.prisma'))
    .map((entry) => join(entry.parentPath, entry.name));
}

function detectSchema(cwd: string, path: string): Prisma7SchemaDetection {
  const absolute = resolve(cwd, path);
  if (!existsSync(absolute)) {
    return { kind: 'absent', path };
  }
  const files = statSync(absolute).isDirectory() ? prismaFilesUnder(absolute) : [absolute];
  for (const file of files) {
    const found = findProvider(readFileSync(file, 'utf-8'));
    if (found !== undefined) {
      return { kind: 'datasource', path, provider: found.provider };
    }
  }
  return { kind: 'no-datasource', path };
}

function readJsonRecord(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function declaredRange(manifest: Record<string, unknown>, name: string): string | undefined {
  for (const field of ['devDependencies', 'dependencies']) {
    const section = manifest[field];
    const range = isRecord(section) ? section[name] : undefined;
    if (typeof range === 'string') {
      return range;
    }
  }
  return undefined;
}

function installedVersion(cwd: string, name: string): string | undefined {
  const version = readJsonRecord(join(cwd, 'node_modules', name, 'package.json'))?.['version'];
  return typeof version === 'string' ? version : undefined;
}

/** The major of a version or range (`^7.3.0`, `7.4.1`, `>=6`); `undefined` when it cannot be read. */
export function versionMajor(range: string): number | undefined {
  const match = /^\s*[\^~>=<v]*\s*(\d+)(?:\.|$|\s|-)/.exec(range);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function detectCli(cwd: string): Prisma7CliDetection {
  const manifest = readJsonRecord(join(cwd, 'package.json'));
  if (manifest === undefined) {
    return { kind: 'none' };
  }
  if (declaredRange(manifest, PRISMA7_CLI_PACKAGE) !== undefined) {
    return { kind: 'side-by-side' };
  }
  const declared = declaredRange(manifest, 'prisma');
  if (declared === undefined) {
    return { kind: 'none' };
  }
  const installed = installedVersion(cwd, 'prisma');
  const version = installed ?? declared;
  const major = versionMajor(version);
  if (major === undefined || major >= 8) {
    return { kind: 'none' };
  }
  const clientVersion =
    installedVersion(cwd, '@prisma/client') ?? declaredRange(manifest, '@prisma/client');
  return {
    kind: 'earlier',
    version,
    major,
    source: installed === undefined ? 'declared' : 'installed',
    clientVersion,
  };
}

function warningsFor(config: Prisma7ConfigDetection): string[] {
  switch (config.kind) {
    case 'unreadable':
      return [
        config.schema === undefined
          ? `${config.path} could not be evaluated, so the default schema path is assumed: ${config.why}`
          : `${config.path} could not be evaluated, so the schema path is read from ${config.prisma7ConfigPath}: ${config.why}`,
      ];
    case 'collision':
      return [
        `${config.prismaConfigPath} is a Prisma 7 config, but ${config.prisma7ConfigPath} already exists; init cannot rename one onto the other.`,
      ];
    default:
      return [];
  }
}

/**
 * Reads what `orm init` would otherwise ask for on a Prisma 7 project: the
 * schema path (the flag, else the Prisma 7 config's `schema`, else the Prisma 7
 * default), the provider of its `datasource` block, the config file an earlier
 * CLI reads, and the earlier `prisma` package the project declares. Reads text
 * and evaluates the user's config only; nothing is written and no Prisma 7
 * package is imported.
 */
export async function detectPrisma7Project(ctx: {
  readonly cwd: string;
  readonly schemaPath: string | undefined;
}): Promise<Prisma7Detection> {
  const config = await detectConfig(ctx.cwd);
  const configSchema =
    config.kind === 'prisma7' || config.kind === 'unreadable' ? config.schema : undefined;
  const [path, schemaPathSource]: [string, Prisma7Detection['schemaPathSource']] =
    ctx.schemaPath !== undefined
      ? [ctx.schemaPath, 'flag']
      : configSchema !== undefined
        ? [configSchema, 'config']
        : [PRISMA7_DEFAULT_SCHEMA_PATH, 'default'];
  return {
    config,
    schema: detectSchema(ctx.cwd, path),
    schemaPathSource,
    cli: detectCli(ctx.cwd),
    warnings: warningsFor(config),
  };
}
