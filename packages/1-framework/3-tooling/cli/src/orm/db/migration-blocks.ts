import type { OperationPreview } from '@internal/framework-components/control';
import type { Block, TreeNode } from '@prisma/cli-engine';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { labelsText } from '../../control-api/statements/plan-questions';
import { statementFlag } from '../../control-api/statements/statement-flag';
import type { PerSpaceExecutionEntry } from '../../control-api/types';
import {
  type MigrationCommandResult,
  previewBlockHeader,
  renderPreviewStatement,
} from '../../utils/formatters/migrations';
import { runCommandAction } from '../../utils/next-actions';
import { type CliInvocation, cliCommand, printedPlanCommand } from '../../utils/printed-command';
import { appliedStatementBlocks } from '../statement-blocks';

interface PlannedOperation {
  readonly label: string;
  readonly operationClass: string;
}

function operationNode(operation: PlannedOperation): TreeNode {
  return operation.operationClass === 'destructive'
    ? { label: operation.label, status: 'warn' }
    : { label: operation.label };
}

function spaceLabel(space: PerSpaceExecutionEntry): string {
  return space.kind === 'app' ? 'App space' : `Extension space: ${space.spaceId}`;
}

/**
 * One root per contract space, in the schedule order the runner used. A
 * space's post-apply marker is the last child of its own space, so the engine
 * draws it under the operations it signs.
 */
function spaceNodes(
  perSpace: ReadonlyArray<PerSpaceExecutionEntry>,
  mode: 'plan' | 'apply',
): readonly TreeNode[] {
  return perSpace.map((space) => ({
    label: [{ text: spaceLabel(space), tone: 'identifier' as const }],
    children: [
      ...(space.operations.length === 0
        ? [{ label: [{ text: '(no operations)', tone: 'muted' as const }] }]
        : space.operations.map(operationNode)),
      ...(mode === 'apply' && space.marker !== undefined
        ? [
            {
              label: [
                { text: 'marker ', tone: 'muted' as const },
                { text: space.marker.storageHash, tone: 'identifier' as const },
              ],
            },
          ]
        : []),
    ],
  }));
}

function destructiveWarningBlocks(hasDestructive: boolean): readonly Block[] {
  return hasDestructive
    ? [
        {
          kind: 'summary',
          status: 'warn',
          text: 'This migration contains destructive operations that may cause data loss.',
        },
      ]
    : [];
}

/**
 * The planned or executed operations. The per-space breakdown is the shape the
 * aggregate flow produces; the flat tree is the fallback for a result that
 * carries no breakdown.
 */
export function perSpaceBlocks(
  perSpace: ReadonlyArray<PerSpaceExecutionEntry>,
  mode: 'plan' | 'apply',
): readonly Block[] {
  const hasDestructive = perSpace.some((space) =>
    space.operations.some((operation) => operation.operationClass === 'destructive'),
  );
  return [
    { kind: 'tree', roots: spaceNodes(perSpace, mode) },
    ...destructiveWarningBlocks(hasDestructive),
  ];
}

function operationBlocks(result: MigrationCommandResult): readonly Block[] {
  const perSpace = result.perSpace;
  if (perSpace !== undefined && perSpace.length > 0) {
    return perSpaceBlocks(perSpace, result.mode);
  }
  if (result.plan.operations.length === 0) {
    return [];
  }
  const hasDestructive = result.plan.operations.some(
    (operation) => operation.operationClass === 'destructive',
  );
  return [
    { kind: 'tree', roots: result.plan.operations.map(operationNode) },
    ...destructiveWarningBlocks(hasDestructive),
  ];
}

/** The statements a database would run, printed verbatim rather than laid out. */
function previewBlocks(preview: OperationPreview | undefined): readonly Block[] {
  if (preview === undefined) {
    return [];
  }
  const header: Block = {
    kind: 'summary',
    status: 'info',
    tone: 'muted',
    text: previewBlockHeader(preview),
  };
  const statements = preview.statements
    .map((statement) => renderPreviewStatement(statement.text, statement.language))
    .filter((text): text is string => text !== undefined);
  return statements.length === 0
    ? [header, { kind: 'summary', status: 'info', tone: 'muted', text: 'No operations.' }]
    : [header, { kind: 'drawing', lines: statements }];
}

/** What the planner flagged without refusing to plan it. */
function plannerWarningBlocks(result: MigrationCommandResult): readonly Block[] {
  const warnings = result.warnings ?? [];
  if (warnings.length === 0) {
    return [];
  }
  return [
    { kind: 'summary', status: 'warn', text: 'Planner warnings' },
    { kind: 'list', items: warnings.map((warning) => warning.summary) },
  ];
}

/** The new required fields whose existing rows get a temporary value, and how to choose the value. */
function temporaryValueBlocks(
  result: MigrationCommandResult,
  invocation: CliInvocation,
  databaseStorageHash: string | undefined,
): readonly Block[] {
  const get = result.mode === 'plan' ? 'would get' : 'got';
  return (result.temporaryValues ?? []).map(
    ({ field, value }): Block => ({
      kind: 'summary',
      status: 'warn',
      text: `Existing rows ${get} ${value} in field "${field}". To choose the value, plan a migration with ${printedPlanCommand(invocation, databaseStorageHash, [statementFlag({ verb: 'backfill', text: field })])} instead.`,
    }),
  );
}

function planSummaryText(result: MigrationCommandResult): string {
  const operations = result.plan.operations.length;
  const spaces = result.perSpace?.length ?? 0;
  return spaces > 0
    ? `Planned ${operations} operation(s) across ${spaces} contract space${spaces === 1 ? '' : 's'}`
    : `Planned ${operations} operation(s)`;
}

function applySummaryText(result: MigrationCommandResult): string {
  const executed = result.execution?.operationsExecuted ?? 0;
  const spaces = result.perSpace?.length ?? 0;
  const across = spaces > 0 ? ` across ${spaces} contract space${spaces === 1 ? '' : 's'}` : '';
  if (result.changedStorageEntities !== undefined) return result.summary;
  if (executed === 0) {
    return `Database already matches contract${across}`;
  }
  return `Applied ${executed} operation(s)${across}`;
}

/** For each namespace the plan removes, the answers that answer all of its questions. */
function namespaceAnswerLines(result: MigrationCommandResult): readonly { label: string }[] {
  const added = result.addedNamespaces ?? [];
  return (result.removedNamespaces ?? []).map(({ namespaceId, answeredBy }) => {
    const deleteFlag = statementFlag({ verb: 'delete', text: namespaceId });
    const rename =
      added.length === 0
        ? ''
        : `, or ${added.map((target) => statementFlag({ verb: 'rename', text: `${namespaceId}:${target}` })).join(' or ')} if it was renamed`;
    return {
      label: `every question about namespace "${namespaceId}": ${deleteFlag}${rename}${answeredBy === undefined ? '' : ' (answered)'}`,
    };
  });
}

/** The entries a dry run lists, one group per answer: a `--delete` answers every operation of its subject, an `--allow` one operation. */
function answerGroups<TEntry extends { readonly text: string; readonly operationIndex: number }>(
  entries: readonly { readonly entry: TEntry; readonly verb: 'delete' | 'allow' }[],
): readonly {
  readonly verb: 'delete' | 'allow';
  readonly text: string;
  readonly entries: readonly TEntry[];
}[] {
  const groups = new Map<string, { verb: 'delete' | 'allow'; text: string; entries: TEntry[] }>();
  entries.forEach(({ entry, verb }, index) => {
    const key = verb === 'delete' ? `delete ${entry.text}` : `allow ${index}`;
    const group = groups.get(key) ?? { verb, text: entry.text, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  });
  return [...groups.values()];
}

/**
 * The questions an apply would ask, as a dry run lists them: each operation that would lose data,
 * answered by `--delete` or `--rename`, and each that would change access, answered by `--allow`.
 */
function questionBlocks(result: MigrationCommandResult): readonly Block[] {
  const entries = [
    ...(result.dataLoss ?? []).map((entry) => ({ entry, verb: 'delete' as const })),
    ...(result.accessChanges ?? []).map((entry) => ({ entry, verb: 'allow' as const })),
  ];
  if (entries.length === 0) {
    return [];
  }
  return [
    {
      kind: 'tree',
      roots: [
        {
          label: 'An apply asks about',
          children: [
            ...answerGroups(entries).map(({ entries: answered, verb, text }) => ({
              label: `${labelsText(answered.map((entry) => result.plan.operations[entry.operationIndex]?.label ?? 'an operation'))}: ${statementFlag({ verb, text })}${answered.some((entry) => entry.answered) ? ' (answered)' : ''}`,
            })),
            ...namespaceAnswerLines(result),
          ],
        },
      ],
    },
  ];
}

function planBlocks(
  result: MigrationCommandResult,
  invocation: CliInvocation,
  databaseStorageHash: string | undefined,
): readonly Block[] {
  const planned = result.plannedAdvanceRef;
  return [
    { kind: 'summary', status: 'ok', text: planSummaryText(result) },
    ...plannerWarningBlocks(result),
    ...operationBlocks(result),
    ...temporaryValueBlocks(result, invocation, databaseStorageHash),
    ...appliedStatementBlocks(result.appliedStatements ?? []),
    ...questionBlocks(result),
    {
      kind: 'fields',
      rows: [
        {
          label: 'destination',
          value: [{ text: result.plan.destination.storageHash, tone: 'identifier' }],
        },
      ],
    },
    ...(planned === null || planned === undefined
      ? []
      : [
          {
            kind: 'summary' as const,
            status: 'info' as const,
            text: [
              { text: `Would advance ref "${planned.name}" → ` },
              { text: planned.hash, tone: 'identifier' as const },
            ],
          },
        ]),
    ...previewBlocks(result.plan.preview),
    {
      kind: 'summary',
      status: 'info',
      tone: 'muted',
      text: 'This is a dry run. No changes were applied.',
    },
  ];
}

/**
 * The app-space marker, for a result that carried no per-space breakdown. The
 * label names what the marker covers rather than calling it "the" signature.
 */
function fallbackMarkerBlocks(result: MigrationCommandResult): readonly Block[] {
  const marker = result.marker;
  if (marker === undefined || (result.perSpace !== undefined && result.perSpace.length > 0)) {
    return [];
  }
  return [
    {
      kind: 'fields',
      rows: [
        { label: 'App-space marker', value: [{ text: marker.storageHash, tone: 'identifier' }] },
        ...(marker.profileHash === undefined
          ? []
          : [
              {
                label: 'Profile hash',
                value: [{ text: marker.profileHash, tone: 'identifier' as const }],
              },
            ]),
      ],
    },
  ];
}

function applyBlocks(
  result: MigrationCommandResult,
  invocation: CliInvocation,
  databaseStorageHash: string | undefined,
): readonly Block[] {
  const advanced = result.advancedRef;
  return [
    { kind: 'summary', status: 'ok', text: applySummaryText(result) },
    ...plannerWarningBlocks(result),
    ...operationBlocks(result),
    ...temporaryValueBlocks(result, invocation, databaseStorageHash),
    ...appliedStatementBlocks(result.appliedStatements ?? []),
    ...fallbackMarkerBlocks(result),
    ...(advanced === null || advanced === undefined
      ? []
      : [
          {
            kind: 'summary' as const,
            status: 'ok' as const,
            text: [
              { text: `Advanced ref "${advanced.name}" → ` },
              { text: advanced.hash, tone: 'identifier' as const },
            ],
          },
        ]),
  ];
}

/**
 * What a `db init` / `db update` result looks like in human mode. Printed commands repeat
 * `invocation`, and a printed `migration plan` starts from `databaseStorageHash`, the contract the
 * database was at before the run, when a migration on disk ends at it.
 */
export function migrationResultBlocks(
  result: MigrationCommandResult,
  invocation: CliInvocation,
  databaseStorageHash: string | undefined,
): readonly Block[] {
  return result.mode === 'plan'
    ? planBlocks(result, invocation, databaseStorageHash)
    : applyBlocks(result, invocation, databaseStorageHash);
}

/** Where the user goes next, as typed actions rather than trailing prose. */
export function migrationResultNextActions(
  result: MigrationCommandResult,
  invocation: CliInvocation,
  applyCommand: string,
): readonly NextAction[] {
  return result.mode === 'plan'
    ? [runCommandAction('Apply the planned operations', applyCommand)]
    : [
        runCommandAction(
          result.perSpace !== undefined && result.perSpace.length === 1
            ? 'Confirm the space is up to date'
            : 'Confirm every space is up to date',
          cliCommand(invocation, 'migration status'),
        ),
      ];
}
