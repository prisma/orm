import type { LedgerEntryRecord } from '@internal/contract/types';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import { isGraphNode } from '@internal/migration-tools/migration-graph';
import { ifDefined } from '@internal/utils/defined';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { ActionableCliError } from './cli-errors';
import { chooseAction, runCommandAction } from './next-actions';
import { type CliInvocation, cliCommand, printedPath } from './printed-command';

/** Who ships a space's migrations: the project, or an extension package. */
export type SpaceOwner =
  | {
      readonly kind: 'application';
      /** The emitted contract, which `db update` reconciles to when it is given no `--to`. */
      readonly emittedContractHash: string;
    }
  | { readonly kind: 'extension' };

/** A space whose marker names a contract that is not a node of the space's migration graph. */
export interface MarkerOutsideGraph {
  readonly spaceId: string;
  readonly owner: SpaceOwner;
  readonly markerHash: string;
  readonly targetHash: string;
  readonly graph: MigrationGraph;
  readonly migrationsDir: string;
  /** The space's ledger in apply order, or undefined when it could not be read. */
  readonly ledger: readonly LedgerEntryRecord[] | undefined;
  readonly invocation: CliInvocation;
}

/** The ledger as `read` gives it, or undefined when the read fails: the error it explains must not fail with it. */
export async function readLedgerQuietly(
  read: () => Promise<readonly LedgerEntryRecord[]>,
): Promise<readonly LedgerEntryRecord[] | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** What the ledger recorded after the last contract of the graph the database reached. */
interface LedgerAfterGraph {
  readonly lastGraphHash: string;
  /** Migrations applied after it whose directory is not on disk, oldest first. */
  readonly missingMigrations: readonly string[];
  /** Migrations applied after it whose directory is on disk with different content, oldest first. */
  readonly replannedMigrations: readonly string[];
  /** Whether `db update` or `db init` moved the database after it; their rows name no migration. */
  readonly movedWithoutMigration: boolean;
}

function ledgerAfterGraph(
  ledger: readonly LedgerEntryRecord[],
  graph: MigrationGraph,
): LedgerAfterGraph | undefined {
  const lastOnGraph = ledger.findLastIndex((applied) => isGraphNode(applied.to, graph));
  const last = ledger[lastOnGraph];
  if (last === undefined) {
    return undefined;
  }
  const after = ledger.slice(lastOnGraph + 1);
  const named = after.flatMap((applied) =>
    applied.migrationName === '' ? [] : [applied.migrationName],
  );
  const onDisk = new Set([...graph.migrationByHash.values()].map((edge) => edge.dirName));
  return {
    lastGraphHash: last.to,
    missingMigrations: named.filter((name) => !onDisk.has(name)),
    replannedMigrations: named.filter((name) => onDisk.has(name)),
    movedWithoutMigration: after.some((applied) => applied.migrationName === ''),
  };
}

const NAMES_IN_WHY = 5;

function nameList(names: readonly string[]): string {
  const shown = names.slice(0, NAMES_IN_WHY).join(', ');
  const hidden = names.length - NAMES_IN_WHY;
  return hidden > 0 ? `${shown}, and ${hidden} more` : shown;
}

const MOVED_BY_DB_UPDATE = '`db update` or `db init` moved it outside the migration graph.';

function whichIs(names: readonly string[], singular: string, plural: string): string {
  return `${nameList(names)}, which ${names.length === 1 ? singular : plural}`;
}

function historySentence(history: LedgerAfterGraph): string {
  const { lastGraphHash, missingMigrations, replannedMigrations, movedWithoutMigration } = history;
  const migrations = [
    ...(missingMigrations.length === 0
      ? []
      : [whichIs(missingMigrations, 'is no longer on disk', 'are no longer on disk')]),
    ...(replannedMigrations.length === 0
      ? []
      : [
          whichIs(
            replannedMigrations,
            'has since been planned again with different content',
            'have since been planned again with different content',
          ),
        ]),
  ];
  const opening = `After ${lastGraphHash}, the last graph contract it reached,`;
  if (migrations.length === 0) {
    return movedWithoutMigration
      ? `${opening} ${MOVED_BY_DB_UPDATE}`
      : `${opening} its marker was moved without a migration, for example by \`db sign\`.`;
  }
  const applied = `${opening} it applied ${migrations.join(', and ')}.`;
  return movedWithoutMigration ? `${applied} After that, ${MOVED_BY_DB_UPDATE}` : applied;
}

const CAUSE_UNKNOWN =
  'A migration it applied was planned again or deleted, or `db update` moved it to a contract no migration ends at.';

function extensionCause(spaceId: string): string {
  return `The migrations of extension space "${spaceId}" come with the extension; it was changed to a version whose migrations do not include that contract.`;
}

interface Advice {
  readonly fix: string;
  readonly nextActions: readonly NextAction[];
}

const MOVE_WITH_DB_UPDATE =
  'Unless this database changes only through migrations, as production does, move it with db update; its data stays:';

/** The `db update` arguments that name the target, or undefined when no `--to` names it. */
function reconcileArgs(
  found: MarkerOutsideGraph,
  owner: SpaceOwner & { readonly kind: 'application' },
) {
  if (found.graph.reverseChain.has(found.targetHash)) {
    return ['--to', found.targetHash];
  }
  return found.targetHash === owner.emittedContractHash ? [] : undefined;
}

function applicationAdvice(
  found: MarkerOutsideGraph,
  owner: SpaceOwner & { readonly kind: 'application' },
  history: LedgerAfterGraph | undefined,
): Advice {
  const from =
    history?.lastGraphHash ??
    (found.graph.nodes.size === 0
      ? 'the empty contract'
      : 'the nearest contract in the migration graph');
  if (found.markerHash === found.targetHash) {
    const authorOne = `The database is already at the target, but no migration ends there: author a migration from ${from} to ${found.targetHash}, commit it, and deploy again.`;
    return { fix: authorOne, nextActions: [chooseAction(authorOne)] };
  }
  const toTarget = reconcileArgs(found, owner);
  if (toTarget === undefined) {
    const migrationsOnly = `Plan a migration from ${from} to the database's current contract, then one to ${found.targetHash}, commit them, and deploy again.`;
    return { fix: migrationsOnly, nextActions: [chooseAction(migrationsOnly)] };
  }
  const dryRun = cliCommand(found.invocation, 'db update', [...toTarget, '--dry-run']);
  const reconcile = cliCommand(found.invocation, 'db update', toTarget);
  const otherwise = `Otherwise plan a migration from ${from} to its current contract, then one to ${found.targetHash}, and deploy again.`;
  return {
    fix: [MOVE_WITH_DB_UPDATE, `  ${dryRun}`, `  ${reconcile}`, otherwise].join('\n'),
    nextActions: [
      chooseAction(MOVE_WITH_DB_UPDATE),
      runCommandAction('Preview the changes', dryRun),
      runCommandAction('Reconcile the database', reconcile),
      chooseAction(otherwise),
    ],
  };
}

function extensionAdvice(found: MarkerOutsideGraph): Advice {
  const install = `Install a version of the extension whose migrations include the contract the database is at (${found.markerHash}), or ask the extension's maintainers for one.`;
  const list = cliCommand(found.invocation, 'migration list', ['--space', found.spaceId]);
  return {
    fix: [install, `List the space's migrations with \`${list}\`.`].join('\n'),
    nextActions: [
      chooseAction(install),
      runCommandAction(`List the migrations of extension space "${found.spaceId}"`, list),
    ],
  };
}

/**
 * `MIGRATION.MARKER_MISMATCH`: the database's marker names a contract no migration of the space
 * starts or ends at. It explains the cause from the ledger and gives the ways back onto the graph,
 * none of which resets the database.
 */
export function errorMarkerMismatch(found: MarkerOutsideGraph): ActionableCliError {
  const { spaceId, markerHash, targetHash, invocation, owner } = found;
  const history =
    found.ledger === undefined ? undefined : ledgerAfterGraph(found.ledger, found.graph);
  const directory = printedPath(invocation, join(found.migrationsDir, spaceId));
  const cause =
    owner.kind === 'extension'
      ? extensionCause(spaceId)
      : history === undefined
        ? CAUSE_UNKNOWN
        : historySentence(history);
  const why = `The database's marker names ${markerHash}, which no migration in ${directory} starts or ends at. ${cause}`;
  const advice =
    owner.kind === 'extension' ? extensionAdvice(found) : applicationAdvice(found, owner, history);
  return new ActionableCliError(
    'MIGRATION.MARKER_MISMATCH',
    'The database is at a contract that is not in the migration graph',
    {
      why,
      fix: advice.fix,
      nextActions: [...advice.nextActions],
      meta: {
        spaceId,
        markerHash,
        targetHash,
        ...ifDefined('lastGraphHash', history?.lastGraphHash),
        ...(found.ledger === undefined
          ? {}
          : { missingMigrations: [...(history?.missingMigrations ?? [])] }),
      },
    },
  );
}
