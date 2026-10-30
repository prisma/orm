import type { KeepDataEdit } from '@internal/framework-components/control';
import { formatMigrationTs } from '@internal/migration-tools/migration-ts';
import type { RunnerFailureFacts } from '../control-api/types';

const OPEN = '    return [\n      ';
const CLOSE = ',\n    ];';

/**
 * `calls`, a call or calls separated by commas, as a written `migration.ts` holds them in its
 * `operations` list: formatted as `migration plan` formats the file, with the indentation it gives
 * each line after the first.
 */
async function asWritten(calls: string): Promise<string> {
  const formatted = await formatMigrationTs(
    `class M {\n  get operations() {\n    return [${calls}];\n  }\n}\n`,
  );
  const start = formatted.indexOf(OPEN);
  const end = formatted.lastIndexOf(CLOSE);
  return start === -1 || end === -1 ? calls : formatted.slice(start + OPEN.length, end);
}

/** The facts, with each edit that keeps data quoted as the written `migration.ts` holds its calls. */
export async function withEditsAsWritten(facts: RunnerFailureFacts): Promise<RunnerFailureFacts> {
  if (facts.rowsHoldingValue === undefined) return facts;
  const written = async (edit: KeepDataEdit): Promise<KeepDataEdit> => ({
    ...edit,
    remove: await asWritten(edit.remove),
    replaceWith: await asWritten(edit.replaceWith),
  });
  return {
    ...facts,
    rowsHoldingValue: await Promise.all(
      facts.rowsHoldingValue.map(async (report) =>
        report.keepDataEdit === undefined
          ? report
          : { ...report, keepDataEdit: await written(report.keepDataEdit) },
      ),
    ),
  };
}
