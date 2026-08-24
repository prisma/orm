import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations, Text, TreeNode } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import type { ContractSpaceSeedPhaseRecord } from '../../control-api/operations/contract-space-seed-phase';
import type { MigrationPlanResult } from '../../control-api/operations/migration-plan';
import { executeMigrationPlanCommand } from '../../control-api/operations/migration-plan';
import { previewBlockHeader } from '../../utils/formatters/migrations';
import { runCommandAction } from '../../utils/next-actions';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
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

function operationNodes(result: MigrationPlanResult): readonly TreeNode[] {
  return result.operations.map((operation) =>
    operation.operationClass === 'destructive'
      ? { label: operation.label, status: 'warn' }
      : { label: operation.label },
  );
}

function operationBlocks(result: MigrationPlanResult): readonly Block[] {
  if (result.operations.length === 0) {
    return [];
  }
  const destructive = result.operations.some(
    (operation) => operation.operationClass === 'destructive',
  );
  return [
    {
      kind: 'tree',
      roots: [{ label: result.dir ?? 'operations', children: operationNodes(result) }],
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

function planBlocks(result: MigrationPlanResult, migrationsRelative: string): readonly Block[] {
  const outcome = outcomeFields(result, migrationsRelative);
  if (result.noOp) {
    return [{ kind: 'summary', status: 'ok', text: 'No changes detected' }, outcome];
  }
  if (result.pendingPlaceholders === true) {
    return [{ kind: 'summary', status: 'warn', text: result.summary }, outcome];
  }
  return [
    { kind: 'summary', status: 'ok', text: result.summary },
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
    const migrationTs = join(result.dir ?? '<dir>', 'migration.ts');
    return [
      {
        kind: 'edit-file',
        label: `Replace each placeholder(...) call in ${migrationTs} with your query`,
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

export const migrationPlanCommand = defineOrmCommand({
  help: {
    summary: 'Plan a migration from contract changes',
    description:
      'Compares the emitted contract against the latest on-disk migration state\n' +
      'and produces a new migration package with the required operations.\n' +
      'Offline — does not consult the database.',
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
          'Starting contract reference (hash, prefix, ref name, migration dir name, <dir>^, or ./path)',
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
    const seeded = (record: ContractSpaceSeedPhaseRecord): void => {
      if (record.action !== 'updated') {
        return;
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

    const planned = await executeMigrationPlanCommand(
      {
        config: ctx.config,
        cwd: ctx.cwd,
        configPath: projectConfigPathFor(ctx.cwd),
        ...ifDefined('name', args.flags.name),
        ...ifDefined('from', args.flags.from),
        ...ifDefined('to', args.flags.to),
      },
      Date.now(),
      { onSeeded: seeded },
    );
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
          contractPath: contractPath === undefined ? '(unset)' : displayPath(contractPath, ctx.cwd),
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
