import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { isStructuredErrorCode } from '@internal/utils/structured-error';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag, positional } from '@prisma/cli-engine';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import type { CheckFailure, MigrationCheckResult } from '../../commands/json/schemas';
import { PRECONDITION } from '../../commands/migration-check/exit-codes';
import { buildReadAggregate } from '../../control-api/operations/contract-space-aggregate-loader';
import {
  checkSingleTarget,
  enumerateCheckSpaces,
  loadAggregateIntegrityViolations,
  runMigrationCheck,
} from '../../control-api/operations/migration-check';
import { errorMigrationPackageNotFound } from '../../utils/cli-errors';
import { integrityViolationToCheckFailure } from '../../utils/integrity-violation-to-check-failure';
import { snapshotVerifierFor } from '../../utils/snapshot-content-verification';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';
import { appMigrationsDirFor, displayPath, migrationsDirFor } from './paths';

/**
 * The check completed and the artifacts it read are not internally consistent.
 * The findings ride the envelope as diagnostics; the run itself did its job,
 * which is why this is not an errored settlement.
 */
const FINDINGS_EXIT_CODE = 4;

/**
 * One integrity failure as an envelope diagnostic. `error` is the honest
 * severity: nothing about the artifacts is merely worth a look, and exit 4
 * makes it legal — the engine refuses a severity-`error` diagnostic only on a
 * run that exits 0.
 *
 * The summary leads with the path because the engine's diagnostic renderer
 * prints `code`, `summary`, `why` and the next actions and never prints
 * `where`. Several failure texts name no package on their own — a hash
 * mismatch reads "Stored hash X does not match recomputed hash Y" — so
 * without the path a project with fifty migrations cannot be told which one
 * is broken. `where` still carries the path on its own for a `--json`
 * consumer.
 */
function failureDiagnostic(failure: CheckFailure): Diagnostic {
  if (!isStructuredErrorCode(failure.code)) {
    throw new InternalError(
      `migration check produced the failure code "${failure.code}", which is not a dotted NAMESPACE.SUBCODE.`,
    );
  }
  return {
    code: failure.code,
    severity: 'error',
    summary: `${failure.where}: ${failure.why}`,
    nextActions: failure.nextActions,
    where: { path: failure.where },
    meta: { space: failure.space },
  };
}

function checkPresentations(inputs: {
  readonly document: MigrationCheckResult;
  readonly migrationsRelative: string;
  readonly target: string | undefined;
  readonly space: string | undefined;
  readonly resolvedSpaceId: string | undefined;
}): Presentations {
  const summary =
    inputs.resolvedSpaceId === undefined
      ? inputs.document.summary
      : `${inputs.document.summary}  (space: ${inputs.resolvedSpaceId})`;
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'migrations', value: inputs.migrationsRelative },
          ...(inputs.target === undefined ? [] : [{ label: 'target', value: inputs.target }]),
          ...(inputs.space === undefined ? [] : [{ label: 'space', value: inputs.space }]),
        ],
      },
      { kind: 'summary', status: inputs.document.ok ? 'ok' : 'error', text: summary },
    ],
    json: () => inputs.document,
  };
}

export const migrationCheckCommand = defineOrmCommand({
  help: {
    summary: 'Verify artifact and graph integrity',
    description:
      'Validates that on-disk migration packages are internally consistent\n' +
      '(hashes match, manifests are complete) and that the graph is well-formed\n' +
      '(edges connect, refs point at valid nodes). The whole-graph check spans\n' +
      'every contract space by default; pass --space <id> to narrow to one. A\n' +
      'migration reference checks a single package, resolved across all contract\n' +
      'spaces (narrow with --space; an ambiguous reference cannot be checked).\n' +
      'Offline — does not consult the database.\n' +
      'Exit codes: 0 = all checks passed, 2 = precondition failed (unresolved\n' +
      'target or unknown --space), 4 = integrity failure(s) found.',
    examples: [
      'migration check',
      'migration check --space app',
      'migration check 20260101-add-users',
      'migration check 20260101-add-users --space app',
      'migration check --json',
    ],
  },
  args: {
    positionals: {
      target: positional.optionalString({
        brief: 'Migration reference: directory name, hash/prefix, ref, or path',
        placeholder: 'target',
      }),
    },
    flags: {
      space: flag.string({ brief: 'Narrow output to a single contract space', placeholder: 'id' }),
    },
  },
  needs: { config: ormConfigSection },
  exitCodes: { 4: 'integrity check found failures' },
  handler: async (args, ctx) => {
    const { target } = args.positionals;
    const spaceFilter = args.flags.space;
    const migrationsDir = migrationsDirFor(ctx.config, ctx.cwd);
    const appMigrationsDir = appMigrationsDirFor(ctx.config, ctx.cwd);
    const appMigrationsRelative = displayPath(appMigrationsDir, ctx.cwd);

    const verifySnapshotContent = snapshotVerifierFor(ctx.config);
    const loaded = await buildReadAggregate(ctx.config, {
      migrationsDir,
      ...ifDefined('verifySnapshotContent', verifySnapshotContent),
    });
    if (!loaded.ok) {
      return notOk(normalizeError(loaded.failure));
    }
    const spaces = await enumerateCheckSpaces(
      loaded.value.aggregate,
      migrationsDir,
      ctx.cwd,
      verifySnapshotContent,
    );

    let document: MigrationCheckResult;
    let resolvedSpaceId: string | undefined;

    if (target !== undefined) {
      const outcome = await checkSingleTarget(target, {
        spaces,
        ...ifDefined('spaceFilter', spaceFilter),
        appMigrationsDir,
        appMigrationsRelative,
        cwd: ctx.cwd,
      });
      if (outcome.error !== undefined) {
        return notOk(normalizeError(outcome.error));
      }
      const result = outcome.result;
      if (result === undefined || outcome.exitCode === PRECONDITION) {
        // The target named nothing on disk. That is a failure to run the
        // check, not a finding, so it settles errored rather than as a result
        // whose failure list is empty.
        return notOk(
          normalizeError(
            errorMigrationPackageNotFound(
              result?.summary ?? `Migration package for "${target}" not found on disk`,
            ),
          ),
        );
      }
      document = result;
      resolvedSpaceId = outcome.resolvedSpaceId;
    } else {
      const checked = await runMigrationCheck({ spaces, ...ifDefined('spaceFilter', spaceFilter) });
      if (!checked.ok) {
        return notOk(normalizeError(checked.failure));
      }
      const violations = await loadAggregateIntegrityViolations(
        ctx.config,
        migrationsDir,
        verifySnapshotContent,
      );
      const scoped =
        spaceFilter === undefined
          ? violations
          : violations.filter(
              (violation) => violation.kind !== 'disjointness' && violation.spaceId === spaceFilter,
            );
      const failures: readonly CheckFailure[] = [
        ...checked.value.failures,
        ...scoped.map((violation) => integrityViolationToCheckFailure(violation, migrationsDir)),
      ];
      document =
        failures.length === 0
          ? { ok: true, failures: [], summary: 'All checks passed' }
          : {
              ok: false,
              failures: [...failures],
              summary: `${failures.length} integrity failure(s)`,
            };
    }

    const diagnostics = document.failures.map(failureDiagnostic);

    return ok(
      ctx.present(
        {
          data: document,
          exitCode: diagnostics.length === 0 ? 0 : FINDINGS_EXIT_CODE,
          diagnostics,
        },
        checkPresentations({
          document,
          migrationsRelative: appMigrationsRelative,
          target,
          space: spaceFilter,
          resolvedSpaceId,
        }),
      ),
    );
  },
});
