import type { OperationPreview } from '@internal/framework-components/control';
import type { Block, TreeNode } from '@prisma/cli-engine';
import type { NextAction } from '@prisma/cli-engine/protocol';
import type { PerSpaceExecutionEntry } from '../../control-api/types';
import {
  type MigrationCommandResult,
  previewBlockHeader,
  renderPreviewStatement,
} from '../../utils/formatters/migrations';
import { runCommandAction } from '../../utils/next-actions';

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

/**
 * What the planner flagged without refusing to plan it. Only `db update`
 * produces these — the additive-only policies cannot reach the branch.
 */
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
  if (executed === 0) {
    return `Database already matches contract${across}`;
  }
  return `Applied ${executed} operation(s)${across}`;
}

function planBlocks(result: MigrationCommandResult): readonly Block[] {
  const planned = result.plannedAdvanceRef;
  return [
    { kind: 'summary', status: 'ok', text: planSummaryText(result) },
    ...plannerWarningBlocks(result),
    ...operationBlocks(result),
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

function applyBlocks(result: MigrationCommandResult): readonly Block[] {
  const advanced = result.advancedRef;
  return [
    { kind: 'summary', status: 'ok', text: applySummaryText(result) },
    ...plannerWarningBlocks(result),
    ...operationBlocks(result),
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

/** What a `db init` / `db update` result looks like in human mode. */
export function migrationResultBlocks(result: MigrationCommandResult): readonly Block[] {
  return result.mode === 'plan' ? planBlocks(result) : applyBlocks(result);
}

/** Where the user goes next, as typed actions rather than trailing prose. */
export function migrationResultNextActions(
  result: MigrationCommandResult,
  applyCommand: string,
): readonly NextAction[] {
  return result.mode === 'plan'
    ? [runCommandAction('Apply the planned operations', applyCommand)]
    : [
        runCommandAction(
          result.perSpace !== undefined && result.perSpace.length === 1
            ? 'Confirm the space is up to date'
            : 'Confirm every space is up to date',
          '{bin} migration status',
        ),
      ];
}
