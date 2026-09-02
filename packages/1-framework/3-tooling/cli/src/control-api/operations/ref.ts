/**
 * Policy cores of the `ref set` / `ref delete` / `ref list` commands: resolve the reference, and write or read the refs index.
 */

import type { PrismaNextConfig } from '@internal/config/config-types';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import {
  contractSnapshotDir,
  readContractSnapshotJson,
} from '@internal/migration-tools/contract-snapshot-store';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { findLatestMigration, isGraphNode } from '@internal/migration-tools/migration-graph';
import { parseContractRef } from '@internal/migration-tools/ref-resolution';
import type { RefEntry } from '@internal/migration-tools/refs';
import {
  deleteRef,
  readRefs,
  validateRefName,
  validateRefValue,
  writeRef,
} from '@internal/migration-tools/refs';
import { notOk, ok, type Result } from '@internal/utils/result';
import { join } from 'pathe';
import {
  CliStructuredError,
  errorFileNotFound,
  errorRefSetBundleNotFound,
  errorRefSetEmptySentinel,
  errorRefSetHashNotInGraph,
  errorRuntime,
  errorUnexpected,
  mapRefResolutionError,
} from '../../utils/cli-errors';
import { resolveMigrationPaths } from '../../utils/command-helpers';
import { snapshotVerifierFor } from '../../utils/snapshot-content-verification';
import { buildReadAggregate } from './contract-space-aggregate-loader';

export interface RefSetResult {
  readonly ok: true;
  readonly ref: string;
  readonly hash: string;
  readonly invariants: readonly string[];
}

export interface RefDeleteResult {
  readonly ok: true;
  readonly ref: string;
  readonly deleted: true;
}

export interface RefListResult {
  readonly ok: true;
  readonly refs: Record<string, RefEntry>;
}

function mapError(error: unknown): CliStructuredError {
  if (MigrationToolsError.is(error)) {
    return error;
  }
  return errorUnexpected(error instanceof Error ? error.message : String(error));
}

export interface RefOperationOptions {
  readonly config: PrismaNextConfig;
  /** Directory the command was invoked from. */
  readonly cwd: string;
  /** `--config` as the user wrote it, used only to locate the migrations directory and for display. */
  readonly configPath?: string;
}

function cliErrorInvalidRefName(name: string): CliStructuredError {
  return errorRuntime('MIGRATION.INVALID_REF_NAME', `Invalid ref name "${name}"`, {
    why: `Ref name "${name}" does not match the required format`,
    fix: 'Ref names must be lowercase alphanumeric with hyphens or forward slashes, no `.` or `..` segments',
  });
}

export async function executeRefSetCommand(
  name: string,
  contractInput: string,
  options: RefOperationOptions,
): Promise<Result<RefSetResult, CliStructuredError>> {
  if (!validateRefName(name)) {
    return notOk(cliErrorInvalidRefName(name));
  }

  const config = options.config;
  try {
    const { migrationsDir, refsDir } = resolveMigrationPaths(
      options.configPath,
      config,
      options.cwd,
    );
    const loaded = await buildReadAggregate(config, { migrationsDir });
    if (!loaded.ok) {
      return notOk(loaded.failure);
    }
    const graph = loaded.value.aggregate.app.graph();
    const bundles = loaded.value.aggregate.app.packages;
    const refs = loaded.value.aggregate.app.refs;

    let resolvedHash: string;
    if (validateRefValue(contractInput)) {
      resolvedHash = contractInput;
    } else {
      const refResult = parseContractRef(contractInput, { graph, refs });
      if (!refResult.ok) {
        return notOk(mapRefResolutionError(refResult.failure));
      }
      resolvedHash = refResult.value.hash;
    }

    if (resolvedHash === EMPTY_CONTRACT_HASH) {
      return notOk(errorRefSetEmptySentinel(resolvedHash));
    }
    if (!isGraphNode(resolvedHash, graph)) {
      const graphTip = findLatestMigration(graph)?.to ?? null;
      return notOk(errorRefSetHashNotInGraph(resolvedHash, [...graph.nodes].sort(), graphTip));
    }

    const matchingBundle = bundles.find((bundle) => bundle.metadata.to === resolvedHash);
    if (!matchingBundle) {
      return notOk(errorRefSetBundleNotFound(resolvedHash));
    }

    const contractJsonPath = join(
      contractSnapshotDir(migrationsDir, resolvedHash),
      'contract.json',
    );
    try {
      await readContractSnapshotJson(migrationsDir, resolvedHash, snapshotVerifierFor(config));
    } catch (readError) {
      if (
        MigrationToolsError.is(readError) &&
        readError.code === 'MIGRATION.CONTRACT_SNAPSHOT_MISSING'
      ) {
        return notOk(
          errorFileNotFound(contractJsonPath, {
            why: `Migration bundle for hash ${resolvedHash} is missing its contract snapshot at ${contractJsonPath}`,
            fix: 'Restore migrations/snapshots/ from version control, or re-run the command that produced this migration to regenerate its snapshot.',
          }),
        );
      }
      throw readError;
    }

    const entry: RefEntry = { hash: resolvedHash, invariants: [] };
    await writeRef(refsDir, name, entry);
    return ok({ ok: true as const, ref: name, hash: resolvedHash, invariants: [] });
  } catch (error) {
    if (error instanceof CliStructuredError) return notOk(error);
    return notOk(mapError(error));
  }
}

export async function executeRefDeleteCommand(
  name: string,
  options: RefOperationOptions,
): Promise<Result<RefDeleteResult, CliStructuredError>> {
  try {
    const { refsDir } = resolveMigrationPaths(options.configPath, options.config, options.cwd);
    await deleteRef(refsDir, name);
    return ok({ ok: true as const, ref: name, deleted: true as const });
  } catch (error) {
    if (error instanceof CliStructuredError) return notOk(error);
    return notOk(mapError(error));
  }
}

export async function executeRefListCommand(
  options: RefOperationOptions,
): Promise<Result<RefListResult, CliStructuredError>> {
  try {
    const { refsDir } = resolveMigrationPaths(options.configPath, options.config, options.cwd);
    const refs = await readRefs(refsDir);
    return ok({ ok: true as const, refs });
  } catch (error) {
    if (error instanceof CliStructuredError) return notOk(error);
    return notOk(mapError(error));
  }
}
