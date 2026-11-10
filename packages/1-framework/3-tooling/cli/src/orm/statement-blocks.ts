import type { Block } from '@prisma/cli-engine';
import type { AppliedStatementReport } from '../control-api/statements/report-applied-statements';

const SLOT_TEXT: Partial<Record<AppliedStatementReport['verb'], string>> = {
  convert: 'conversion slot written in migration.ts',
  backfill: 'backfill slots written in migration.ts',
};

function operationCountText(entry: AppliedStatementReport): string {
  const count = entry.operationIndexes.length;
  if (count === 0) return SLOT_TEXT[entry.verb] ?? 'no operations';
  return count === 1 ? '1 operation' : `${count} operations`;
}

/**
 * The `Statements applied` tree: one line per statement in the order given,
 * each described in domain names, with the number of operations it
 * accounts for. Nothing when no statements were given.
 */
export function appliedStatementBlocks(
  applied: readonly AppliedStatementReport[],
): readonly Block[] {
  if (applied.length === 0) {
    return [];
  }
  return [
    {
      kind: 'tree',
      roots: [
        {
          label: 'Statements applied',
          children: applied.map((entry) => ({
            label: `${entry.description} (${operationCountText(entry)})`,
          })),
        },
      ],
    },
  ];
}
