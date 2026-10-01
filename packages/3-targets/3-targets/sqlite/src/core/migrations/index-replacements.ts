import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { parseWireName } from '@internal/sql-schema-ir/naming';
import { SqlIndexIR } from '@internal/sql-schema-ir/types';
import { sqliteIdentifiersCollide } from './identifier-case';
import { issueNode } from './issue-planner';
import { CreateIndexCall, DropIndexCall, type SqliteOpFactoryCall } from './op-factory-call';

export interface IndexFinding {
  readonly issue: SchemaDiffIssue;
  readonly index: SqlIndexIR;
  readonly tableName: string;
}

/** Whether an index the plan drops is replaced by one the plan creates. */
export type IndexReplacementMatch = (old: IndexFinding, replacement: IndexFinding) => boolean;

function indexFindings(
  issues: readonly SchemaDiffIssue[],
  outcome: 'not-found' | 'not-expected',
): IndexFinding[] {
  return issues.flatMap((issue) => {
    const node = issueNode(issue);
    const tableName = issue.path[1];
    if (node === undefined || !SqlIndexIR.is(node) || tableName === undefined) return [];
    return issueOutcome(issue) === outcome ? [{ issue, index: node, tableName }] : [];
  });
}

/**
 * An index on a renamed table whose wire name derives from the table name: the old and the new index share their content hash and differ in name.
 */
export function renamedTableIndex(renamedTables: ReadonlySet<string>): IndexReplacementMatch {
  return (old, replacement) => {
    const oldWire = parseWireName(old.index.name);
    const replacementWire = parseWireName(replacement.index.name);
    return (
      renamedTables.has(old.tableName) &&
      old.tableName === replacement.tableName &&
      oldWire !== undefined &&
      oldWire.hash === replacementWire?.hash &&
      old.index.name !== replacement.index.name
    );
  };
}

/**
 * An index on the same table whose new name SQLite takes for the old one, as after a table renamed by hand. Its content is not compared: the old index must be dropped before the new one can be created whatever either defines, and the new one is created from its own definition.
 */
export const indexNameCaseChange: IndexReplacementMatch = (old, replacement) =>
  old.tableName === replacement.tableName &&
  old.index.name !== replacement.index.name &&
  sqliteIdentifiersCollide(old.index.name, replacement.index.name);

/**
 * Pairs each index the plan drops with the index that replaces it, and plans every paired drop before every paired create. SQLite cannot rename an index, and it compares index names without regard to the case of ASCII letters, so a replacement whose name differs from the old one only in that case would otherwise collide with it. The paired issues are returned as consumed so the ordinary diff does not plan them again.
 */
export function pairIndexReplacements(
  issues: readonly SchemaDiffIssue[],
  matches: IndexReplacementMatch,
): {
  readonly calls: readonly SqliteOpFactoryCall[];
  readonly consumed: ReadonlySet<SchemaDiffIssue>;
} {
  const missing = indexFindings(issues, 'not-found');
  const pairs = indexFindings(issues, 'not-expected').flatMap((old) => {
    const replacement = missing.find((candidate) => matches(old, candidate));
    if (replacement === undefined) return [];
    missing.splice(missing.indexOf(replacement), 1);
    return [{ old, replacement }];
  });
  return {
    calls: [
      ...pairs.map(({ old }) => new DropIndexCall(old.tableName, old.index.name)),
      ...pairs.map(
        ({ replacement }) =>
          new CreateIndexCall(
            replacement.tableName,
            replacement.index.name,
            replacement.index.columns ?? [],
          ),
      ),
    ],
    consumed: new Set(pairs.flatMap(({ old, replacement }) => [old.issue, replacement.issue])),
  };
}
