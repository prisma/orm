import { ormConfigSection } from '@internal/config-loader';
import { migrationSubjectJson } from '@internal/framework-components/control';
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
import { errorFromCaught } from '../../control-api/operations/caught-errors';
import {
  type ResolveContractRefToSnapshotSuccess,
  resolveContractRefToSnapshot,
} from '../../control-api/operations/contract-snapshot-resolution';
import {
  buildRefAdvancementFields,
  type ContractIR,
  computeRefAdvancementName,
  NO_REF_ADVANCEMENT,
  preflightRefAdvancement,
} from '../../control-api/operations/ref-advancement';
import { retryCommandFor } from '../../control-api/operations/ref-resolution';
import { shellQuoted, statementFlag } from '../../control-api/statements/statement-flag';
import type { StatementText } from '../../control-api/statements/statement-text';
import type { AskedSubject, CreateControlClient, DbUpdateSuccess } from '../../control-api/types';
import { CliStructuredError, errorContractValidationFailed } from '../../utils/cli-errors';
import { closeQuietly } from '../../utils/command-helpers';
import { RECORDED_CONTRACT_REF_FORMS } from '../../utils/contract-ref-forms';
import { mapDbUpdateFailure } from '../../utils/db-update-failure';
import type { MigrationCommandResult } from '../../utils/formatters/migrations';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { baseDirFor, migrationsDirFor } from '../migration/paths';
import { normalizeError } from '../normalize-error';
import { promptPlanQuestions } from '../plan-question-prompt';
import { controlProgressReporter } from '../progress';
import { ormStatementVerbs } from '../statement-verbs';
import { migrationResultBlocks, migrationResultNextActions } from './migration-blocks';
import { prepareMigrationRun } from './prepare';

function updatePresentations(inputs: {
  readonly document: MigrationCommandResult;
  readonly contractPath: string;
  readonly database: string | undefined;
  readonly to: string | undefined;
  readonly dryRun: boolean;
  /** Whether the run named its database with `--db`, which the suggested apply repeats as a placeholder. */
  readonly dbGiven: boolean;
  readonly advanceRef: string | undefined;
  readonly statements: readonly StatementText[];
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
    next: () =>
      migrationResultNextActions(
        document,
        [
          '{bin} db update',
          ...(inputs.to === undefined ? [] : [`--to ${shellQuoted(inputs.to)}`]),
          ...(inputs.dbGiven ? ['--db <url>'] : []),
          ...(inputs.advanceRef === undefined
            ? []
            : [`--advance-ref ${shellQuoted(inputs.advanceRef)}`]),
          ...inputs.statements.map(statementFlag),
        ].join(' '),
      ),
  };
}

/**
 * The entries a dry run lists, each marked answered when a flag it was given answers its question:
 * a `--delete` answers every loss of its subject, and an `--allow` one operation, in order.
 */
function subjectEntriesJson(
  entries: readonly AskedSubject[],
  verb: 'delete' | 'allow',
  given: readonly StatementText[],
) {
  const flagsLeft = new Map<string, number>();
  for (const statement of given) {
    if (statement.verb === verb) {
      flagsLeft.set(statement.text, (flagsLeft.get(statement.text) ?? 0) + 1);
    }
  }
  return entries.map((entry) => {
    const left = flagsLeft.get(entry.text) ?? 0;
    if (left > 0 && verb === 'allow') flagsLeft.set(entry.text, left - 1);
    return {
      operationIndex: entry.operationIndex,
      subject: migrationSubjectJson(entry.subject),
      text: entry.text,
      answered: left > 0,
    };
  });
}

function updateDocument(inputs: {
  readonly value: DbUpdateSuccess;
  readonly targetId: string;
  readonly advancedRef: { readonly name: string; readonly hash: string } | null;
  readonly plannedAdvanceRef: { readonly name: string; readonly hash: string } | null;
  readonly startedAt: number;
  /** The statements the run was given, which a dry run's questions are marked answered by. */
  readonly statements: readonly StatementText[];
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
    appliedStatements: value.appliedStatements,
    ...(value.mode === 'plan'
      ? {
          dataLoss: subjectEntriesJson(value.dataLoss, 'delete', inputs.statements),
          accessWidening: subjectEntriesJson(value.accessWidening, 'allow', inputs.statements),
        }
      : {}),
    ...ifDefined('warnings', value.warnings),
    advancedRef: inputs.advancedRef,
    plannedAdvanceRef: inputs.plannedAdvanceRef,
    summary: value.summary,
    timings: { total: Date.now() - inputs.startedAt },
  };
}

/** The delete and allow values the engine still holds for the questions, read without taking them. */
function unansweredConsents(statements: {
  readonly values: () => readonly { readonly verb: string; readonly text: string }[];
}): readonly StatementText[] {
  return statements
    .values()
    .flatMap(({ verb, text }) => (verb === 'delete' || verb === 'allow' ? [{ verb, text }] : []));
}

export function createDbUpdateCommand(createClient: CreateControlClient) {
  return defineOrmCommand({
    help: {
      summary: 'Update your database schema to match your contract',
      description:
        'Compares the database to the emitted contract and applies the changes that\n' +
        'close the gap, whether or not the database was bootstrapped with `db init`.\n' +
        'Before it applies an operation that would lose data, it asks what the\n' +
        'operation means: --rename keeps the data under a new name, --delete lets it\n' +
        'go. Before it widens who can read or write rows, it asks for --allow. Where\n' +
        'nobody can answer, it refuses and lists every question. Use --dry-run to see\n' +
        'the operations and the questions without applying anything.',
      examples: [
        'db update',
        'db update --dry-run',
        'db update --delete Legacy',
        'db update --rename Profile:User --allow User',
        'db update --to production',
      ],
    },
    args: {
      flags: {
        db: dbFlag,
        dryRun: flag.boolean({ brief: 'Preview the planned operations without applying them' }),
        to: flag.string({
          brief: `Contract to update to (${RECORDED_CONTRACT_REF_FORMS})`,
          placeholder: 'contract',
        }),
        advanceRef: flag.string({
          brief: 'Advance the named ref to the post-command contract hash',
          placeholder: 'name',
        }),
      },
    },
    statements: ormStatementVerbs,
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const startedAt = Date.now();
      const renames = ctx.statements
        .take('rename')
        .map(({ text }) => ({ verb: 'rename' as const, text }));
      // A dry run asks nothing, so it takes the delete and allow values and the control API
      // checks each against the subjects an apply would ask about.
      const previewConsents = args.flags.dryRun
        ? [
            ...ctx.statements.take('delete').map(({ text }) => ({ verb: 'delete' as const, text })),
            ...ctx.statements.take('allow').map(({ text }) => ({ verb: 'allow' as const, text })),
          ]
        : [];
      let destination: ResolveContractRefToSnapshotSuccess | undefined;
      if (args.flags.to !== undefined) {
        const resolved = await resolveContractRefToSnapshot({
          config: ctx.config,
          migrationsDir: migrationsDirFor(ctx.config),
          refInput: args.flags.to,
          argument: '--to',
          fallbackToEmitted: false,
        });
        if (!resolved.ok) {
          return notOk(normalizeError(resolved.failure));
        }
        destination = resolved.value;
      }

      const prepared = await prepareMigrationRun({
        config: ctx.config,
        cwd: ctx.cwd,
        db: args.flags.db,
        commandName: 'db update',
        createClient,
        retryCommand: () =>
          retryCommandFor({
            commandName: args.flags.dryRun ? 'db update --dry-run' : 'db update',
            to: args.flags.to,
            advanceRef: args.flags.advanceRef,
            statements: [...renames, ...previewConsents, ...unansweredConsents(ctx.statements)],
            canRunOffline: false,
          }),
      });
      if (!prepared.ok) {
        return notOk(prepared.failure);
      }
      const { client, contractPath, dbConnection, migrationsDir, refsDir } = prepared.value;
      const contractJson = destination?.contractJson ?? prepared.value.contractJson;
      const snapshotContractPath = destination?.contractJsonPath ?? contractPath;

      const refName = computeRefAdvancementName({
        ...ifDefined('advanceRef', args.flags.advanceRef),
        ...ifDefined('db', args.flags.db),
      });
      let advancement: { readonly name: string; readonly contractIR: ContractIR } | null = null;
      if (refName !== null) {
        const preflight = await preflightRefAdvancement({
          name: refName,
          contractJson,
          contractJsonPath: snapshotContractPath,
          projectDir: baseDirFor(ctx.config),
          client,
        });
        if (!preflight.ok) {
          return notOk(normalizeError(preflight.failure));
        }
        advancement = { name: refName, contractIR: preflight.value };
      }

      const mode = args.flags.dryRun ? 'plan' : 'apply';
      let document: MigrationCommandResult;
      try {
        await client.connect(dbConnection);

        // A refused or failed run has no result to carry the planner's warnings,
        // and an errored envelope renders no meta, so they are reported as events
        // to reach both channels.
        const reportPlannerWarnings = (warnings: readonly { readonly summary: string }[]): void => {
          for (const warning of warnings) {
            ctx.report({ kind: 'message', severity: 'warn', text: warning.summary });
          }
        };

        const result = await client.dbUpdate({
          contract: contractJson,
          mode,
          migrationsDir,
          statements: [...renames, ...previewConsents],
          answerQuestions: promptPlanQuestions(ctx.prompt),
          onProgress: controlProgressReporter(ctx.report),
        });
        if (!result.ok) {
          reportPlannerWarnings(result.failure.warnings ?? []);
          return notOk(normalizeError(mapDbUpdateFailure(result.failure)));
        }

        const advancementHash =
          result.value.mode === 'apply'
            ? (result.value.marker?.storageHash ?? result.value.destination.storageHash)
            : result.value.destination.storageHash;
        const advanced =
          advancement === null
            ? ok(NO_REF_ADVANCEMENT)
            : await buildRefAdvancementFields({
                name: advancement.name,
                refsDir,
                migrationsDir,
                contractIR: advancement.contractIR,
                mode: result.value.mode,
                hash: advancementHash,
              });
        if (!advanced.ok) {
          return notOk(normalizeError(advanced.failure));
        }

        document = updateDocument({
          value: result.value,
          targetId: ctx.config.target.targetId,
          advancedRef: advanced.value.advancedRef,
          plannedAdvanceRef: advanced.value.plannedAdvanceRef,
          startedAt,
          statements: previewConsents,
        });
      } catch (error) {
        // A refused, mistyped or cancelled answer is the engine's own error, and
        // the engine settles it: cancellation exits 3, everything else 2. Catching
        // it here would restate it as this command's failure and lose that.
        if (error instanceof EngineStructuredError) {
          throw error;
        }
        if (
          !CliStructuredError.is(error) &&
          isStructuredError(error) &&
          error.code === 'CONTRACT.VALIDATION_FAILED'
        ) {
          return notOk(
            normalizeError(
              errorContractValidationFailed(`Contract validation failed: ${error.message}`, {
                where: { path: contractPath },
              }),
            ),
          );
        }
        return notOk(
          normalizeError(
            errorFromCaught(error, (message) => `Unexpected error during db update: ${message}`, {
              connection: typeof dbConnection === 'string' ? dbConnection : undefined,
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
            dbGiven: args.flags.db !== undefined,
            advanceRef: args.flags.advanceRef,
            statements: [...renames, ...previewConsents],
          }),
        ),
      );
    },
  });
}

export const dbUpdateCommand = createDbUpdateCommand(createControlClient);
