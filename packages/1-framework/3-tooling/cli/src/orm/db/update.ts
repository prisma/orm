import { ifDefined } from '@internal/utils/defined';
import { isStructuredError } from '@internal/utils/structured-error';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import {
  CliStructuredError as EngineStructuredError,
  notOk,
  ok,
} from '@prisma/cli-engine/protocol';
import { createControlClient } from '../../control-api/client';
import { resolveContractRefToSnapshot } from '../../control-api/operations/contract-snapshot-resolution';
import { resolveRefAdvancementFields } from '../../control-api/operations/ref-advancement';
import type { CreateControlClient, DbUpdateResult, DbUpdateSuccess } from '../../control-api/types';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorUnexpected,
} from '../../utils/cli-errors';
import { closeQuietly, sanitizeErrorMessage } from '../../utils/command-helpers';
import { mapDbUpdateFailure } from '../../utils/db-update-failure';
import type { MigrationCommandResult } from '../../utils/formatters/migrations';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { normalizeError } from '../normalize-error';
import { controlProgressReporter } from '../progress';
import {
  destructiveConsentQuestion,
  errorConsentOperationsMissing,
  errorConsentTokenUnresolved,
} from './consent';
import { migrationResultBlocks, migrationResultNextActions } from './migration-blocks';
import { prepareMigrationRun } from './prepare';

function updatePresentations(inputs: {
  readonly document: MigrationCommandResult;
  readonly contractPath: string;
  readonly database: string | undefined;
  readonly to: string | undefined;
  readonly dryRun: boolean;
}): Presentations {
  const { document, database, dryRun } = inputs;
  return {
    stdout: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: inputs.contractPath },
          ...(database === undefined ? [] : [{ label: 'database', value: database }]),
          ...(inputs.to === undefined ? [] : [{ label: 'to', value: inputs.to }]),
          ...(dryRun ? [{ label: 'mode', value: 'dry run' }] : []),
        ],
      },
      ...migrationResultBlocks(document),
    ],
    json: () => document,
    next: () => migrationResultNextActions(document, '{bin} db update'),
  };
}

function updateDocument(inputs: {
  readonly value: DbUpdateSuccess;
  readonly targetId: string;
  readonly advancedRef: { readonly name: string; readonly hash: string } | null;
  readonly plannedAdvanceRef: { readonly name: string; readonly hash: string } | null;
  readonly startedAt: number;
}): MigrationCommandResult {
  const { value } = inputs;
  return {
    ok: true,
    mode: value.mode,
    plan: {
      targetId: inputs.targetId,
      destination: {
        storageHash: value.destination.storageHash,
        ...ifDefined('profileHash', value.destination.profileHash),
      },
      operations: value.plan.operations.map((operation) => ({
        id: operation.id,
        label: operation.label,
        operationClass: operation.operationClass,
      })),
      ...ifDefined('preview', value.plan.preview),
    },
    ...(value.execution === undefined
      ? {}
      : {
          execution: {
            operationsPlanned: value.execution.operationsPlanned,
            operationsExecuted: value.execution.operationsExecuted,
          },
        }),
    ...(value.marker === undefined
      ? {}
      : {
          marker: {
            storageHash: value.marker.storageHash,
            ...ifDefined('profileHash', value.marker.profileHash),
          },
        }),
    ...ifDefined('perSpace', value.perSpace),
    ...ifDefined('warnings', value.warnings),
    advancedRef: inputs.advancedRef,
    plannedAdvanceRef: inputs.plannedAdvanceRef,
    summary: value.summary,
    timings: { total: Date.now() - inputs.startedAt },
  };
}

export function createDbUpdateCommand(createClient: CreateControlClient) {
  return defineOrmCommand({
    help: {
      summary: 'Update your database schema to match your contract',
      description:
        'Compares the database to the emitted contract and applies the changes that\n' +
        'close the gap, whether or not the database was bootstrapped with `db init`.\n' +
        'An operation that would destroy data is applied only with your consent: the\n' +
        'command asks you to type the database name. A run with nobody to ask — a CI\n' +
        'job, or `--no-interactive` — takes it from `--confirm <database>` instead.\n' +
        'Use --dry-run to see the operations without applying them.',
      examples: [
        'db update',
        'db update --dry-run',
        'db update --no-interactive --confirm appdb',
        'db update --to production',
      ],
    },
    args: {
      flags: {
        db: dbFlag,
        dryRun: flag.boolean({ brief: 'Preview the planned operations without applying them' }),
        to: flag.string({
          brief: 'Contract to update to (hash, prefix, ref name, migration dir name, or ./path)',
          placeholder: 'contract',
        }),
        advanceRef: flag.string({
          brief: 'Advance the named ref to the post-command contract hash',
          placeholder: 'name',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const startedAt = Date.now();
      const prepared = await prepareMigrationRun({
        config: ctx.config,
        cwd: ctx.cwd,
        db: args.flags.db,
        commandName: 'db update',
        createClient,
      });
      if (!prepared.ok) {
        return notOk(prepared.failure);
      }
      const { client, contractPath, dbConnection, migrationsDir, refsDir } = prepared.value;

      let contractJson = prepared.value.contractJson;
      let snapshotContractPath = contractPath;
      if (args.flags.to !== undefined) {
        const resolved = await resolveContractRefToSnapshot({
          config: ctx.config,
          migrationsDir,
          refInput: args.flags.to,
          contractPathAbsolute: contractPath,
          fallbackToEmitted: false,
          missingBundleFlag: '--to',
        });
        if (!resolved.ok) {
          return notOk(normalizeError(resolved.failure));
        }
        contractJson = resolved.value.contractJson;
        snapshotContractPath = resolved.value.contractJsonPath;
      }

      const mode = args.flags.dryRun ? 'plan' : 'apply';
      let document: MigrationCommandResult;
      try {
        await client.connect(dbConnection);

        const update = (consent?: { readonly planHash: string }): Promise<DbUpdateResult> =>
          client.dbUpdate({
            contract: contractJson,
            mode,
            migrationsDir,
            ...(consent === undefined ? {} : { consent }),
            onProgress: controlProgressReporter(ctx.report),
          });

        // A successful run shows the planner's warnings in its blocks. A refused
        // or failed one has no result to carry them, and an errored envelope
        // renders no meta, so they are reported as events to reach both channels.
        // The refusal's warnings matter most of all: they are what the user is
        // told just before consenting.
        const reported = new Set<string>();
        const reportPlannerWarnings = (warnings: readonly { readonly summary: string }[]): void => {
          for (const warning of warnings) {
            if (!reported.has(warning.summary)) {
              reported.add(warning.summary);
              ctx.report({ kind: 'message', severity: 'warn', text: warning.summary });
            }
          }
        };

        let result = await update();
        // The destructive verdict is the planner's, so it arrives only after the
        // connection is open. Consent is asked for on that same connection and
        // the apply is re-run carrying the refused plan's hash — the control API
        // refuses if the plan it is about to apply is no longer that plan. Only
        // an apply can ask: a dry run has nothing to authorise.
        if (mode === 'apply' && !result.ok && result.failure.code === 'DESTRUCTIVE_CHANGES') {
          reportPlannerWarnings(result.failure.warnings ?? []);
          const refusal = result.failure.destructiveChanges;
          if (refusal === undefined || refusal.destructiveOperations.length === 0) {
            return notOk(normalizeError(errorConsentOperationsMissing()));
          }
          const token = refusal.databaseName ?? '';
          if (token.trim().length === 0) {
            return notOk(normalizeError(errorConsentTokenUnresolved(ctx.config.target.targetId)));
          }
          const granted = await ctx.prompt.consent(
            destructiveConsentQuestion(refusal.destructiveOperations, token),
            { token },
          );
          if (!granted) {
            return notOk(normalizeError(mapDbUpdateFailure(result.failure)));
          }
          result = await update({ planHash: refusal.planHash });
        }
        if (!result.ok) {
          reportPlannerWarnings(result.failure.warnings ?? []);
          return notOk(normalizeError(mapDbUpdateFailure(result.failure)));
        }

        const advancementHash =
          result.value.mode === 'apply'
            ? (result.value.marker?.storageHash ?? result.value.destination.storageHash)
            : result.value.destination.storageHash;
        const advancement = await resolveRefAdvancementFields({
          ...ifDefined('advanceRef', args.flags.advanceRef),
          ...ifDefined('db', args.flags.db),
          refsDir,
          migrationsDir,
          contractJson,
          contractJsonPath: snapshotContractPath,
          mode: result.value.mode,
          hash: advancementHash,
        });
        if (!advancement.ok) {
          return notOk(normalizeError(advancement.failure));
        }

        document = updateDocument({
          value: result.value,
          targetId: ctx.config.target.targetId,
          advancedRef: advancement.value.advancedRef,
          plannedAdvanceRef: advancement.value.plannedAdvanceRef,
          startedAt,
        });
      } catch (error) {
        // A refused, mistyped or cancelled consent is the engine's own error, and
        // the engine settles it: cancellation exits 3, everything else 2. Catching
        // it here would restate it as this command's failure and lose that.
        if (error instanceof EngineStructuredError) {
          throw error;
        }
        if (CliStructuredError.is(error)) {
          return notOk(normalizeError(error));
        }
        if (isStructuredError(error) && error.code === 'CONTRACT.VALIDATION_FAILED') {
          return notOk(
            normalizeError(
              errorContractValidationFailed(`Contract validation failed: ${error.message}`, {
                where: { path: contractPath },
              }),
            ),
          );
        }
        const safeMessage = sanitizeErrorMessage(
          error instanceof Error ? error.message : String(error),
          typeof dbConnection === 'string' ? dbConnection : undefined,
        );
        return notOk(
          normalizeError(
            errorUnexpected(safeMessage, {
              why: `Unexpected error during db update: ${safeMessage}`,
            }),
          ),
        );
      } finally {
        await closeQuietly(client);
      }

      ctx.report({
        kind: 'message',
        severity: 'verbose',
        text: `Total time: ${document.timings.total}ms`,
      });

      return ok(
        ctx.present(
          { data: document },
          updatePresentations({
            document,
            contractPath: prepared.value.contractDisplayPath,
            database: prepared.value.database,
            to: args.flags.to,
            dryRun: args.flags.dryRun,
          }),
        ),
      );
    },
  });
}

export const dbUpdateCommand = createDbUpdateCommand(createControlClient);
