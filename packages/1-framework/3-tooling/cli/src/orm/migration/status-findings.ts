import type { ChangeStrategy } from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import type { StatusDiagnosticJson } from '../../commands/json/schemas';
import type { CliStructuredError } from '../../utils/cli-errors';
import { chooseAction, runCommandAction } from '../../utils/next-actions';

/**
 * One condition `migration status` found while still delivering its full
 * answer. Each is recorded twice: in the `--json` document's `diagnostics`
 * array, whose shape is the published contract, and as an engine diagnostic on
 * the completed envelope.
 *
 * All three are `warn` — the run answered the question the user asked and
 * flags something to look at. That is also what keeps exit 0 legal: the engine
 * refuses a severity-`error` diagnostic on a run that exits 0.
 */
export interface StatusFinding {
  readonly document: StatusDiagnosticJson;
  readonly diagnostic: Diagnostic;
}

const EMIT_CONTRACT = runCommandAction('Regenerate the contract', '{bin} contract emit');

export function contractUnreadableFinding(reason: string): StatusFinding {
  const message = `Could not read contract: ${reason}`;
  return {
    document: {
      code: 'CONTRACT.UNREADABLE',
      severity: 'warn',
      message,
      hints: ["Run '{bin} contract emit' to generate a valid contract"],
    },
    diagnostic: {
      code: 'CONTRACT.UNREADABLE',
      severity: 'warn',
      summary: message,
      why: 'The status tree falls back to the on-disk migration graph when the emitted contract cannot be read.',
      nextActions: [EMIT_CONTRACT],
    },
  };
}

const AUTHOR_MIGRATIONS_BACK =
  "This database's change policy permits only migrations: author migrations that bring it back onto the migration graph, commit them, and deploy again";

/**
 * The marker of `space` names no contract in the migration graph. The advice follows the database's
 * change policy `change`; when the policies cannot be read (`undefined`), it recommends no command,
 * since the policy might forbid it.
 */
export function markerNotInHistoryFinding(
  space: string,
  change: readonly ChangeStrategy[] | undefined,
): StatusFinding {
  const message = `Database was updated outside the migration system (marker for space "${space}" does not match any migration)`;
  const why = 'The marker the database carries names no contract in the on-disk migration graph.';
  if (change === undefined) {
    return {
      document: {
        code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
        severity: 'warn',
        message,
        hints: [POLICIES_FIRST],
      },
      diagnostic: {
        code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
        severity: 'warn',
        summary: message,
        why: `${why} ${POLICIES_FIRST}.`,
        meta: { space },
        nextActions: [],
      },
    };
  }
  const reconciles = change.includes('reconcile');
  const hints = reconciles
    ? [
        "Run '{bin} db sign' to overwrite the marker if the database already matches the contract",
        "Run '{bin} db update' to push the current contract to the database",
      ]
    : [AUTHOR_MIGRATIONS_BACK];
  return {
    document: { code: 'MIGRATION.MARKER_NOT_IN_HISTORY', severity: 'warn', message, hints },
    diagnostic: {
      code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
      severity: 'warn',
      summary: message,
      why,
      meta: { space, change: [...change] },
      nextActions: reconciles
        ? [
            runCommandAction(
              'Overwrite the marker if the database already matches the contract',
              '{bin} db sign',
            ),
            runCommandAction('Or push the current contract to the database', '{bin} db update'),
          ]
        : [chooseAction(AUTHOR_MIGRATIONS_BACK)],
    },
  };
}

const POLICIES_FIRST =
  "The database's change policy cannot be read, so the way back onto the graph cannot be chosen: have meta.policies corrected first";

/** The application space's marker records policies that cannot be read; `migration status` reports it and goes on. */
export function markerPoliciesUnreadableFinding(corrupt: CliStructuredError): StatusFinding {
  const message = `${corrupt.message}: ${corrupt.why ?? ''}`;
  return {
    document: {
      code: 'CONTRACT.MARKER_ROW_CORRUPT',
      severity: 'warn',
      message,
      hints: corrupt.fix === undefined ? [] : [corrupt.fix],
    },
    diagnostic: {
      code: 'CONTRACT.MARKER_ROW_CORRUPT',
      severity: 'warn',
      summary: corrupt.message,
      ...ifDefined('why', corrupt.why),
      nextActions: corrupt.nextActions ?? [],
      ...ifDefined('meta', corrupt.meta),
    },
  };
}

export function missingInvariantsFinding(inputs: {
  readonly missing: readonly string[];
  readonly refName: string | undefined;
}): StatusFinding {
  const message = `missing invariant(s): ${inputs.missing.join(', ')}`;
  return {
    document: {
      code: 'MIGRATION.MISSING_INVARIANTS',
      severity: 'warn',
      ...ifDefined('ref', inputs.refName),
      invariants: [...inputs.missing],
      message,
    },
    diagnostic: {
      code: 'MIGRATION.MISSING_INVARIANTS',
      severity: 'warn',
      summary: message,
      why:
        inputs.refName === undefined
          ? 'The database marker does not carry every invariant the target requires.'
          : `The database marker does not carry every invariant \`${inputs.refName}\` requires.`,
      nextActions: [runCommandAction('Apply the migrations that provide them', '{bin} db migrate')],
      meta: { invariants: [...inputs.missing], ...ifDefined('ref', inputs.refName) },
    },
  };
}
