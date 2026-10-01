import { realpathSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { getEmittedArtifactPaths } from '@internal/emitter';
import {
  CliStructuredError,
  errorConfigEvaluationFailed,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorConfigVersionMarkerMissing,
} from '@internal/errors/control';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { isStructuredError } from '@internal/utils/structured-error';
import type { SectionProvenance } from '@prisma/cli-engine';
import { dirname, join, resolve } from 'pathe';
import {
  type ConfigSection,
  descriptorRelationshipProblems,
  isConfigSection,
  validateOrmSection,
  validateOrmSectionExcept,
} from './orm-section';

const CONFIG_FILENAME = 'prisma.config.ts';

export type { ConfigSection };

/**
 * A successfully evaluated config plus the structural diagnostics found in it.
 * Diagnostics are tagged with the config section they concern
 * (`meta.section`); sections without diagnostics are safe to read. Callers
 * must guard access through {@link requireConfigSections} — a section with a
 * diagnostic may be missing or malformed despite the `PrismaNextConfig` type.
 */
export interface LoadedConfig {
  readonly config: PrismaNextConfig;
  readonly diagnostics: readonly CliStructuredError[];
}

export async function findNearestConfigPathForFile(filePath: string): Promise<string | undefined> {
  let current = dirname(resolve(process.cwd(), filePath));

  while (true) {
    const candidate = join(current, CONFIG_FILENAME);
    if (await fileExists(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectArtifactCollisionDiagnostics(
  contract: NonNullable<PrismaNextConfig['contract']>,
): CliStructuredError[] {
  const inputs = contract.source.inputs;
  const output = contract.output;
  if (inputs === undefined || output === undefined) {
    return [];
  }

  let emittedArtifactPaths: ReturnType<typeof getEmittedArtifactPaths>;
  try {
    emittedArtifactPaths = getEmittedArtifactPaths(output);
  } catch (error) {
    return [
      errorConfigValidation('contract.output', {
        /* v8 ignore next -- getEmittedArtifactPaths only ever throws an Error */
        why: error instanceof Error ? error.message : String(error),
        section: 'contract',
      }),
    ];
  }

  const emittedPaths = new Set([emittedArtifactPaths.jsonPath, emittedArtifactPaths.dtsPath]);
  if (inputs.some((input) => emittedPaths.has(input))) {
    return [
      errorConfigValidation('contract.source.inputs[]', {
        why: 'Config.contract.source.inputs must not include emitted artifact paths derived from contract.output',
        section: 'contract',
      }),
    ];
  }
  return [];
}

function validateLoadedSection(
  rawConfig: Record<string, unknown>,
  provenance: SectionProvenance,
): LoadedConfig {
  const validation = validateOrmSection(rawConfig, provenance);
  if (!validation.ok) {
    const diagnostics = validation.diagnostics.map((diagnostic) => {
      const field = typeof diagnostic.meta?.['field'] === 'string' ? diagnostic.meta['field'] : '';
      const section = field.split('.')[0] ?? '';
      return errorConfigValidation(field, {
        why: diagnostic.summary,
        ...(isConfigSection(section) ? { section } : {}),
      });
    });
    // Subsections that failed stay exactly as authored; the rest are validated
    // on their own, so a command that reads only them sees resolved paths,
    // and are held to the same relationship and artifact rules.
    const failing = new Set(
      diagnostics.map((diagnostic) => String(diagnostic.meta?.['section'] ?? '')),
    );
    const partial = validateOrmSectionExcept(rawConfig, provenance, failing);
    const config = blindCast<
      PrismaNextConfig,
      'a config with diagnostics is guarded by requireConfigSections before any subsection is read'
    >(partial.ok ? partial.value : rawConfig);
    if (!partial.ok) {
      return { config, diagnostics };
    }
    const related = descriptorRelationshipProblems(config, (section) => !failing.has(section)).map(
      (problem) =>
        errorConfigValidation(problem.path.join('.'), {
          why: `${problem.path.join('.')} must be ${problem.expected} (was ${problem.actual})`,
          section: String(problem.path[0]),
        }),
    );
    const collisions =
      failing.has('contract') || config.contract === undefined
        ? []
        : collectArtifactCollisionDiagnostics(config.contract);
    return { config, diagnostics: [...diagnostics, ...related, ...collisions] };
  }
  const config = validation.value;
  if (config.contract === undefined) {
    return { config, diagnostics: [] };
  }
  return { config, diagnostics: collectArtifactCollisionDiagnostics(config.contract) };
}

/**
 * Validates a raw `orm` section and resolves its paths against `configDir`, the way a loaded config
 * file is. A caller that builds the section in memory gets the same diagnostics as one that wrote
 * it to `prisma.config.ts`.
 */
export function buildLoadedConfig(
  rawConfig: Record<string, unknown>,
  configDir: string,
): LoadedConfig {
  const file = join(configDir, CONFIG_FILENAME);
  return validateLoadedSection(rawConfig, {
    files: [file],
    keys: Object.fromEntries(Object.keys(rawConfig).map((key) => [key, file])),
  });
}

function toConfigLoadFailure(error: unknown, configPath?: string): CliStructuredError {
  if (CliStructuredError.is(error)) {
    return error;
  }

  const resolvedPath = configPath ? resolve(process.cwd(), configPath) : undefined;

  if (isStructuredError(error)) {
    return new CliStructuredError(error.code, error.message, {
      ...ifDefined('why', error.why),
      ...ifDefined('fix', error.fix),
      ...ifDefined('where', error.where),
      ...ifDefined('meta', error.meta),
      cause: error,
    });
  }

  // A config file that does not exist never reaches here: c12 resolves no
  // config file and returns an empty config, which `loadConfig` maps to
  // CONFIG.FILE_NOT_FOUND. Everything thrown out of c12 came from evaluating
  // a file that does exist — including `Cannot find module` for a package the
  // config imports, and ENOENT for a file the config itself reads.
  if (error instanceof Error) {
    return errorConfigEvaluationFailed(resolvedPath, { why: error.message, cause: error });
  }
  return errorConfigEvaluationFailed(resolvedPath, { why: String(error) });
}

/**
 * c12 is resolved to its real on-disk entry before importing: jiti (inside
 * c12) resolves its own transitive imports from the importing file's location,
 * and a symlinked install (pnpm) would otherwise anchor them somewhere the
 * packages are not. Importing at the real location keeps every transitive
 * resolution working.
 */
async function importC12(): Promise<typeof import('c12')> {
  const entry = realpathSync(createRequire(import.meta.url).resolve('c12'));
  return await import(pathToFileURL(entry).href);
}

type C12Result = Awaited<ReturnType<typeof import('c12').loadConfig<Record<string, unknown>>>>;

/**
 * Runs c12 against one config path. Every throw out of evaluation becomes a
 * `CONFIG.EVALUATION_FAILED` and a requested path c12 did not resolve to becomes
 * `CONFIG.FILE_NOT_FOUND`, so both loaders report the same failures for the
 * same file.
 */
async function evaluateWithC12(
  configPath: string | undefined,
  cwd: string,
): Promise<Result<C12Result, CliStructuredError>> {
  const resolvedConfigPath = configPath ? resolve(cwd, configPath) : undefined;
  const configCwd = resolvedConfigPath ? dirname(resolvedConfigPath) : cwd;

  let result: C12Result;
  try {
    const c12 = await importC12();
    result = await c12.loadConfig<Record<string, unknown>>({
      name: 'prisma',
      ...ifDefined('configFile', resolvedConfigPath),
      cwd: configCwd,
    });
  } catch (error) {
    return notOk(toConfigLoadFailure(error, configPath));
  }

  if (resolvedConfigPath && result.configFile !== resolvedConfigPath) {
    return notOk(errorConfigFileNotFound(resolvedConfigPath));
  }
  return ok(result);
}

/** One evaluated config file: its path and its top-level sections. */
export interface ConfigFile {
  readonly path: string;
  /** The file's top-level keys minus the ones the file format keeps for itself. */
  readonly sections: Readonly<Record<string, unknown>>;
}

/** The evaluated config chain, before any section is validated. */
export interface ConfigFiles {
  /** The requested file first, then the files it extends. */
  readonly files: readonly ConfigFile[];
  /** c12's merge of every file, nearest file winning. */
  readonly merged: Readonly<Record<string, unknown>>;
}

const FILE_FORMAT_KEYS = new Set(['$prismaConfig', 'extends']);

function sectionsOf(exported: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(exported).filter(([key]) => !FILE_FORMAT_KEYS.has(key)));
}

/**
 * Evaluates `prisma.config.ts` and hands back each file on the chain with its
 * sections as written, plus c12's merge. Failures that prevent evaluation are
 * the Result failure. Nothing is validated or resolved here: the CLI engine
 * validates each section against its schema with the files' provenance, and
 * {@link loadConfig} does the same for the `orm` section outside a command run.
 */
export async function loadConfigFiles(
  configPath?: string,
  options?: { readonly cwd?: string },
): Promise<Result<ConfigFiles, CliStructuredError>> {
  const cwd = options?.cwd ?? process.cwd();
  const resolvedConfigPath = configPath ? resolve(cwd, configPath) : undefined;
  const configCwd = resolvedConfigPath ? dirname(resolvedConfigPath) : cwd;

  const evaluated = await evaluateWithC12(configPath, cwd);
  if (!evaluated.ok) {
    return evaluated;
  }
  const result = evaluated.value;

  if (!result.config || Object.keys(result.config).length === 0) {
    /* v8 ignore next -- @preserve */
    const displayPath = result.configFile || resolvedConfigPath || configPath;
    return notOk(errorConfigFileNotFound(displayPath));
  }

  // The marker is read from the raw module export in c12's first layer — the
  // requested config file. (`extends` bases and rc files follow it, and their
  // markers must not vouch for a file that does not carry one itself.)
  /* v8 ignore next -- c12 always returns layers for a config it evaluated */
  const layers = result.layers ?? [];
  const layerConfig = layers[0]?.config;

  // The engine's shape: definePrismaConfig from @prisma/cli-engine stamps the
  // enumerable `$prismaConfig` key and nests the whole Prisma 8 config as
  // the `orm` section.
  const engineMarker = isRecord(layerConfig) ? layerConfig['$prismaConfig'] : undefined;
  if (engineMarker === undefined) {
    /* v8 ignore next -- a config that evaluated always carries its resolved path */
    return notOk(errorConfigVersionMarkerMissing(result.configFile ?? resolvedConfigPath));
  }
  if (engineMarker !== 1) {
    /* v8 ignore next -- a config that evaluated always carries its resolved path */
    return notOk(errorConfigVersionMarkerMissing(result.configFile ?? resolvedConfigPath));
  }

  /* v8 ignore next -- @preserve */
  const requested = result.configFile ?? join(configCwd, CONFIG_FILENAME);
  // c12 adds rc and package.json layers with empty configs; only files that
  // wrote something are on the chain.
  const files = layers.flatMap((layer, index) =>
    isRecord(layer.config) && Object.keys(layer.config).length > 0
      ? [
          {
            path: index === 0 ? requested : resolve(configCwd, layer.configFile ?? requested),
            sections: sectionsOf(layer.config),
          },
        ]
      : [],
  );
  return ok({
    files: files.length === 0 ? [{ path: requested, sections: sectionsOf(result.config) }] : files,
    merged: result.config,
  });
}

/**
 * The raw default export of the module at `configPath`, evaluated exactly as
 * {@link loadConfig} evaluates it and returned without validation or the
 * version-marker check. The caller decides what the export means — a
 * default export without the `$prismaConfig` marker is what an earlier Prisma
 * CLI's config looks like.
 */
export async function evaluateConfigModule(
  configPath: string,
  options?: { readonly cwd?: string },
): Promise<Result<unknown, CliStructuredError>> {
  const cwd = options?.cwd ?? process.cwd();
  const resolvedConfigPath = resolve(cwd, configPath);
  if (!(await fileExists(resolvedConfigPath))) {
    return notOk(errorConfigFileNotFound(resolvedConfigPath));
  }
  const evaluated = await evaluateWithC12(resolvedConfigPath, cwd);
  if (!evaluated.ok) {
    return evaluated;
  }
  /* v8 ignore next -- c12 always returns layers for a config it evaluated */
  const [requestedLayer] = evaluated.value.layers ?? [];
  return ok(requestedLayer?.config);
}

/** Which file wrote each top-level key of the `orm` section, nearest file first. */
function ormProvenance(
  files: readonly ConfigFile[],
  merged: Record<string, unknown>,
): SectionProvenance {
  const contributors = files.filter((file) => isRecord(file.sections['orm']));
  const paths = contributors.map((file) => file.path);
  const keys = Object.fromEntries(
    Object.keys(merged).flatMap((key) => {
      const file =
        contributors.find((contributor) => {
          const orm = contributor.sections['orm'];
          return isRecord(orm) && Object.hasOwn(orm, key);
        })?.path ?? paths[0];
      return file === undefined ? [] : [[key, file]];
    }),
  );
  return { files: paths, keys };
}

/**
 * Loads the Prisma 8 config and validates its `orm` section.
 *
 * Failures that prevent evaluation entirely — missing file, module that does
 * not evaluate (`CONFIG.FILE_NOT_FOUND`, `CONFIG.EVALUATION_FAILED`) — are the
 * `Result` failure. Structural problems inside an evaluated config do not
 * fail the load: they are returned as section-tagged diagnostics so commands
 * fail only on the sections they read (via {@link requireConfigSections}).
 */
export async function loadConfig(
  configPath?: string,
  options?: { readonly cwd?: string },
): Promise<Result<LoadedConfig, CliStructuredError>> {
  const loaded = await loadConfigFiles(configPath, options);
  if (!loaded.ok) {
    return loaded;
  }
  const orm = loaded.value.merged['orm'];
  if (orm !== undefined && !isRecord(orm)) {
    const base = validateLoadedSection({}, { files: [], keys: {} });
    return ok({
      config: base.config,
      diagnostics: [
        errorConfigValidation('orm', {
          why: `The orm section of ${CONFIG_FILENAME} must be an object`,
        }),
      ],
    });
  }
  const section = orm ?? {};
  const provenance = ormProvenance(loaded.value.files, section);
  const requested = loaded.value.files[0]?.path;
  return ok(
    validateLoadedSection(
      section,
      provenance.files.length === 0 && requested !== undefined
        ? {
            files: [requested],
            keys: Object.fromEntries(Object.keys(section).map((key) => [key, requested])),
          }
        : provenance,
    ),
  );
}

/**
 * Narrows a {@link LoadedConfig} to the sections a command reads. Fails with
 * the first diagnostic concerning a required section; diagnostics on other
 * sections are ignored so unrelated commands keep working.
 */
export function requireConfigSections(
  loaded: LoadedConfig,
  sections: readonly ConfigSection[],
): Result<PrismaNextConfig, CliStructuredError> {
  const blocking = loaded.diagnostics.find((diagnostic) => {
    const section = diagnostic.meta?.['section'];
    return typeof section !== 'string' || sections.some((required) => required === section);
  });
  return blocking ? notOk(blocking) : ok(loaded.config);
}

/**
 * Convenience composition of {@link loadConfig} and
 * {@link requireConfigSections} for commands that read a fixed set of
 * sections and have no use for diagnostics outside them.
 */
export async function loadConfigForSections(
  configPath: string | undefined,
  sections: readonly ConfigSection[],
): Promise<Result<PrismaNextConfig, CliStructuredError>> {
  const loaded = await loadConfig(configPath);
  if (!loaded.ok) {
    return loaded;
  }
  return requireConfigSections(loaded.value, sections);
}

export async function loadConfigForFile(
  filePath: string,
): Promise<Result<LoadedConfig, CliStructuredError>> {
  const configPath = await findNearestConfigPathForFile(filePath);
  if (configPath === undefined) {
    return notOk(
      errorConfigFileNotFound(join(dirname(resolve(process.cwd(), filePath)), CONFIG_FILENAME)),
    );
  }
  return loadConfig(configPath);
}
