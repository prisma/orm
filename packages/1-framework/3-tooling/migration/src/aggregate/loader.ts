import type { Contract } from '@internal/contract/types';
import { ifDefined } from '@internal/utils/defined';
import type { SnapshotContentVerifier } from '../contract-snapshot-store';
import { readContractSnapshotJson } from '../contract-snapshot-store';
import { errorSpaceHeadRefMissing, MigrationToolsError } from '../errors';
import { readMigrationsDir } from '../io';
import {
  type ContractSpaceHeadRef,
  readContractSpaceHeadRef,
} from '../read-contract-space-head-ref';
import { HEAD_REF_NAME, type RefLoadProblem, readRefsTolerant } from '../refs';
import {
  APP_SPACE_ID,
  isValidSpaceId,
  spaceMigrationDirectory,
  spaceRefsDirectory,
} from '../space-layout';
import { listContractSpaceDirectories } from '../verify-contract-spaces';
import { createAggregateContractSpace, createContractSpaceAggregate } from './aggregate';
import { computeIntegrityViolations, type IntegritySpaceState } from './check-integrity';
import type { ContractSpaceAggregate } from './types';

export type { DeclaredExtensionEntry } from '../integrity-violation';

/**
 * Inputs for {@link loadContractSpaceAggregate}.
 *
 * Construction reads migration **state** from disk (`migrations/<space>/`
 * packages + refs + head refs). The app's *live* contract is not a disk
 * artifact — in Prisma Next it is always compiled from the project's
 * central contract, so the caller always has it and threads it in as
 * `appContract`. `deserializeContract` is held and called lazily only for
 * the extension contracts resolved from the contract snapshot store,
 * keyed by each extension space's head ref hash.
 */
export interface LoadAggregateInput {
  readonly migrationsDir: string;
  readonly deserializeContract: (raw: unknown) => Contract;
  readonly appContract: Contract;
  /**
   * Content check for contract snapshots resolved from the store: every
   * snapshot read through this aggregate is recomputed against the hash it
   * was addressed by. Construction stays tolerant — a mismatched extension
   * head snapshot surfaces at `contract()` time as `contractUnreadable`,
   * and `contractAt()` throws `MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH`.
   */
  readonly verifySnapshotContent?: SnapshotContentVerifier;
}

/**
 * Build a tolerant, queryable {@link ContractSpaceAggregate} from on-disk
 * migration state plus the caller's live app contract.
 *
 * Building **never throws on disk content**: a hash- or
 * invariants-mismatched package is retained, an unparseable package is
 * omitted, a missing extension head ref leaves `headRef: null`, and an
 * unreadable on-disk contract defers its failure to `space.contract()`.
 * Every such problem is judged by {@link ContractSpaceAggregate.checkIntegrity}
 * rather than aborting the load. The only rejections are catastrophic I/O
 * (a `migrations/` that exists but is unreadable for reasons other than
 * absence).
 *
 * The app space's head ref is synthesised from the live contract's
 * storage hash (the app contract is authored independently of the
 * migration graph), and `app.contract()` returns the supplied contract.
 * Extension spaces read their contract, refs, and head ref from disk.
 */
export async function loadContractSpaceAggregate(
  input: LoadAggregateInput,
): Promise<ContractSpaceAggregate> {
  const { migrationsDir, deserializeContract, appContract, verifySnapshotContent } = input;
  const targetId = appContract.target;

  const appState = await loadAppSpace(
    migrationsDir,
    appContract,
    deserializeContract,
    verifySnapshotContent,
  );
  const extensionStates = await loadExtensionSpaces(
    migrationsDir,
    deserializeContract,
    verifySnapshotContent,
  );

  const spaces: readonly IntegritySpaceState[] = [appState, ...extensionStates];

  return createContractSpaceAggregate({
    targetId,
    app: appState.space,
    extensions: extensionStates.map((state) => state.space),
    checkIntegrity: (opts) => computeIntegrityViolations({ targetId, spaces }, opts),
  });
}

async function loadAppSpace(
  migrationsDir: string,
  appContract: Contract,
  deserializeContract: (raw: unknown) => Contract,
  verifySnapshotContent: SnapshotContentVerifier | undefined,
): Promise<IntegritySpaceState> {
  const spaceDir = spaceMigrationDirectory(migrationsDir, APP_SPACE_ID);
  const { packages, problems } = await readMigrationsDir(spaceDir, {
    migrationsDir,
    ...ifDefined('verifySnapshotContent', verifySnapshotContent),
  });
  const { refs, problems: refProblems } = await readRefsTolerant(spaceRefsDirectory(spaceDir));

  const space = createAggregateContractSpace({
    spaceId: APP_SPACE_ID,
    packages,
    refs,
    headRef: { hash: appContract.storage.storageHash, invariants: [] },
    refsDir: spaceRefsDirectory(spaceDir),
    migrationsDir,
    resolveContract: () => appContract,
    deserializeContract,
    ...ifDefined('verifySnapshotContent', verifySnapshotContent),
  });

  // The app head ref is synthesised from the live contract, so there is
  // no on-disk head.json to be missing or corrupt for it.
  return {
    space,
    problems,
    refProblems,
    headRefProblem: null,
    isApp: true,
  };
}

async function loadExtensionSpaces(
  migrationsDir: string,
  deserializeContract: (raw: unknown) => Contract,
  verifySnapshotContent: SnapshotContentVerifier | undefined,
): Promise<readonly IntegritySpaceState[]> {
  const candidateDirs = await listContractSpaceDirectories(migrationsDir);
  const extensionIds = candidateDirs
    .filter((name) => name !== APP_SPACE_ID)
    .filter(isValidSpaceId)
    .sort();

  const states: IntegritySpaceState[] = [];
  for (const spaceId of extensionIds) {
    states.push(
      await loadExtensionSpace(migrationsDir, spaceId, deserializeContract, verifySnapshotContent),
    );
  }
  return states;
}

async function loadExtensionSpace(
  migrationsDir: string,
  spaceId: string,
  deserializeContract: (raw: unknown) => Contract,
  verifySnapshotContent: SnapshotContentVerifier | undefined,
): Promise<IntegritySpaceState> {
  const spaceDir = spaceMigrationDirectory(migrationsDir, spaceId);
  const { packages, problems } = await readMigrationsDir(spaceDir, {
    migrationsDir,
    ...ifDefined('verifySnapshotContent', verifySnapshotContent),
  });
  const { refs, problems: refProblems } = await readRefsTolerant(spaceRefsDirectory(spaceDir));
  const { headRef, problem: headRefProblem } = await readHeadRefTolerant(migrationsDir, spaceId);

  const rawContract = await readRawContractDeferred(
    migrationsDir,
    spaceId,
    headRef,
    verifySnapshotContent,
  );

  const space = createAggregateContractSpace({
    spaceId,
    packages,
    refs,
    headRef,
    refsDir: spaceRefsDirectory(spaceDir),
    migrationsDir,
    resolveContract: () => deserializeContract(rawContract()),
    deserializeContract,
    ...ifDefined('verifySnapshotContent', verifySnapshotContent),
  });

  return { space, problems, refProblems, headRefProblem, isApp: false };
}

/**
 * The result of resolving an extension's `refs/head.json`: the parsed
 * head ref (or `null` when the file is absent or corrupt) plus a problem
 * when the file exists but cannot be parsed.
 */
interface HeadRefReadResult {
  readonly headRef: Awaited<ReturnType<typeof readContractSpaceHeadRef>>;
  readonly problem: RefLoadProblem | null;
}

/**
 * Read an extension's head ref, distinguishing a *genuinely absent*
 * `head.json` (`headRef: null`, no problem — judged `headRefMissing`)
 * from one that *exists but cannot be parsed* (`headRef: null` plus a
 * problem — judged `refUnreadable`, not `headRefMissing`).
 * `readContractSpaceHeadRef` already returns `null` only for ENOENT and
 * throws for unparseable / schema-invalid content, so the throw is the
 * corruption signal. Construction never throws on disk content.
 */
function isToleratedRefHeadReadError(error: unknown): boolean {
  if (MigrationToolsError.is(error)) return true;
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'EISDIR';
}

async function readHeadRefTolerant(
  migrationsDir: string,
  spaceId: string,
): Promise<HeadRefReadResult> {
  try {
    const headRef = await readContractSpaceHeadRef(migrationsDir, spaceId);
    return { headRef, problem: null };
  } catch (error) {
    if (!isToleratedRefHeadReadError(error)) {
      throw error;
    }
    return { headRef: null, problem: { refName: HEAD_REF_NAME, detail: detailOf(error) } };
  }
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read the raw contract snapshot-store entry eagerly (cheap I/O) but defer
 * its (throwing) failure to call time, so a missing or unparseable store
 * entry becomes a `contract()` throw — surfaced as `contractUnreadable` —
 * rather than a construction failure. When `headRef` is absent there is no
 * hash to resolve against the store, so the deferred call always throws;
 * `checkIntegrity` already reports that case as `headRefMissing`, and a
 * `checkContracts` pass surfaces the same space as `contractUnreadable`.
 */
async function readRawContractDeferred(
  migrationsDir: string,
  spaceId: string,
  headRef: ContractSpaceHeadRef | null,
  verifySnapshotContent: SnapshotContentVerifier | undefined,
): Promise<() => unknown> {
  if (headRef === null) {
    return () => {
      throw errorSpaceHeadRefMissing(spaceId);
    };
  }
  try {
    const raw = await readContractSnapshotJson(migrationsDir, headRef.hash, verifySnapshotContent);
    return () => raw;
  } catch (error) {
    return () => {
      throw error;
    };
  }
}
