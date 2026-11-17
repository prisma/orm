import type { SqlPlannerConflict } from '@internal/family-sql/control';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import {
  type PrimaryKey,
  RelationalSchemaNodeKind,
  type SqlForeignKeyIR,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { defaultForeignKeyName, defaultPrimaryKeyName } from '../default-constraint-names';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresSchemaNodeKind } from '../schema-ir/schema-node-kinds';
import {
  emissionSchemaName,
  fkSpecFromNode,
  issueNode,
  issueSchemaName,
  issueTableName,
} from './issue-planner';
import {
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  DropConstraintCall,
  type PostgresOpFactoryCall,
} from './op-factory-call';
import type { CallMigrationStrategy, StrategyContext } from './planner-strategies';

interface ForeignKeyAt {
  readonly ddlSchemaName: string;
  readonly tableName: string;
  readonly foreignKey: SqlForeignKeyIR;
}

interface KeyChange {
  readonly issue: SchemaDiffIssue;
  readonly ddlSchemaName: string;
  readonly tableName: string;
  readonly oldKey: PrimaryKey;
}

function keyChangeOf(issue: SchemaDiffIssue): KeyChange | undefined {
  const ddlSchemaName = issueSchemaName(issue);
  const tableName = issueTableName(issue);
  if (
    issueNode(issue)?.nodeKind !== RelationalSchemaNodeKind.primaryKey ||
    issueOutcome(issue) === 'not-found' ||
    ddlSchemaName === undefined ||
    tableName === undefined
  ) {
    return undefined;
  }
  const oldKey = blindCast<
    PrimaryKey,
    'a not-equal or not-expected primary-key issue always carries the actual PrimaryKey node'
  >(issue.actual);
  return { issue, ddlSchemaName, tableName, oldKey };
}

function sameColumnSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((column) => right.includes(column));
}

function foreignKeysOf(tree: PostgresDatabaseSchemaNode): readonly ForeignKeyAt[] {
  return Object.values(tree.namespaces).flatMap((namespace) =>
    Object.values(namespace.tables).flatMap((table) =>
      table.foreignKeys.map((foreignKey) => ({
        ddlSchemaName: namespace.schemaName,
        tableName: table.name,
        foreignKey,
      })),
    ),
  );
}

function referencesKey(at: ForeignKeyAt, change: KeyChange): boolean {
  const referencedSchema = at.foreignKey.resolvedReferencedNamespace ?? at.ddlSchemaName;
  return (
    referencedSchema === change.ddlSchemaName &&
    at.foreignKey.referencedTable === change.tableName &&
    sameColumnSet(at.foreignKey.referencedColumns, change.oldKey.columns)
  );
}

function isTableIssueOf(issue: SchemaDiffIssue, at: ForeignKeyAt): boolean {
  return issueSchemaName(issue) === at.ddlSchemaName && issueTableName(issue) === at.tableName;
}

function hasOwnIssue(at: ForeignKeyAt, issues: readonly SchemaDiffIssue[]): boolean {
  return issues.some(
    (issue) =>
      issueNode(issue)?.nodeKind === RelationalSchemaNodeKind.foreignKey &&
      isTableIssueOf(issue, at) &&
      issue.actual?.id === at.foreignKey.id,
  );
}

function dropsTable(at: ForeignKeyAt, issues: readonly SchemaDiffIssue[]): boolean {
  return issues.some(
    (issue) =>
      issueNode(issue)?.nodeKind === PostgresSchemaNodeKind.table &&
      issueOutcome(issue) === 'not-expected' &&
      isTableIssueOf(issue, at),
  );
}

function endForeignKey(
  endTree: PostgresDatabaseSchemaNode,
  at: ForeignKeyAt,
): SqlForeignKeyIR | undefined {
  const namespace = Object.values(endTree.namespaces).find(
    (candidate) => candidate.schemaName === at.ddlSchemaName,
  );
  return namespace?.tables[at.tableName]?.foreignKeys.find(
    (foreignKey) => foreignKey.id === at.foreignKey.id,
  );
}

function foreignKeyName(at: ForeignKeyAt): string {
  return at.foreignKey.name ?? defaultForeignKeyName(at.tableName, at.foreignKey.columns);
}

const migrationNewAdvice =
  'write the change as its own migration with prisma migration new, dropping that foreign key before the key change and adding it back after it.';

function quotedTable(at: ForeignKeyAt): string {
  return `"${at.ddlSchemaName}"."${at.tableName}"`;
}

function blockedKeyChange(
  change: KeyChange,
  at: ForeignKeyAt,
  reason: string,
  why: string,
): SqlPlannerConflict {
  const keyName = change.oldKey.name ?? defaultPrimaryKeyName(change.tableName);
  const name = foreignKeyName(at);
  return {
    kind: 'foreignKeyConflict',
    summary: `Primary key "${keyName}" on "${change.ddlSchemaName}"."${change.tableName}" cannot change while foreign key "${name}" on ${quotedTable(at)} references it, and ${reason}.`,
    why,
    location: { entityKind: 'table', entityName: at.tableName, constraint: name },
  };
}

function controlPolicyRefusal(change: KeyChange, at: ForeignKeyAt, declared: boolean) {
  const table = quotedTable(at);
  const dbUpdateAdvice = declared
    ? 'With db update, drop that foreign key yourself and leave it out of the contract, run db update, then add the foreign key back to both if you still want it and run db update again.'
    : 'With db update, drop that foreign key yourself, run db update, then add the foreign key back if you still want it.';
  return blockedKeyChange(
    change,
    at,
    `the control policy does not let this plan change ${table}`,
    `With migration plan, give ${table} a control policy that lets this plan change it and plan again, or ${migrationNewAdvice} ${dbUpdateAdvice}`,
  );
}

function otherSpaceRefusal(change: KeyChange, at: ForeignKeyAt) {
  const table = quotedTable(at);
  return blockedKeyChange(
    change,
    at,
    `another contract space owns ${table}`,
    `Change that foreign key through the contract space that owns ${table}, or ${migrationNewAdvice}`,
  );
}

function undeclaredTableRefusal(change: KeyChange, at: ForeignKeyAt) {
  const table = quotedTable(at);
  return blockedKeyChange(
    change,
    at,
    `the contract does not declare ${table}`,
    `This plan allows only additive changes, as db init does, so it cannot change a primary key. Run db update instead, which drops ${table} together with its foreign key; add ${table} to the contract first if you want to keep it.`,
  );
}

function removedForeignKeyRefusal(change: KeyChange, at: ForeignKeyAt) {
  return blockedKeyChange(
    change,
    at,
    `the contract leaves that foreign key out of ${quotedTable(at)}`,
    'This plan allows only additive changes, as db init does, so it can neither drop that foreign key nor change a primary key. Run db update instead, which drops that foreign key before the key change.',
  );
}

function undeclaredSchemaRefusal(change: KeyChange, at: ForeignKeyAt) {
  const table = quotedTable(at);
  return blockedKeyChange(
    change,
    at,
    `the contract does not declare schema "${at.ddlSchemaName}", whose tables a plan never drops`,
    `With migration plan, declare ${table} in the contract and plan again, or ${migrationNewAdvice} With db update, drop that foreign key yourself, run db update, then add the foreign key back if you still want it.`,
  );
}

function allowsOnlyAdditive(ctx: StrategyContext): boolean {
  const allowed = ctx.policy.allowedOperationClasses;
  return !allowed.includes('widening') && !allowed.includes('destructive');
}

function tableInEndTree(endTree: PostgresDatabaseSchemaNode, at: ForeignKeyAt): boolean {
  return Object.values(endTree.namespaces).some(
    (namespace) =>
      namespace.schemaName === at.ddlSchemaName && namespace.tables[at.tableName] !== undefined,
  );
}

function keyCalls(change: KeyChange, ctx: StrategyContext): readonly PostgresOpFactoryCall[] {
  const schemaName = emissionSchemaName(ctx, change.ddlSchemaName);
  const drop = new DropConstraintCall(
    schemaName,
    change.tableName,
    change.oldKey.name ?? defaultPrimaryKeyName(change.tableName),
    'primaryKey',
  );
  if (issueOutcome(change.issue) === 'not-expected') return [drop];
  const newKey = blindCast<
    PrimaryKey,
    'a not-equal primary-key issue always carries the expected PrimaryKey node'
  >(change.issue.expected);
  return [
    drop,
    new AddPrimaryKeyCall(
      schemaName,
      change.tableName,
      newKey.name ?? defaultPrimaryKeyName(change.tableName),
      [...newKey.columns],
    ),
  ];
}

/**
 * Plans a primary key whose columns change, or that is removed: a drop of the old key, then an add of the new one. Postgres refuses to drop a key while a foreign key depends on its index, so every foreign key of the start tree that references the old key's columns is dropped first, unless its own issue already drops it, and added back from the end tree. The plan refuses the change instead when such a foreign key is on a table the control policy keeps it away from or another contract space owns, or when the end tree leaves the foreign key out and the plan does not drop it or its table: under a policy that allows additive changes alone, as `db init` does, or because the table is in a schema the end contract does not declare.
 */
export function primaryKeyChangeStrategy(
  issues: readonly SchemaDiffIssue[],
  ctx: StrategyContext,
): ReturnType<CallMigrationStrategy> {
  const changes = issues.flatMap((issue) => keyChangeOf(issue) ?? []);
  if (changes.length === 0) return { kind: 'no_match' };

  const startForeignKeys = foreignKeysOf(ctx.startTree);
  const calls: PostgresOpFactoryCall[] = [];
  const conflicts: SqlPlannerConflict[] = [];
  for (const change of changes) {
    const changeCalls: PostgresOpFactoryCall[] = [];
    const changeConflicts: SqlPlannerConflict[] = [];
    for (const at of startForeignKeys) {
      if (!referencesKey(at, change) || hasOwnIssue(at, ctx.allIssues)) continue;
      const drop = new DropConstraintCall(
        emissionSchemaName(ctx, at.ddlSchemaName),
        at.tableName,
        foreignKeyName(at),
        'foreignKey',
      );
      const kept = endForeignKey(ctx.endTree, at);
      const authority = ctx.foreignKeyDropAuthority(at.ddlSchemaName, at.tableName, at.foreignKey);
      if (authority !== 'allowed') {
        changeConflicts.push(
          authority === 'otherSpace'
            ? otherSpaceRefusal(change, at)
            : controlPolicyRefusal(change, at, kept !== undefined),
        );
        continue;
      }
      if (kept !== undefined) {
        changeCalls.push(
          drop,
          new AddForeignKeyCall(drop.schemaName, at.tableName, fkSpecFromNode(kept, at.tableName)),
        );
      } else if (dropsTable(at, ctx.allIssues)) {
        changeCalls.push(drop);
      } else {
        changeConflicts.push(
          tableInEndTree(ctx.endTree, at)
            ? removedForeignKeyRefusal(change, at)
            : allowsOnlyAdditive(ctx)
              ? undeclaredTableRefusal(change, at)
              : undeclaredSchemaRefusal(change, at),
        );
      }
    }
    if (changeConflicts.length > 0) {
      conflicts.push(...changeConflicts);
    } else {
      calls.push(...changeCalls, ...keyCalls(change, ctx));
    }
  }
  const consumed = new Set(changes.map((change) => change.issue));
  return {
    kind: 'match',
    issues: issues.filter((issue) => !consumed.has(issue)),
    calls,
    conflicts,
  };
}
