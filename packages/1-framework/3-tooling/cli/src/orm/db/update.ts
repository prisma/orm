import { ormConfigSection } from '@internal/config-loader';
import {
  APP_SPACE_ID,
  type MigrationPlannerConflict,
  migrationSubjectJson,
} from '@internal/framework-components/control';
import { readMigrationsDir } from '@internal/migration-tools/io';
import { ifDefined } from '@internal/utils/defined';
import { isStructuredError } from '@internal/utils/structured-error';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag, noDataLines } from '@prisma/cli-engine';
import {
  CliStructuredError as EngineStructuredError,
  notOk,
  ok,
} from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
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
import { matchConsents } from '../../control-api/statements/plan-questions';
import { renamedAndDeleted } from '../../control-api/statements/resolve-statements';
import { shellQuoted, statementFlag } from '../../control-api/statements/statement-flag';
import { isStatementVerb, type StatementText } from '../../control-api/statements/statement-text';
import type {
  AskedDataLoss,
  AskedSubject,
  CreateControlClient,
  DbUpdateSuccess,
} from '../../control-api/types';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorStatementNeedsMigrationFile,
} from '../../utils/cli-errors';
import { closeQuietly } from '../../utils/command-helpers';
import { RECORDED_CONTRACT_REF_FORMS } from '../../utils/contract-ref-forms';
import { contractValidationMeta } from '../../utils/contract-validation-meta';
import type {
  MigrationCommandResult,
  RemovedNamespaceJson,
} from '../../utils/formatters/migrations';
import { type CliInvocation, cliCommand, cliInvocation } from '../../utils/printed-command';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { baseDirFor, migrationsDirFor } from '../migration/paths';
import { normalizeError } from '../normalize-error';
import { promptPlanQuestions } from '../plan-question-prompt';
import { controlProgressReporter } from '../progress';
import { dbUpdateStatementVerbs } from '../statement-verbs';
import { migrationResultBlocks, migrationResultNextActions } from './migration-blocks';
import { plannerWarningsCollector } from './planner-warnings';
import { prepareMigrationRun } from './prepare';

function updatePresentations(inputs: {
  readonly document: MigrationCommandResult;
  /** Where the CLI ran and the `--config` and `--db` it was given, which printed commands repeat. */
  readonly invocation: CliInvocation;
  /** The contract the database was at before the run, when a migration on disk ends at it. */
  readonly databaseStorageHash: string | undefined;
  readonly contractPath: string;
  readonly database: string | undefined;
  readonly to: string | undefined;
  readonly dryRun: boolean;
  readonly advanceRef: string | undefined;
  readonly statements: readonly StatementText[];
}): Presentations {
  const { document, database, dryRun } = inputs;
  return {
    stdout: noDataLines(
      'Data lines are not defined: this command applies a plan, not migrations, so the db migrate fields do not fit. --json carries the plan and what ran.',
    ),
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
      ...migrationResultBlocks(document, inputs.invocation, inputs.databaseStorageHash),
    ],
    json: () => document,
    next: () =>
      migrationResultNextActions(
        document,
        inputs.invocation,
        cliCommand(inputs.invocation, 'db update', [
          ...(inputs.to === undefined ? [] : ['--to', shellQuoted(inputs.to)]),
          ...(inputs.advanceRef === undefined
            ? []
            : ['--advance-ref', shellQuoted(inputs.advanceRef)]),
          ...inputs.statements.map(statementFlag),
        ]),
      ),
  };
}

/**
 * Whether a flag the run was given answers each entry's question: a `--delete` answers every loss
 * of its subject, or of every subject in the namespace it names, and an `--allow` one operation, in
 * order.
 */
function answeredByFlags(
  entries: readonly AskedSubject[],
  verb: 'delete' | 'allow',
  given: readonly StatementText[],
): readonly (ConsentStatement | undefined)[] {
  const matched = matchConsents(
    verb,
    entries.map(({ text, removedNamespace }) => ({ text, removedNamespace })),
    given.filter((statement) => statement.verb === verb).map(({ text }) => text),
  );
  return entries.map((_, index) => {
    const text = matched.answered.get(index);
    return text === undefined ? undefined : { verb, text };
  });
}

interface ConsentStatement {
  readonly verb: 'delete' | 'allow';
  readonly text: string;
}

function subjectEntryJson(entry: AskedSubject, answeredBy: ConsentStatement | undefined) {
  return {
    operationIndex: entry.operationIndex,
    subject: migrationSubjectJson(entry.subject),
    text: entry.text,
    answered: answeredBy !== undefined,
    ...ifDefined('answeredBy', answeredBy),
    ...ifDefined('removedNamespace', entry.removedNamespace),
  };
}

/** The namespaces the plan removes, each with the `--delete` of it that answers its questions, if one does. */
function removedNamespacesJson(
  value: DbUpdateSuccess,
  given: readonly StatementText[],
): readonly RemovedNamespaceJson[] {
  const answered = answeredByFlags(value.dataLoss, 'delete', given);
  return (value.namespaces?.removed ?? []).map((namespaceId) => ({
    namespaceId,
    ...ifDefined(
      'answeredBy',
      answered.some((statement) => statement?.text === namespaceId)
        ? { verb: 'delete' as const, text: namespaceId }
        : undefined,
    ),
  }));
}

/** The data-loss entries a dry run lists, each with how it loses data and whether a flag answers it. */
function dataLossEntriesJson(entries: readonly AskedDataLoss[], given: readonly StatementText[]) {
  const answered = answeredByFlags(entries, 'delete', given);
  return entries.map((entry, index) => ({
    ...subjectEntryJson(entry, answered[index]),
    ...ifDefined('loss', entry.loss),
  }));
}

/** The access entries a dry run lists, each marked answered when an `--allow` it was given answers it. */
function accessEntriesJson(entries: readonly AskedSubject[], given: readonly StatementText[]) {
  const answered = answeredByFlags(entries, 'allow', given);
  return entries.map((entry, index) => subjectEntryJson(entry, answered[index]));
}

function updateDocument(inputs: {
  readonly value: DbUpdateSuccess;
  readonly targetId: string;
  readonly advancedRef: { readonly name: string; readonly hash: string } | null;
  readonly plannedAdvanceRef: { readonly name: string; readonly hash: string } | null;
  readonly startedAt: number;
  /** The statements the run was given, which a dry run's questions are marked answered by. */
  readonly statements: readonly StatementText[];
  readonly plannerWarnings: readonly MigrationPlannerConflict[];
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
    ...ifDefined('changedStorageEntities', value.changedStorageEntities),
    appliedStatements: value.appliedStatements,
    temporaryValues: value.temporaryValues,
    ...(value.mode === 'plan'
      ? {
          dataLoss: dataLossEntriesJson(value.dataLoss, inputs.statements),
          accessChanges: accessEntriesJson(value.accessChanges, inputs.statements),
          removedNamespaces: removedNamespacesJson(value, inputs.statements),
          addedNamespaces: value.namespaces?.added ?? [],
        }
      : {}),
    ...(inputs.plannerWarnings.length > 0 ? { warnings: inputs.plannerWarnings } : {}),
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
        "go. Before it changes who can read or write a model's data, it asks for\n" +
        '--allow. Where nobody can answer, it refuses and lists every question. Use\n' +
        '--dry-run to see the operations and the questions without applying anything.',
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
    statements: dbUpdateStatementVerbs,
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const startedAt = Date.now();
      const given = ctx.statements
        .values()
        .flatMap(({ verb, text }) => (isStatementVerb(verb) ? [{ verb, text }] : []));
      const contradicted = renamedAndDeleted(given);
      if (contradicted !== undefined) return notOk(normalizeError(contradicted));
      const needsMigrationFile = (['convert', 'backfill'] as const).flatMap((verb) =>
        ctx.statements.take(verb),
      );
      if (needsMigrationFile.length > 0) {
        const databaseStorageHash = await databaseContractIfReachable({
          config: ctx.config,
          cwd: ctx.cwd,
          db: args.flags.db,
          commandName: 'db update',
          createClient,
        });
        return notOk(
          normalizeError(
            errorStatementNeedsMigrationFile(
              given,
              cliInvocation(ctx, args.flags.db),
              databaseStorageHash,
            ),
          ),
        );
      }
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
      let databaseStorageHash: string | undefined;
      try {
        await client.connect(dbConnection);

        const plannerWarnings = plannerWarningsCollector(ctx.report);
        const statementArgs = [
          ...renames,
          ...previewConsents,
          ...unansweredConsents(ctx.statements),
        ].map(statementFlag);
        const rerunArgs = [
          ...(args.flags.to === undefined ? [] : ['--to', shellQuoted(args.flags.to)]),
          ...(args.flags.advanceRef === undefined
            ? []
            : ['--advance-ref', shellQuoted(args.flags.advanceRef)]),
          ...statementArgs,
        ];
        const result = await client.dbUpdate({
          contract: contractJson,
          mode,
          migrationsDir,
          statements: [...renames, ...previewConsents],
          answerQuestions: promptPlanQuestions(ctx.prompt, ctx.statements),
          invocation: { ...cliInvocation(ctx, args.flags.db), rerunArgs, statementArgs },
          onPlannerWarnings: plannerWarnings.onPlannerWarnings,
          onProgress: controlProgressReporter(ctx.report),
        });
        if (!result.ok) {
          plannerWarnings.reportCollected();
          return notOk(normalizeError(result.failure));
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

        databaseStorageHash = result.value.databaseStorageHash;
        document = updateDocument({
          value: result.value,
          targetId: ctx.config.target.targetId,
          advancedRef: advanced.value.advancedRef,
          plannedAdvanceRef: advanced.value.plannedAdvanceRef,
          startedAt,
          statements: previewConsents,
          plannerWarnings: plannerWarnings.collected(),
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
                meta: contractValidationMeta(error),
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
            invocation: cliInvocation(ctx, args.flags.db),
            databaseStorageHash,
            contractPath: prepared.value.contractDisplayPath,
            database: prepared.value.database,
            to: args.flags.to,
            dryRun: args.flags.dryRun,
            advanceRef: args.flags.advanceRef,
            statements: [...renames, ...previewConsents],
          }),
        ),
      );
    },
  });
}

export const dbUpdateCommand = createDbUpdateCommand(createControlClient);

/**
 * The storage hash of the contract the database is at, when the database already exists and can be
 * reached and a migration of the application space ends at that contract, so that `migration plan
 * --from` resolves it. Anything else gives undefined: this only adds `--from` to a refusal, and it
 * never creates a database to read the marker.
 */
async function databaseContractIfReachable(
  inputs: Parameters<typeof prepareMigrationRun>[0],
): Promise<string | undefined> {
  const prepared = await prepareMigrationRun(inputs);
  if (!prepared.ok) return undefined;
  const { client, dbConnection, migrationsDir } = prepared.value;
  const read = async (): Promise<string | undefined> => {
    await client.connect(dbConnection, {
      existingDatabaseOnly: true,
      connectTimeoutMs: MARKER_READ_TIMEOUT_MS,
    });
    const marker = await client.readMarker();
    if (marker === null) return undefined;
    const { packages } = await readMigrationsDir(join(migrationsDir, APP_SPACE_ID), {
      migrationsDir,
    });
    return packages.some(({ metadata }) => metadata.to === marker.storageHash)
      ? marker.storageHash
      : undefined;
  };
  const settled = read()
    .catch(() => undefined)
    .finally(() => closeQuietly(client));
  return settledWithin(settled, MARKER_READ_TIMEOUT_MS);
}

/** How long the refusal waits for the marker before it refuses without `--from`. */
const MARKER_READ_TIMEOUT_MS = 3000;

function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    timer.unref();
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}
