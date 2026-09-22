import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations, Text, TreeNode } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { createControlClient } from '../../control-api/client';
import type { ContractSpaceSeedPhaseRecord } from '../../control-api/operations/contract-space-seed-phase';
import type {
  DestructiveBaselineVerdict,
  MigrationPlanResult,
} from '../../control-api/operations/migration-plan';
import { executeMigrationPlanCommand } from '../../control-api/operations/migration-plan';
import type { CreateControlClient, DestructivePlanOperation } from '../../control-api/types';
import { ERROR_CODE_DESTRUCTIVE_CHANGES } from '../../utils/cli-errors';
import { previewBlockHeader } from '../../utils/formatters/migrations';
import { runCommandAction } from '../../utils/next-actions';
import { ormConfigSection } from '../config-section';
import { destructiveOperationList, errorConsentOperationsMissing } from '../db/consent';
import { defineOrmCommand } from '../define-command';
import { consentToken } from '../init-inputs';
import { normalizeError } from '../normalize-error';
import {
  appMigrationsDirFor,
  contractPathFor,
  displayPath,
  migrationsDirFor,
  projectConfigPathFor,
} from './paths';

function hashRow(label: string, hash: string | null): { label: string; value: Text } {
  return {
    label,
    value:
      hash === null
        ? [{ text: '(baseline)', tone: 'muted' }]
        : [{ text: hash, tone: 'identifier' }],
  };
}

/**
 * Where the run put things: the contract edge it planned, then every directory
 * it wrote — the app-space package, the auto-baseline package that precedes it,
 * and any extension-space package the seed phase materialised.
 */
function outcomeFields(result: MigrationPlanResult, migrationsRelative: string): Block {
  return {
    kind: 'fields',
    rows: [
      hashRow('from', result.from),
      hashRow('to', result.to),
      ...(result.baselineDir === undefined
        ? []
        : [{ label: 'baseline', value: result.baselineDir }]),
      ...(result.dir === undefined ? [] : [{ label: 'app space', value: result.dir }]),
      ...result.emittedExtensionDirs.map((entry) => ({
        label: `space ${entry.spaceId}`,
        value: join(migrationsRelative, entry.spaceId, entry.dirName),
      })),
    ],
  };
}

function operationNodes(operations: MigrationPlanResult['operations']): readonly TreeNode[] {
  return operations.map((operation) =>
    operation.operationClass === 'destructive'
      ? { label: operation.label, status: 'warn' }
      : { label: operation.label },
  );
}

/**
 * One tree root per written package: the auto-baseline package first (when
 * this run wrote one), then the app-space package. A baseline-only run has
 * no `dir`, so the app-space root falls back to `baselineDir`.
 */
function operationRoots(result: MigrationPlanResult): readonly TreeNode[] {
  const baselineOperations = result.baselineOperations ?? [];
  return [
    ...(baselineOperations.length > 0 && result.baselineDir !== undefined
      ? [{ label: result.baselineDir, children: operationNodes(baselineOperations) }]
      : []),
    ...(result.operations.length > 0
      ? [
          {
            label: result.dir ?? result.baselineDir ?? 'operations',
            children: operationNodes(result.operations),
          },
        ]
      : []),
  ];
}

function operationBlocks(result: MigrationPlanResult): readonly Block[] {
  const written = [...(result.baselineOperations ?? []), ...result.operations];
  if (written.length === 0) {
    return [];
  }
  const destructive = written.some((operation) => operation.operationClass === 'destructive');
  return [
    {
      kind: 'tree',
      roots: operationRoots(result),
    },
    ...(destructive
      ? [
          {
            kind: 'summary' as const,
            status: 'warn' as const,
            text: 'This migration contains destructive operations that may cause data loss.',
          },
        ]
      : []),
  ];
}

/** Statements a database would run, printed verbatim rather than laid out. */
function previewBlocks(result: MigrationPlanResult): readonly Block[] {
  const preview = result.preview;
  if (preview === undefined) {
    return [];
  }
  const statements = preview.statements
    .map((statement) => statement.text.trim())
    .filter((text) => text.length > 0)
    .map((text) => (text.endsWith(';') ? text : `${text};`));
  if (statements.length === 0) {
    return [];
  }
  return [
    { kind: 'summary', status: 'info', tone: 'muted', text: previewBlockHeader(preview) },
    { kind: 'drawing', lines: statements },
  ];
}

function originNoticeBlocks(result: MigrationPlanResult): readonly Block[] {
  if (result.fromDefaulted !== true) {
    return [];
  }
  return [
    {
      kind: 'summary',
      status: 'info',
      tone: 'muted',
      text: 'No db ref set — planning from an empty database. Run db init, db update, or db sign if a database already exists.',
    },
  ];
}

function warningBlocks(result: MigrationPlanResult): readonly Block[] {
  return (result.warnings ?? []).map((text): Block => ({ kind: 'summary', status: 'warn', text }));
}

function planBlocks(result: MigrationPlanResult, migrationsRelative: string): readonly Block[] {
  const outcome = outcomeFields(result, migrationsRelative);
  if (result.noOp) {
    return [
      ...warningBlocks(result),
      { kind: 'summary', status: 'ok', text: 'No changes detected' },
      outcome,
    ];
  }
  if (result.pendingPlaceholders === true) {
    return [
      ...warningBlocks(result),
      { kind: 'summary', status: 'warn', text: result.summary },
      ...originNoticeBlocks(result),
      outcome,
    ];
  }
  return [
    ...warningBlocks(result),
    { kind: 'summary', status: 'ok', text: result.summary },
    ...originNoticeBlocks(result),
    ...operationBlocks(result),
    outcome,
    ...previewBlocks(result),
  ];
}

function planNextActions(
  result: MigrationPlanResult,
  migrationsRelative: string,
): readonly NextAction[] {
  if (result.pendingPlaceholders === true) {
    const stubFiles = [
      ...new Set([
        ...(result.baselineDir === undefined ? [] : [join(result.baselineDir, 'migration.ts')]),
        ...(result.dir === undefined ? [] : [join(result.dir, 'migration.ts')]),
      ]),
    ];
    const migrationTs = stubFiles.at(-1) ?? join('<dir>', 'migration.ts');
    return [
      {
        kind: 'edit-file',
        label: `Replace each placeholder(...) call in ${stubFiles.join(' and ') || migrationTs} with your query`,
      },
      runCommandAction(
        'Run it to self-emit ops.json and attest the package',
        `node "${migrationTs}"`,
      ),
    ];
  }
  const written = [
    ...(result.baselineDir === undefined ? [] : [result.baselineDir]),
    ...(result.dir === undefined ? [] : [result.dir]),
    ...result.emittedExtensionDirs.map((entry) =>
      join(migrationsRelative, entry.spaceId, entry.dirName),
    ),
  ];
  if (written.length === 0) {
    return [];
  }
  return [
    { kind: 'edit-file', label: `Review ${written.join(' and ')}` },
    runCommandAction('Apply the migration', '{bin} db migrate'),
  ];
}

function planPresentations(inputs: {
  readonly document: MigrationPlanResult;
  readonly contractPath: string;
  readonly appMigrationsRelative: string;
  readonly migrationsRelative: string;
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly name: string | undefined;
}): Presentations {
  return {
    stdout: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: inputs.contractPath },
          { label: 'migrations', value: inputs.appMigrationsRelative },
          ...(inputs.from === undefined ? [] : [{ label: 'from', value: inputs.from }]),
          ...(inputs.to === undefined ? [] : [{ label: 'to', value: inputs.to }]),
          ...(inputs.name === undefined ? [] : [{ label: 'name', value: inputs.name }]),
        ],
      },
      ...planBlocks(inputs.document, inputs.migrationsRelative),
    ],
    json: () => inputs.document,
    next: () => planNextActions(inputs.document, inputs.migrationsRelative),
  };
}

/** The question the user answers before a destructive baseline is written. */
function destructiveBaselineQuestion(operations: readonly DestructivePlanOperation[]): string {
  return [
    `Write a baseline migration containing ${operations.length} destructive operation(s)? Applying it would remove data that cannot be recovered:`,
    destructiveOperationList(operations),
  ].join('\n');
}

export function createMigrationPlanCommand(createClient: CreateControlClient) {
  return defineOrmCommand({
    help: {
      summary: 'Plan a migration from contract changes',
      description:
        'Compares the emitted contract against the latest on-disk migration state\n' +
        'and produces a new migration package with the required operations.\n' +
        'On an empty migrations directory a baseline package is derived from the\n' +
        '`db` ref first; a baseline containing destructive operations is only\n' +
        'written with your consent: the command asks you to type the project\n' +
        'directory name, or takes `--confirm <directory>` where there is nobody\n' +
        'to ask. Offline — does not consult the database.',
      examples: [
        'migration plan',
        // biome-ignore lint/plugin/no-family-vocabulary: a migration slug a user would plausibly type, not a schema concept
        'migration plan --name add-users-table',
        'migration plan --to <migration-dir>^ --name rollback',
        'migration plan --json',
      ],
    },
    args: {
      flags: {
        name: flag.string({ brief: 'Name slug for the migration directory', placeholder: 'slug' }),
        from: flag.string({
          brief:
            'Starting contract reference (hash, prefix, ref name, migration dir name, <dir>^, @empty, or ./path)',
          placeholder: 'contract',
        }),
        to: flag.string({
          brief:
            'Destination contract reference; defaults to the emitted contract. Same grammar as --from',
          placeholder: 'contract',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      // Dirs the seed phase materialised across this invocation's run(s): the
      // consented re-run finds them already on disk, so its own seed records
      // come back `unchanged` and the accumulated list is threaded back in.
      const seededDirs: { spaceId: string; dirName: string }[] = [];
      const seeded = (record: ContractSpaceSeedPhaseRecord): void => {
        if (record.action !== 'updated') {
          return;
        }
        for (const dirName of record.newMigrationDirs) {
          seededDirs.push({ spaceId: record.spaceId, dirName });
        }
        const step = `Seed contract space ${record.spaceId}`;
        ctx.report({ kind: 'step-started', step, id: record.spaceId });
        ctx.report({
          kind: 'step-finished',
          step,
          id: record.spaceId,
          outcome: 'ok',
          data: { newHash: record.newHash, newMigrationDirs: record.newMigrationDirs },
        });
      };

      const plan = (consent?: { readonly planHash: string }) =>
        executeMigrationPlanCommand(
          {
            config: ctx.config,
            cwd: ctx.cwd,
            configPath: projectConfigPathFor(ctx.cwd),
            ...ifDefined('name', args.flags.name),
            ...ifDefined('from', args.flags.from),
            ...ifDefined('to', args.flags.to),
            ...ifDefined('consent', consent),
            ...ifDefined(
              'carryEmittedExtensionDirs',
              consent !== undefined && seededDirs.length > 0 ? [...seededDirs] : undefined,
            ),
            client: createClient({
              family: ctx.config.family,
              target: ctx.config.target,
              adapter: ctx.config.adapter,
              ...ifDefined('driver', ctx.config.driver),
              extensions: ctx.config.extensions ?? [],
            }),
          },
          Date.now(),
          { onSeeded: seeded },
        );

      let planned = await plan();
      // The destructive verdict is the planner's own: an auto-baseline whose
      // operations would remove data is refused before anything is written.
      // Consent is asked for here and the plan re-run carrying the refused
      // plan's hash — the operation layer refuses if the recomputed baseline is
      // no longer that plan. Mirrors the `db update` consent flow.
      if (!planned.ok && planned.failure.code === ERROR_CODE_DESTRUCTIVE_CHANGES) {
        const verdict = blindCast<
          Partial<DestructiveBaselineVerdict>,
          'the meta envelope is produced by refuseUnconsentedDestructiveBaseline; presence is checked below'
        >(planned.failure.meta ?? {});
        if (
          verdict.destructiveOperations === undefined ||
          verdict.destructiveOperations.length === 0 ||
          verdict.planHash === undefined
        ) {
          return notOk(
            normalizeError(
              errorConsentOperationsMissing({ previewCommand: '{bin} migration plan' }),
            ),
          );
        }
        const token = consentToken(ctx.cwd);
        const granted = await ctx.prompt.consent(
          destructiveBaselineQuestion(verdict.destructiveOperations),
          { token },
        );
        if (!granted) {
          return notOk(normalizeError(planned.failure));
        }
        planned = await plan({ planHash: verdict.planHash });
      }
      if (!planned.ok) {
        return notOk(normalizeError(planned.failure));
      }

      ctx.report({
        kind: 'message',
        severity: 'verbose',
        text: `Total time: ${planned.value.timings.total}ms`,
      });

      const contractPath = contractPathFor(ctx.config, ctx.cwd);
      return ok(
        ctx.present(
          { data: planned.value },
          planPresentations({
            document: planned.value,
            contractPath:
              contractPath === undefined ? '(unset)' : displayPath(contractPath, ctx.cwd),
            appMigrationsRelative: displayPath(appMigrationsDirFor(ctx.config, ctx.cwd), ctx.cwd),
            migrationsRelative: displayPath(migrationsDirFor(ctx.config, ctx.cwd), ctx.cwd),
            from: args.flags.from,
            to: args.flags.to,
            name: args.flags.name,
          }),
        ),
      );
    },
  });
}

export const migrationPlanCommand = createMigrationPlanCommand(createControlClient);
