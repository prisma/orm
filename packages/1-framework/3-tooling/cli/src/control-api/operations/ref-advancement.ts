import {
  hasContractSnapshot,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { errorInvalidRefName, MigrationToolsError } from '@internal/migration-tools/errors';
import { advanceRef, validateRefName } from '@internal/migration-tools/refs';
import { isInternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { CliStructuredError } from '../../utils/cli-errors';
import { contractTypesModuleOf } from '../../utils/command-helpers';
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
 * declarations of the contract to snapshot are rendered from its JSON. Nothing
 * is read or rendered after the database is touched, so a contract that cannot
 * be snapshotted refuses the command before it changes anything.
 */
export async function preflightRefAdvancement(args: {
  readonly name: string;
  readonly contractJson: Record<string, unknown>;
  readonly contractJsonPath: string;
  readonly config: { readonly contract?: { readonly typesModule?: string } };
  readonly client: Pick<ControlClient, 'renderContractDts'>;
}): Promise<Result<ContractIR, CliStructuredError>> {
  if (!validateRefName(args.name)) {
    return notOk(errorInvalidRefName(args.name));
  }
  const typesModule = contractTypesModuleOf(args.config);
  if (!typesModule.ok) {
    return typesModule;
  }
  const rendered = await renderSnapshotDeclarations({
    client: args.client,
    contractJson: args.contractJson,
    contractJsonPath: args.contractJsonPath,
    typesModule: typesModule.value,
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
  // Validate the ref name before writing anything: advanceRef validates it too,
  // but only after the store write below, which would otherwise leave a
  // (harmless, but pointless) orphan store entry on an invalid name.
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }
  await writeContractSnapshot(migrationsDir, hash, {
    contractJson: contractIR.contract,
    contractDts: contractIR.contractDts,
  });
  await advanceRef(refsDir, name, hash);
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

/** How a ref's snapshot reaches the store: it is there already, or this run renders it. */
export type RefSnapshot =
  | { readonly kind: 'stored' }
  | { readonly kind: 'render'; readonly contractIR: ContractIR };

export interface RefWriteFailure {
  readonly reason: string;
  readonly causeCode: string | undefined;
  /** Whether the store holds the snapshot for the ref's hash, which `migration ref set` needs. */
  readonly snapshotStored: boolean;
}

/** Writes a ref's pointer file; `advanceRef` in production. */
export type RefPointerWriter = (refsDir: string, name: string, hash: string) => Promise<unknown>;

function refWriteFailure(error: unknown, snapshotStored: boolean): RefWriteFailure {
  const code = Reflect.get(Object(error), 'code');
  return {
    reason: error instanceof Error ? error.message : String(error),
    causeCode: typeof code === 'string' ? code : undefined,
    snapshotStored,
  };
}

/**
 * Writes a ref after `db migrate` applied its migrations: the snapshot first, when this run
 * rendered it, then the pointer. Every failure is returned, not thrown: the database has already
 * moved, so a ref that cannot be written must not fail the run. An internal error is a bug and
 * goes to the outermost boundary.
 */
export async function writeAdvancedRef(
  args: {
    readonly refsDir: string;
    readonly migrationsDir: string;
    readonly name: string;
    readonly hash: string;
    readonly snapshot: RefSnapshot;
  },
  writePointer: RefPointerWriter,
): Promise<Result<void, RefWriteFailure>> {
  let snapshotStored = false;
  try {
    if (args.snapshot.kind === 'render') {
      await writeContractSnapshot(args.migrationsDir, args.hash, {
        contractJson: args.snapshot.contractIR.contract,
        contractDts: args.snapshot.contractIR.contractDts,
      });
      snapshotStored = true;
    } else {
      snapshotStored = await hasContractSnapshot(args.migrationsDir, args.hash);
      if (!snapshotStored) {
        return notOk({
          reason: `the snapshot store holds no contract for ${args.hash}`,
          causeCode: undefined,
          snapshotStored,
        });
      }
    }
    await writePointer(args.refsDir, args.name, args.hash);
    return ok(undefined);
  } catch (error) {
    if (isInternalError(error)) {
      throw error;
    }
    return notOk(refWriteFailure(error, snapshotStored));
  }
}
