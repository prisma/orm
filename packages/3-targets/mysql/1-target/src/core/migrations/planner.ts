import type { Contract } from '@internal/contract/types';
import {
  type CallSubjects,
  type MigrationOperationPolicy,
  NO_RENAMED_ORIGINS,
  plannerFailure,
  type SqlMigrationPlanner,
  type SqlMigrationPlannerPlanOptions,
  type SqlPlannerConflict,
  type SqlPlannerFailureResult,
  sqlTypeLookupsOf,
  subjectsOfCalls,
  type TableRenameByHand,
} from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import {
  diffSchemas,
  issueOutcome,
  type MigrationAccessChange,
  type MigrationDataLoss,
  type MigrationPlanner,
  type MigrationScaffoldContext,
  type MigrationTemporaryValue,
  type PlanOrigin,
  type ResolvedMigrationStatement,
  type SchemaDiffIssue,
  type SchemaOwnership,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { RelationalSchemaNodeKind, SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { mysqlError } from '../errors';
import { quoteIdentifier } from '../sql-utils';
import { mysqlContractToSchema } from './diff-database-schema';
import { coalesceSubtreeIssues, issueNode, planIssues } from './issue-planner';
import {
  DropColumnCall,
  DropTableCall,
  type MysqlOpFactoryCall,
  RawSqlCall,
  renameTableByHandOp,
} from './op-factory-call';
import { TypeScriptRenderableMysqlMigration } from './planner-produced-mysql-migration';
import type { MysqlPlanTargetDetails } from './planner-target-details';

export type MysqlPlanResult =
  | {
      readonly kind: 'success';
      readonly plan: TypeScriptRenderableMysqlMigration;
      readonly appliedStatements: readonly [];
      readonly dataLoss: readonly MigrationDataLoss[];
      readonly accessChanges: readonly MigrationAccessChange[];
      readonly temporaryValues: readonly MigrationTemporaryValue[];
    }
  | SqlPlannerFailureResult;

const mysqlTableRenameByHand: TableRenameByHand = {
  renderTableRename: (rename) =>
    new RawSqlCall(renameTableByHandOp(rename.from, rename.to)).renderTypeScript(),
  tableRenameByHand: (rename) => [
    `RENAME TABLE ${quoteIdentifier(rename.from)} TO ${quoteIdentifier(rename.to)}`,
  ],
};

function tableTarget(table: string, column?: string) {
  return {
    storageName: column === undefined ? table : `${table}.${column}`,
    table: { namespaceId: UNBOUND_NAMESPACE_ID, table, column },
  };
}

function callSubjects(call: MysqlOpFactoryCall): CallSubjects {
  const dataLoss =
    call instanceof DropTableCall
      ? [{ ...tableTarget(call.tableName), loss: 'drop' as const }]
      : call instanceof DropColumnCall
        ? [{ ...tableTarget(call.tableName, call.columnName), loss: 'drop' as const }]
        : [];
  return { operationCount: 1, label: call.label, dataLoss, accessChanges: [], temporaryValues: [] };
}

/** Whether `issue` is an extra table some contract space owns, which this space must leave alone. */
function isTableOwnedElsewhere(issue: SchemaDiffIssue, ownership: SchemaOwnership): boolean {
  if (issueOutcome(issue) !== 'not-expected') return false;
  if (issueNode(issue)?.nodeKind !== RelationalSchemaNodeKind.table) return false;
  const table = issue.path[1];
  return (
    table !== undefined &&
    ownership.declaresEntity({
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'table',
      entityName: table,
    })
  );
}

/**
 * The MySQL migration planner. It diffs the contract's schema against the live one and plans creating and dropping tables, columns, indexes, unique constraints and foreign keys. Every other change, and every statement such as a rename, is refused with a conflict that says it is not yet supported on MySQL.
 */
export class MysqlMigrationPlanner
  implements SqlMigrationPlanner<MysqlPlanTargetDetails>, MigrationPlanner<'sql', 'mysql'>
{
  readonly #lowerer: ExecuteRequestLowerer;

  constructor(lowerer: ExecuteRequestLowerer) {
    this.#lowerer = lowerer;
  }

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly fromContract: Contract | null;
    readonly origin: PlanOrigin | null;
    readonly statements: readonly ResolvedMigrationStatement[];
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
    readonly spaceId: string;
    readonly ownership?: SchemaOwnership;
    readonly snapshotsImportPath: string;
  }): MysqlPlanResult {
    return this.#planSql(
      blindCast<
        SqlMigrationPlannerPlanOptions,
        'the CLI hands the MySQL planner a SQL contract and the schema MySQL introspection or contractToSchema built'
      >(options),
    );
  }

  emptyMigration(
    context: MigrationScaffoldContext,
    spaceId: string,
  ): TypeScriptRenderableMysqlMigration {
    return new TypeScriptRenderableMysqlMigration({
      calls: [],
      meta: { from: context.fromHash, to: context.toHash },
      spaceId,
      snapshotsImportPath: context.snapshotsImportPath,
      lowerer: this.#lowerer,
    });
  }

  #planSql(options: SqlMigrationPlannerPlanOptions): MysqlPlanResult {
    if (!options.policy.allowedOperationClasses.includes('additive')) {
      return plannerFailure([
        {
          kind: 'unsupportedOperation',
          summary: 'Migration planner requires additive operations be allowed',
          why: 'The planner requires the "additive" operation class to be allowed in the policy.',
        },
      ]);
    }
    const [statement] = options.statements;
    if (statement !== undefined) {
      return plannerFailure([statementNotYetSupported(statement)]);
    }
    if (!(options.schema instanceof SqlSchemaIR)) {
      throw mysqlError(
        'CONTRACT.TARGET_MISMATCH',
        'The MySQL planner received a schema tree that neither MySQL introspection nor contractToSchema built.',
      );
    }
    const expected = mysqlContractToSchema(
      options.contract,
      sqlTypeLookupsOf(options.frameworkComponents),
    );
    const actual = options.schema;
    const allowed = options.policy.allowedOperationClasses;
    const strict = allowed.includes('widening') || allowed.includes('destructive');
    const { ownership } = options;
    const issues = coalesceSubtreeIssues(diffSchemas(expected, actual)).filter(
      (issue) =>
        (strict || issueOutcome(issue) !== 'not-expected') &&
        (ownership === undefined || !isTableOwnedElsewhere(issue, ownership)),
    );
    const planned = planIssues({ issues, expected, actual, policy: options.policy });
    if (!planned.ok) return plannerFailure(planned.failure);
    const calls = planned.value;
    return {
      kind: 'success',
      plan: new TypeScriptRenderableMysqlMigration({
        calls,
        meta: {
          from: options.origin?.storageHash ?? null,
          to: options.contract.storage.storageHash,
        },
        spaceId: options.spaceId,
        snapshotsImportPath: options.snapshotsImportPath,
        destination: {
          storageHash: options.contract.storage.storageHash,
          ...(options.contract.profileHash === undefined
            ? {}
            : { profileHash: options.contract.profileHash }),
        },
        lowerer: this.#lowerer,
      }),
      appliedStatements: [],
      ...subjectsOfCalls(calls.map(callSubjects), {
        fromContract: options.fromContract,
        contract: options.contract,
        origins: NO_RENAMED_ORIGINS,
        byHand: mysqlTableRenameByHand,
        removedVariants: [],
      }),
    };
  }
}

function statementNotYetSupported(statement: ResolvedMigrationStatement): SqlPlannerConflict {
  return {
    kind: 'statementRefused',
    summary: `A ${statement.kind} statement is not yet supported on MySQL`,
    why: 'The MySQL planner plans no rename, conversion or backfill yet. Plan the change without the statement, or write it by hand in a migration of its own with `migration new`.',
    refusedStatement: statement,
  };
}

export function createMysqlMigrationPlanner(lowerer: ExecuteRequestLowerer): MysqlMigrationPlanner {
  return new MysqlMigrationPlanner(lowerer);
}
