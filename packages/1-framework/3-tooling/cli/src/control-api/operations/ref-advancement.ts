import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { errorInvalidRefName, MigrationToolsError } from '@internal/migration-tools/errors';
import { validateRefName, writeRef } from '@internal/migration-tools/refs';
import { notOk, ok, type Result } from '@internal/utils/result';
import { CliStructuredError } from '../../utils/cli-errors';
import { createProjectSpecifierResolver } from '../../utils/project-import-root';
import type { ControlClient } from '../types';
import { renderSnapshotDeclarations } from './snapshot-declarations';

/** A contract snapshot's two halves: the JSON and the declarations rendered from it. */
export interface ContractIR {
  readonly contract: unknown;
  readonly contractDts: string;
}

export interface RefAdvancementFields {
  readonly advancedRef: { readonly name: string; readonly hash: string } | null;
  readonly plannedAdvanceRef: { readonly name: string; readonly hash: string } | null;
}

export const NO_REF_ADVANCEMENT: RefAdvancementFields = {
  advancedRef: null,
  plannedAdvanceRef: null,
};

export function computeRefAdvancementName(options: {
  readonly advanceRef?: string;
  readonly db?: string;
}): string | null {
  if (options.advanceRef !== undefined) {
    return options.advanceRef;
  }
  if (options.db === undefined) {
    return 'db';
  }
  return null;
}

/**
 * Everything `executeRefAdvancement` needs, produced before a command does the
 * work that precedes the ref write: the ref name is validated and the
 * declarations of the contract to snapshot are rendered from its JSON, with
 * the import names the project owning `configPath` can resolve. Nothing is
 * read or rendered after the database is touched, so a contract that cannot
 * be snapshotted refuses the command before it changes anything.
 */
export async function preflightRefAdvancement(args: {
  readonly name: string;
  readonly contractJson: Record<string, unknown>;
  readonly contractJsonPath: string;
  readonly configPath: string;
  readonly client: Pick<ControlClient, 'renderContractDts'>;
}): Promise<Result<ContractIR, CliStructuredError>> {
  if (!validateRefName(args.name)) {
    return notOk(errorInvalidRefName(args.name));
  }
  let resolveImportSpecifier: ReturnType<typeof createProjectSpecifierResolver>;
  try {
    resolveImportSpecifier = createProjectSpecifierResolver(args.configPath);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    throw error;
  }
  const rendered = await renderSnapshotDeclarations({
    client: args.client,
    contractJson: args.contractJson,
    contractJsonPath: args.contractJsonPath,
    resolveImportSpecifier,
  });
  if (!rendered.ok) {
    return rendered;
  }
  return ok({ contract: args.contractJson, contractDts: rendered.value });
}

export async function executeRefAdvancement(
  refsDir: string,
  migrationsDir: string,
  name: string,
  hash: string,
  contractIR: ContractIR,
): Promise<{ name: string; hash: string }> {
  // Validate the ref name before writing anything: writeRef validates it too,
  // but only after the store write below, which would otherwise leave a
  // (harmless, but pointless) orphan store entry on an invalid name.
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }
  await writeContractSnapshot(migrationsDir, hash, {
    contractJson: contractIR.contract,
    contractDts: contractIR.contractDts,
  });
  await writeRef(refsDir, name, { hash, invariants: [] });
  return { name, hash };
}

/**
 * The ref-advancement tail of db init / db update, run after the database
 * work with the `ContractIR` that `preflightRefAdvancement` produced before
 * it. Plan mode reports the ref that an apply would advance without writing.
 */
export async function buildRefAdvancementFields(options: {
  readonly name: string;
  readonly refsDir: string;
  readonly migrationsDir: string;
  readonly contractIR: ContractIR;
  readonly mode: 'plan' | 'apply';
  readonly hash: string;
}): Promise<Result<RefAdvancementFields, CliStructuredError>> {
  if (options.mode === 'plan') {
    return ok({
      advancedRef: null,
      plannedAdvanceRef: { name: options.name, hash: options.hash },
    });
  }
  const advanced = await advanceRefSafely({
    refsDir: options.refsDir,
    migrationsDir: options.migrationsDir,
    name: options.name,
    hash: options.hash,
    contractIR: options.contractIR,
  });
  if (!advanced.ok) {
    return advanced;
  }
  return ok({ advancedRef: advanced.value, plannedAdvanceRef: null });
}

/**
 * The --advance-ref tail of migrate and db sign: executeRefAdvancement with
 * MigrationToolsError failures passed through as notOk, others rethrown.
 */
export async function advanceRefSafely(args: {
  readonly refsDir: string;
  readonly migrationsDir: string;
  readonly name: string;
  readonly hash: string;
  readonly contractIR: ContractIR;
}): Promise<Result<{ readonly name: string; readonly hash: string }, CliStructuredError>> {
  try {
    const advanced = await executeRefAdvancement(
      args.refsDir,
      args.migrationsDir,
      args.name,
      args.hash,
      args.contractIR,
    );
    return ok(advanced);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(error);
    }
    throw error;
  }
}
