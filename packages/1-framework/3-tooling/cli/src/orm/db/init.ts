import { ifDefined } from '@internal/utils/defined';
import { isStructuredError } from '@internal/utils/structured-error';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { createControlClient } from '../../control-api/client';
import { resolveRefAdvancementFields } from '../../control-api/operations/ref-advancement';
import type { CreateControlClient, DbInitSuccess } from '../../control-api/types';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorUnexpected,
} from '../../utils/cli-errors';
import { closeQuietly, sanitizeErrorMessage } from '../../utils/command-helpers';
import { mapDbInitFailure } from '../../utils/db-init-failure';
import type { MigrationCommandResult } from '../../utils/formatters/migrations';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { normalizeError } from '../normalize-error';
import { controlProgressReporter } from '../progress';
import { migrationResultBlocks, migrationResultNextActions } from './migration-blocks';
import { prepareMigrationRun } from './prepare';

function initPresentations(inputs: {
  readonly document: MigrationCommandResult;
  readonly contractPath: string;
  readonly database: string | undefined;
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
          ...(dryRun ? [{ label: 'mode', value: 'dry run' }] : []),
        ],
      },
      ...migrationResultBlocks(document),
    ],
    json: () => document,
    next: () => migrationResultNextActions(document, '{bin} db init'),
  };
}

function initDocument(inputs: {
  readonly value: DbInitSuccess;
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
    advancedRef: inputs.advancedRef,
    plannedAdvanceRef: inputs.plannedAdvanceRef,
    summary: value.summary,
    timings: { total: Date.now() - inputs.startedAt },
  };
}

export function createDbInitCommand(createClient: CreateControlClient) {
  return defineOrmCommand({
    help: {
      summary: 'Bootstrap a database to match the current contract and sign it',
      description:
        'Creates everything the emitted contract declares and the database does not\n' +
        'have yet, using additive operations only. Structures already in place and\n' +
        'compatible are left alone, a conflict that would need a destructive change\n' +
        'stops the run, and the database is signed with the contract it now matches.\n' +
        'Use --dry-run to see the operations without applying them.',
      examples: [
        'db init',
        'db init --db $DATABASE_URL',
        'db init --dry-run',
        'db init --advance-ref production',
      ],
    },
    args: {
      flags: {
        db: dbFlag,
        dryRun: flag.boolean({ brief: 'Preview the planned operations without applying them' }),
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
        commandName: 'db init',
        createClient,
      });
      if (!prepared.ok) {
        return notOk(prepared.failure);
      }
      const { client, contractJson, contractPath, dbConnection, migrationsDir, refsDir } =
        prepared.value;

      let document: MigrationCommandResult;
      try {
        await client.connect(dbConnection);

        const result = await client.dbInit({
          contract: contractJson,
          mode: args.flags.dryRun ? 'plan' : 'apply',
          migrationsDir,
          onProgress: controlProgressReporter(ctx.report),
        });
        if (!result.ok) {
          return notOk(normalizeError(mapDbInitFailure(result.failure)));
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
          contractJsonPath: contractPath,
          mode: result.value.mode,
          hash: advancementHash,
        });
        if (!advancement.ok) {
          return notOk(normalizeError(advancement.failure));
        }

        document = initDocument({
          value: result.value,
          targetId: ctx.config.target.targetId,
          advancedRef: advancement.value.advancedRef,
          plannedAdvanceRef: advancement.value.plannedAdvanceRef,
          startedAt,
        });
      } catch (error) {
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
              why: `Unexpected error during db init: ${safeMessage}`,
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
          initPresentations({
            document,
            contractPath: prepared.value.contractDisplayPath,
            database: prepared.value.database,
            dryRun: args.flags.dryRun,
          }),
        ),
      );
    },
  });
}

export const dbInitCommand = createDbInitCommand(createControlClient);
