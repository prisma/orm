import { readFile } from 'node:fs/promises';
import type { ControlTargetDescriptor } from '@internal/framework-components/control';
import { hasMigrations } from '@internal/framework-components/control';
import type { NoInvariantPathStructuralEdge } from '@internal/migration-tools/errors';
import type { MigrationEdge, MigrationGraph } from '@internal/migration-tools/graph';
import { APP_SPACE_ID, spaceMigrationDirectory } from '@internal/migration-tools/spaces';
import { relative, resolve } from 'pathe';
import type { ControlClient } from '../control-api/types';
import { CliStructuredError, errorRuntime } from './cli-errors';

/**
 * Resolves the absolute path to contract.json from the config.
 */
export function resolveContractPath(config: { contract?: { output?: string } }): string {
  if (config.contract?.output === undefined) {
    throw errorRuntime(
      'CONFIG.VALIDATION_FAILED',
      'config.contract.output is required to resolve the contract path',
      {
        why: 'CLI commands read the emitted contract from config.contract.output; the config has no value to read.',
        fix: 'Ensure your prisma.config.ts goes through `defineConfig()`, which normalises a default output when the provider supplies an input path, or set `contract.output` explicitly.',
      },
    );
  }
  return resolve(config.contract.output);
}

/**
 * Resolves the migrations directory and config path from CLI options.
 * Shared by migrate, migration-plan, and migration-status.
 *
 * - `migrationsDir` is the project's top-level `migrations/` directory
 *   (the root that the aggregate loader walks for every contract space).
 * - `appMigrationsDir` is the app subspace directory under it
 *   (`<migrationsDir>/<APP_SPACE_ID>/`). Every per-app reader / writer
 *   (`migration new`, `migration plan`, `migrate`,
 *   `migration status`, `migration show`, `migration ref`) operates on
 *   this directory. Extensions own their own `migrations/<spaceId>/`.
 * - `refsDir` is the app's refs directory (`<appMigrationsDir>/refs/`).
 *   The framework does not maintain refs at the migrations root.
 *
 * `cwd` is the directory the command was invoked from; every relative path in
 * the result is computed against it.
 */
export function resolveMigrationPaths(
  configOption: string | undefined,
  config: { migrations?: { dir?: string } },
  cwd: string,
): {
  configPath: string;
  migrationsDir: string;
  migrationsRelative: string;
  appMigrationsDir: string;
  appMigrationsRelative: string;
  refsDir: string;
} {
  const resolvedConfigPath = configOption ? resolve(cwd, configOption) : undefined;
  const configPath = resolvedConfigPath ? relative(cwd, resolvedConfigPath) : 'prisma.config.ts';
  const migrationsDir = resolve(
    resolvedConfigPath ? resolve(resolvedConfigPath, '..') : cwd,
    config.migrations?.dir ?? 'migrations',
  );
  const migrationsRelative = relative(cwd, migrationsDir);
  const appMigrationsDir = spaceMigrationDirectory(migrationsDir, APP_SPACE_ID);
  const appMigrationsRelative = relative(cwd, appMigrationsDir);
  const refsDir = resolve(appMigrationsDir, 'refs');
  return {
    configPath,
    migrationsDir,
    migrationsRelative,
    appMigrationsDir,
    appMigrationsRelative,
    refsDir,
  };
}

export function collectDeclaredInvariants(graph: MigrationGraph): ReadonlySet<string> {
  const declared = new Set<string>();
  for (const edges of graph.forwardChain.values()) {
    for (const edge of edges) {
      for (const inv of edge.invariants) {
        declared.add(inv);
      }
    }
  }
  return declared;
}

/**
 * Maps a `MigrationEdge` to the structural-edge shape used in the
 * `MIGRATION.NO_INVARIANT_PATH` error envelope. Shared between
 * `migrate` and `migration status` so both commands surface
 * the same JSON wire shape when an invariant-aware route is unsatisfiable.
 */
export function toStructuralEdge(edge: MigrationEdge): NoInvariantPathStructuralEdge {
  return {
    dirName: edge.dirName,
    migrationHash: edge.migrationHash,
    from: edge.from,
    to: edge.to,
    invariants: edge.invariants,
  };
}

export function targetSupportsMigrations(target: ControlTargetDescriptor<string, string>): boolean {
  return hasMigrations(target);
}

/**
 * Hangs up without letting the hang-up decide the command's result. A rejection out of a
 * `finally` replaces the value the `try`/`catch` already returned, so an unguarded close turns a
 * mapped connection error into an unmapped one — and that is the case it hits most, because a
 * `connect()` that failed leaves nothing to close.
 */
export async function closeQuietly(client: Pick<ControlClient, 'close'>): Promise<void> {
  try {
    await client.close();
  } catch {
    // The command already decided its result; failing to hang up cannot change it.
  }
}

export function getTargetMigrations(target: ControlTargetDescriptor<string, string>) {
  return hasMigrations(target) ? target.migrations : undefined;
}

/**
 * The framework-level envelope of `contract.json`: the fields every family
 * shares. Other fields exist in the JSON but are opaque at this layer — the
 * index signature preserves them for downstream consumers that operate at
 * the family level (e.g., the control client).
 */
export interface ContractEnvelope {
  readonly storageHash: string;
  readonly schemaVersion: string;
  readonly target: string;
  readonly targetFamily: string;
  readonly profileHash?: string;
  readonly [key: string]: unknown;
}

/**
 * Reads and parses contract.json, validating the framework-level envelope
 * fields (storageHash, schemaVersion, target, targetFamily).
 *
 * Family-specific validation (storage structure, codec mappings, etc.)
 * happens downstream in the control client via the family instance.
 */
export async function readContractEnvelope(config: {
  contract?: { output?: string };
}): Promise<ContractEnvelope> {
  const contractPath = resolveContractPath(config);
  const content = await readFile(contractPath, 'utf-8');
  const json = JSON.parse(content) as Record<string, unknown>;

  const { schemaVersion, target, targetFamily, profileHash } = json;
  const storage = json['storage'] as Record<string, unknown> | undefined;
  const storageHash = storage?.['storageHash'];

  if (typeof storageHash !== 'string') {
    throw new CliStructuredError(
      'CONTRACT.VALIDATION_FAILED',
      `Contract at ${relative(process.cwd(), contractPath)} is missing a valid storage.storageHash. Run \`{bin} contract emit\` to regenerate.`,
      { where: { path: contractPath } },
    );
  }
  if (typeof schemaVersion !== 'string') {
    throw new CliStructuredError(
      'CONTRACT.VALIDATION_FAILED',
      `Contract at ${relative(process.cwd(), contractPath)} is missing schemaVersion.`,
      { where: { path: contractPath } },
    );
  }
  if (typeof target !== 'string') {
    throw new CliStructuredError(
      'CONTRACT.VALIDATION_FAILED',
      `Contract at ${relative(process.cwd(), contractPath)} is missing target.`,
      { where: { path: contractPath } },
    );
  }
  if (typeof targetFamily !== 'string') {
    throw new CliStructuredError(
      'CONTRACT.VALIDATION_FAILED',
      `Contract at ${relative(process.cwd(), contractPath)} is missing targetFamily.`,
      { where: { path: contractPath } },
    );
  }

  return {
    ...json,
    storageHash,
    schemaVersion,
    target,
    targetFamily,
    ...(typeof profileHash === 'string' ? { profileHash } : {}),
  };
}

/**
 * Masks credentials in a database connection URL.
 * Handles standard URLs (username + password + query params) and libpq-style key=value strings.
 */
export function maskConnectionUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) {
      parsed.username = '****';
    }
    if (parsed.password) {
      parsed.password = '****';
    }
    // Also mask password in query parameters (e.g., ?password=secret, ?sslpassword=secret)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/password/i.test(key)) {
        parsed.searchParams.set(key, '****');
      }
    }
    return parsed.toString();
  } catch {
    // Fallback for libpq-style key=value connection strings (e.g., "host=localhost password=secret user=admin")
    return url
      .replace(/password\s*=\s*\S+/gi, 'password=****')
      .replace(/user\s*=\s*\S+/gi, 'user=****');
  }
}

/**
 * Strips raw connection URL fragments from an error message to prevent credential leakage.
 * Call this before surfacing driver errors to the user.
 */
export function sanitizeErrorMessage(message: string, connectionUrl?: string): string {
  if (!connectionUrl) {
    return message;
  }
  try {
    const parsed = new URL(connectionUrl);
    // Replace the full URL (with and without trailing slash)
    let sanitized = message;
    sanitized = sanitized.replaceAll(connectionUrl, maskConnectionUrl(connectionUrl));
    // Also replace the password and username individually if they appear
    if (parsed.password) {
      sanitized = sanitized.replaceAll(parsed.password, '****');
    }
    if (parsed.username) {
      sanitized = sanitized.replaceAll(parsed.username, '****');
    }
    return sanitized;
  } catch {
    // For libpq-style strings, mask password and user values in the message
    return message
      .replace(/password\s*=\s*\S+/gi, 'password=****')
      .replace(/user\s*=\s*\S+/gi, 'user=****');
  }
}
