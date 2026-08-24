import { readFile } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { castAs } from '@internal/utils/casts';
import type { CliStructuredError, Result } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import type { ControlClient, CreateControlClient } from '../../control-api/types';
import {
  errorConfigValidation,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '../../utils/cli-errors';
import { maskConnectionUrl, targetSupportsMigrations } from '../../utils/command-helpers';
import { appRefsDirFor, contractPathFor, displayPath, migrationsDirFor } from '../migration/paths';
import { normalizeError } from '../normalize-error';

/**
 * Everything a database-writing migration command needs before it connects:
 * the emitted contract, where migrations and refs live, a resolved connection,
 * and a client built from the config's descriptors.
 */
export interface PreparedMigrationRun {
  readonly client: ControlClient;
  readonly contractJson: Record<string, unknown>;
  readonly contractPath: string;
  readonly contractDisplayPath: string;
  readonly dbConnection: unknown;
  readonly database: string | undefined;
  readonly migrationsDir: string;
  readonly refsDir: string;
}

/** Reads the emitted contract as the raw document the control API validates. */
export async function readContractDocument(
  contractPath: string,
): Promise<Result<Record<string, unknown>, CliStructuredError>> {
  let content: string;
  try {
    content = await readFile(contractPath, 'utf-8');
  } catch (error) {
    const missing = Reflect.get(Object(error), 'code') === 'ENOENT';
    return notOk(
      normalizeError(
        missing
          ? errorFileNotFound(contractPath, {
              why: `Contract file not found at ${contractPath}`,
              fix: 'Run `{bin} contract emit` to generate contract.json, or update `contract.output` in prisma.config.ts',
            })
          : errorUnexpected(error instanceof Error ? error.message : String(error), {
              why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
            }),
      ),
    );
  }
  try {
    return ok(castAs<Record<string, unknown>>(JSON.parse(content)));
  } catch (error) {
    return notOk(
      normalizeError(
        errorContractValidationFailed(
          `Contract JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
          { where: { path: contractPath } },
        ),
      ),
    );
  }
}

export async function prepareMigrationRun(inputs: {
  readonly config: PrismaNextConfig;
  readonly cwd: string;
  readonly db: string | undefined;
  readonly commandName: string;
  readonly createClient: CreateControlClient;
}): Promise<Result<PreparedMigrationRun, CliStructuredError>> {
  const { config, cwd, commandName } = inputs;
  const contractPath = contractPathFor(config, cwd);
  if (contractPath === undefined) {
    return notOk(
      normalizeError(
        errorConfigValidation('contract.output', {
          why: `${commandName} reads the emitted contract from config.contract.output; the config has no value to read.`,
          section: 'contract',
        }),
      ),
    );
  }

  const contract = await readContractDocument(contractPath);
  if (!contract.ok) {
    return notOk(contract.failure);
  }

  const dbConnection = inputs.db ?? config.db?.connection;
  if (dbConnection === undefined) {
    return notOk(
      normalizeError(
        errorDatabaseConnectionRequired({
          why: `Database connection is required for ${commandName} (set db.connection in prisma.config.ts, or pass --db <url>)`,
          commandName,
          missingFlags: ['--db'],
        }),
      ),
    );
  }
  if (config.driver === undefined) {
    return notOk(
      normalizeError(errorDriverRequired({ why: `Config.driver is required for ${commandName}` })),
    );
  }
  if (!targetSupportsMigrations(config.target)) {
    return notOk(
      normalizeError(
        errorTargetMigrationNotSupported({
          why: `Target "${config.target.id}" does not support migrations`,
        }),
      ),
    );
  }

  return ok({
    client: inputs.createClient({
      family: config.family,
      target: config.target,
      adapter: config.adapter,
      driver: config.driver,
      extensions: config.extensions ?? [],
    }),
    contractJson: contract.value,
    contractPath,
    contractDisplayPath: displayPath(contractPath, cwd),
    dbConnection,
    database: typeof dbConnection === 'string' ? maskConnectionUrl(dbConnection) : undefined,
    migrationsDir: migrationsDirFor(config, cwd),
    refsDir: appRefsDirFor(config, cwd),
  });
}
