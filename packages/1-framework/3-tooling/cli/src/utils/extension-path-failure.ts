import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import {
  errorNoInvariantPath,
  type MigrationToolsError,
  type NoInvariantPathStructuralEdge,
} from '@internal/migration-tools/errors';
import {
  type ActionableCliError,
  errorPathUnreachable,
  type PathUnreachableAdvice,
} from './cli-errors';
import { chooseAction, runCommandAction } from './next-actions';
import { type CliInvocation, cliCommand } from './printed-command';

/** An extension space `db init` or `db update` could not plan, and the command that tried. */
export interface UnplannableExtensionSpace {
  readonly spaceId: string;
  /** The contract the space's marker names, or the empty contract's hash when it has none. */
  readonly fromHash: string;
  readonly targetHash: string;
  readonly command: 'db init' | 'db update';
  readonly invocation: CliInvocation;
}

function startText(fromHash: string): string {
  return fromHash === EMPTY_CONTRACT_HASH
    ? 'the empty contract (the space has no marker)'
    : `the contract its marker names ("${fromHash}")`;
}

const INSTALL_MATCHING =
  'Install a version of the extension whose migrations start from the contract the database is at';

/** The way out for an extension space: only another version of the extension changes its migrations. */
function extensionAdvice(space: UnplannableExtensionSpace): PathUnreachableAdvice {
  const rerun = cliCommand(space.invocation, space.command);
  const list = cliCommand(space.invocation, 'migration list', ['--space', space.spaceId]);
  return {
    fix: `The migrations of extension space "${space.spaceId}" come with the extension. ${INSTALL_MATCHING}, then run \`${rerun}\` again. List the space's migrations with \`${list}\`.`,
    nextActions: [
      chooseAction(INSTALL_MATCHING),
      runCommandAction(`List the migrations of extension space "${space.spaceId}"`, list),
      runCommandAction(`Run ${space.command} again`, rerun),
    ],
  };
}

/** `MIGRATION.PATH_UNREACHABLE` for an extension space whose migrations do not lead from where the database is to the extension's head. */
export function errorExtensionPathUnreachable(
  space: UnplannableExtensionSpace,
): ActionableCliError {
  return errorPathUnreachable(
    {
      summary: `Cannot resolve apply path for extension space "${space.spaceId}"`,
      why: `No path in the on-disk migration graph for extension space "${space.spaceId}" leads from ${startText(space.fromHash)} to the on-disk head ref hash "${space.targetHash}".`,
      meta: {
        kind: 'pathUnreachable',
        spaceId: space.spaceId,
        fromHash: space.fromHash,
        targetHash: space.targetHash,
      },
    },
    extensionAdvice(space),
  );
}

/**
 * `MIGRATION.NO_INVARIANT_PATH` for an extension space whose migrations reach the extension's head
 * from where the database is, but not through the ones that provide the invariants its head requires.
 */
export function errorExtensionNoInvariantPath(
  space: UnplannableExtensionSpace & {
    readonly required: readonly string[];
    readonly missing: readonly string[];
    readonly structuralPath: readonly NoInvariantPathStructuralEdge[];
  },
): MigrationToolsError {
  const missing = space.missing.map((id) => JSON.stringify(id)).join(', ');
  return errorNoInvariantPath({
    required: space.required,
    missing: space.missing,
    structuralPath: space.structuralPath,
    extensionSpace: {
      spaceId: space.spaceId,
      why: `The head of extension space "${space.spaceId}" requires invariants that no path of its migrations from ${startText(space.fromHash)} provides: ${missing}.`,
      ...extensionAdvice(space),
    },
  });
}
