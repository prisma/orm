/**
 * Resolves a user-supplied contract reference to an on-disk contract JSON (snapshot store or emitted contract), shared by db sign and db update --to.
 */

import { readFile } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import {
  contractSnapshotDir,
  readContractSnapshotJson,
} from '@internal/migration-tools/contract-snapshot-store';
import {
  errorContractDeserializationFailed,
  MigrationToolsError,
} from '@internal/migration-tools/errors';
import { parseContractRef } from '@internal/migration-tools/ref-resolution';
import { blindCast, castAs } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';
import { join } from 'pathe';
import {
  CliStructuredError,
  errorFileNotFound,
  errorRuntime,
  errorUnexpected,
  mapRefResolutionError,
} from '../../utils/cli-errors';
import { snapshotVerifierFor } from '../../utils/snapshot-content-verification';
import { buildReadAggregate } from './contract-space-aggregate-loader';

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

interface ResolveContractRefToSnapshotBaseOptions {
  readonly config: PrismaNextConfig;
  readonly migrationsDir: string;
  /** User-supplied contract reference (hash, prefix, ref name, migration dir name, <dir>^, or ./path). */
  readonly refInput: string;
  /** Absolute path of the emitted contract.json (fallback source + snapshot-path derivation). */
  readonly contractPathAbsolute: string;
}

/**
 * `fallbackToEmitted` discriminates the missing-bundle behavior:
 * true (db sign): fall back to the emitted contract when no bundle matches and its
 * storage.storageHash matches; else the 'No contract file found for hash "<hash>"' errorRuntime.
 * false (db update --to): missing bundle = the errorUnexpected 'No migration bundle found for
 * <flag> "<input>" (resolved hash: <hash>)' envelope, so `missingBundleFlag` (the flag label
 * for that message) is required in this branch.
 */
export type ResolveContractRefToSnapshotOptions = ResolveContractRefToSnapshotBaseOptions &
  (
    | { readonly fallbackToEmitted: true; readonly missingBundleFlag?: never }
    | { readonly fallbackToEmitted: false; readonly missingBundleFlag: '--to' }
  );

export interface ResolveContractRefToSnapshotSuccess {
  readonly hash: string;
  readonly contractJson: Record<string, unknown>;
  /** snapshot → join(contractSnapshotDir(migrationsDir, hash), 'contract.json'); emitted → contractPathAbsolute. */
  readonly contractJsonPath: string;
  readonly source: 'snapshot' | 'emitted';
}

export async function resolveContractRefToSnapshot(
  options: ResolveContractRefToSnapshotOptions,
): Promise<Result<ResolveContractRefToSnapshotSuccess, CliStructuredError>> {
  try {
    const loaded = await buildReadAggregate(options.config, {
      migrationsDir: options.migrationsDir,
    });
    if (!loaded.ok) {
      return notOk(loaded.failure);
    }
    const graph = loaded.value.aggregate.app.graph();
    const bundles = loaded.value.aggregate.app.packages;
    const refs = loaded.value.aggregate.app.refs;
    const refResult = parseContractRef(options.refInput, { graph, refs });
    if (!refResult.ok) {
      return notOk(mapRefResolutionError(refResult.failure));
    }
    const targetHash = refResult.value.hash;
    const matchingBundle = bundles.find((p) => p.metadata.to === targetHash);
    if (matchingBundle) {
      const contractJson = blindCast<
        Record<string, unknown>,
        'contract snapshot store entries are JSON objects written by writeContractSnapshot'
      >(
        await readContractSnapshotJson(
          options.migrationsDir,
          targetHash,
          snapshotVerifierFor(options.config),
        ),
      );
      return ok({
        hash: targetHash,
        contractJson,
        contractJsonPath: join(
          contractSnapshotDir(options.migrationsDir, targetHash),
          'contract.json',
        ),
        source: 'snapshot',
      });
    }
    if (!options.fallbackToEmitted) {
      return notOk(
        errorUnexpected(
          `No migration bundle found for ${options.missingBundleFlag} "${options.refInput}" (resolved hash: ${targetHash})`,
          {
            why: `The ref resolved successfully but no on-disk migration package has a destination (\`to\`) hash matching ${targetHash}.`,
            fix: 'Provide a ref or hash that corresponds to an existing migration package, or run `migration list` to see available migrations.',
          },
        ),
      );
    }
    let defaultRaw: string;
    try {
      defaultRaw = await readFile(options.contractPathAbsolute, 'utf-8');
    } catch (error) {
      if (isEnoent(error)) {
        return notOk(
          errorFileNotFound(options.contractPathAbsolute, {
            why: `Contract file not found at ${options.contractPathAbsolute}`,
            fix: 'Run `{bin} contract emit` first to generate the contract',
            cause: error,
          }),
        );
      }
      return notOk(
        errorUnexpected(error instanceof Error ? error.message : String(error), {
          why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
          cause: error,
        }),
      );
    }
    let parsed: unknown;
    try {
      parsed = castAs<unknown>(JSON.parse(defaultRaw));
    } catch (error) {
      return notOk(
        errorContractDeserializationFailed(
          options.contractPathAbsolute,
          error instanceof Error ? error.message : String(error),
          { cause: error },
        ),
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return notOk(
        errorContractDeserializationFailed(
          options.contractPathAbsolute,
          `expected a JSON object, got ${parsed === null ? 'null' : Array.isArray(parsed) ? 'an array' : `a ${typeof parsed}`}`,
        ),
      );
    }
    const defaultContract = blindCast<
      Record<string, unknown>,
      'narrowed to a non-null, non-array object by the shape check above'
    >(parsed);
    const storage = defaultContract['storage'];
    const storageHash =
      storage !== null && typeof storage === 'object'
        ? blindCast<Record<string, unknown>, 'narrowed to a non-null object by the check above'>(
            storage,
          )['storageHash']
        : undefined;
    if (storageHash === targetHash) {
      return ok({
        hash: targetHash,
        contractJson: defaultContract,
        contractJsonPath: options.contractPathAbsolute,
        source: 'emitted',
      });
    }
    return notOk(
      errorRuntime(
        'MIGRATION.SNAPSHOT_MISSING',
        `No contract file found for hash "${targetHash}"`,
        {
          why: `Resolved contract reference "${options.refInput}" to hash "${targetHash}" but no migration produces that hash and the emitted contract does not match.`,
          fix: 'Ensure the target contract exists on disk — either as a migration endpoint or as the emitted contract.json.',
        },
      ),
    );
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(error);
    }
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    throw error;
  }
}
